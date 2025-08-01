const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

console.log("🚀 routes/player.js chargé");

// Chemins
const TIMIDITY_EXE = 'timidity'; // Linux: binaire dans le PATH
const TIMIDITY_CFG = '/app/timidity.cfg'; // fichier cfg sur Render (doit contenir la ligne soundfont /app/soundfonts/Yamaha_PSR.sf2)
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const PY_EXTRACT_SCRIPT = path.join(__dirname, '..', 'scripts', 'extract_main.py');

// Chemin SoundFont récupéré depuis variable d'environnement SF2_PATH ou fallback
const SF2_PATH = process.env.SF2_PATH || path.join(__dirname, '..', 'soundfonts', 'Yamaha_PSR.sf2');
console.log('📀 Utilisation du SoundFont :', SF2_PATH);

// --- AJOUTS POUR DEBUG SOUND FONT ET CFG ---
try {
  const sf2Stats = fs.statSync(SF2_PATH);
  console.log(`✅ SoundFont SF2 détecté : ${SF2_PATH} (${sf2Stats.size} octets)`);
} catch (e) {
  console.error(`❌ SoundFont SF2 INTRouvable ou inaccessible : ${SF2_PATH}`, e.message);
}

try {
  const cfgContent = fs.readFileSync(TIMIDITY_CFG, 'utf-8');
  console.log(`📄 Contenu de ${TIMIDITY_CFG} :\n${cfgContent}`);
} catch (e) {
  console.error(`❌ Impossible de lire le fichier timidity.cfg : ${e.message}`);
}
// --- FIN AJOUT DEBUG ---

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Route test ping simple
router.get('/ping', (req, res) => {
  console.log("➡️ GET /api/player/ping reçu");
  res.json({ message: 'pong' });
});

// Extraction brute du MIDI depuis un .sty
function extractMidiFromSty(styPath, outputMidPath) {
  const data = fs.readFileSync(styPath);
  const headerIndex = data.indexOf(Buffer.from('MThd'));
  if (headerIndex === -1) {
    throw new Error('Aucun header MIDI (MThd) trouvé dans le fichier .sty');
  }
  const midiData = data.slice(headerIndex);
  fs.writeFileSync(outputMidPath, midiData);
  console.log(`✅ MIDI extrait : ${outputMidPath}`);
}

// Téléchargement du .sty depuis URL (ex: Supabase)
async function downloadStyFromUrl(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Erreur téléchargement fichier .sty : ${response.status} ${response.statusText}`);
  }
  const buffer = await response.buffer();
  fs.writeFileSync(destPath, buffer);
  console.log(`✅ Fichier .sty téléchargé depuis URL et sauvegardé : ${destPath}`);
}

// Route principale : extraction et génération audio
router.post('/play-section', async (req, res) => {
  console.log("➡️ POST /api/player/play-section appelée");
  const { beatId, section } = req.body;
  console.log('📥 Requête reçue :', { beatId, section });

  if (!beatId || !section) {
    return res.status(400).json({ error: 'beatId et section sont requis' });
  }

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });
    if (!beat) {
      return res.status(404).json({ error: 'Beat introuvable' });
    }
    if (!beat.url) {
      return res.status(404).json({ error: 'URL du fichier .sty manquante' });
    }

    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);

    // Téléchargement du fichier .sty
    await downloadStyFromUrl(beat.url, inputStyPath);

    const safeSection = section.replace(/\s+/g, '_');
    const rawMidPath = path.join(TEMP_DIR, `${beat.id}_${safeSection}_raw.mid`);
    const extractedMidPath = path.join(TEMP_DIR, `${beat.id}_${safeSection}.mid`);
    const wavPath = path.join(TEMP_DIR, `${beat.id}_${safeSection}.wav`);

    // 1) Extraction MIDI brut
    extractMidiFromSty(inputStyPath, rawMidPath);
    if (!fs.existsSync(rawMidPath)) {
      return res.status(500).json({ error: 'MIDI brut manquant après extraction' });
    }

    // 2) Extraction section via script Python
    const extractProcess = spawnSync('python3', [PY_EXTRACT_SCRIPT, rawMidPath, extractedMidPath, section], { encoding: 'utf-8' });

    console.log('Python stdout:', extractProcess.stdout || 'empty stdout');
    console.error('Python stderr:', extractProcess.stderr || 'empty stderr');
    console.log('Extract process error:', extractProcess.error || 'none');
    console.log('Extract process status:', extractProcess.status);

    if (extractProcess.status !== 0) {
      const debugLogPath = path.join(TEMP_DIR, 'python_debug.log');
      if (fs.existsSync(debugLogPath)) {
        const debugLog = fs.readFileSync(debugLogPath, 'utf-8');
        console.error('Contenu python_debug.log:', debugLog);
      }
      return res.status(500).json({ error: `Échec extraction section ${section}` });
    }

    const outputLines = extractProcess.stdout.trim().split('\n');
    const durationStr = outputLines[outputLines.length - 1];
    const midiDuration = parseFloat(durationStr);
    console.log(`🎯 MIDI section extraite (${section}) | Durée : ${midiDuration}s`);

    try {
      const files = fs.readdirSync(TEMP_DIR);
      console.log('🔎 Contenu de temp après extraction Python:', files);
    } catch (err) {
      console.error('❌ Erreur lecture dossier temp:', err);
    }

    // 3) Conversion MIDI → WAV avec SoundFont local et log verbose
    const LOG_PATH = path.join(TEMP_DIR, 'timidity_verbose.log');

    if (!fs.existsSync(SF2_PATH)) {
      console.warn(`⚠️ SoundFont non trouvé à ${SF2_PATH}`);
    }
    if (!fs.existsSync(TIMIDITY_CFG)) {
      console.warn(`⚠️ Fichier timidity.cfg manquant à ${TIMIDITY_CFG}`);
    }

    const args = [
      '-v',
      '-c', TIMIDITY_CFG,
      extractedMidPath,
      '-Ow',
      '-o', wavPath,
      '-s44100',
      '-EFreverb=0',
      '-EFchorus=0',
      '-A120'
    ];

    console.log('🎶 Conversion TiMidity++ :', TIMIDITY_EXE, args.join(' '));

    const convertProcess = spawnSync(TIMIDITY_EXE, args, { encoding: 'utf-8' });

    // Écriture du log dans le fichier
    fs.writeFileSync(LOG_PATH, convertProcess.stdout + convertProcess.stderr);

    console.log('📄 TiMidity stdout:\n', convertProcess.stdout);
    console.error('📄 TiMidity stderr:\n', convertProcess.stderr);

    if (convertProcess.error) {
      console.error('❌ Erreur TiMidity spawnSync:', convertProcess.error);
      return res.status(500).json({ error: 'Erreur lors de la conversion MIDI → WAV' });
    }
    if (convertProcess.status !== 0) {
      console.error('❌ TiMidity a quitté avec le code:', convertProcess.status);
      return res.status(500).json({ error: 'Erreur lors de la conversion MIDI → WAV' });
    }

    // Vérification post-conversion WAV
    if (fs.existsSync(wavPath)) {
      const wavStats = fs.statSync(wavPath);
      console.log(`✅ WAV généré avec succès : ${wavPath}`);
      console.log(`🔊 Taille du fichier WAV : ${wavStats.size} octets`);
      console.log(`📀 SoundFont utilisé : ${SF2_PATH}`);
      console.log(`⚙️ Fichier config utilisé : ${TIMIDITY_CFG}`);
    } else {
      console.error(`❌ WAV NON généré : ${wavPath}`);
      console.error(`📀 SoundFont supposé utilisé : ${SF2_PATH}`);
      console.error(`⚙️ timidity.cfg utilisé : ${TIMIDITY_CFG}`);
      return res.status(500).json({ error: 'WAV final manquant après conversion' });
    }

    // 4) Envoi au client
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="${beat.title}_${section}.wav"`);
    res.sendFile(wavPath);

  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur serveur interne' });
  }
});

// Nettoyage des fichiers temporaires
router.post('/cleanup', async (req, res) => {
  console.log("➡️ POST /api/player/cleanup appelée");
  const { beatId, section } = req.body;

  if (!beatId || !section) {
    return res.status(400).json({ error: 'beatId et section sont requis' });
  }

  const safeSection = section.replace(/\s+/g, '_');
  const filesToDelete = [
    path.join(TEMP_DIR, `${beatId}_${safeSection}_raw.mid`),
    path.join(TEMP_DIR, `${beatId}_${safeSection}.mid`),
    path.join(TEMP_DIR, `${beatId}_${safeSection}.wav`),
  ];

  try {
    filesToDelete.forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    console.log(`🧹 Fichiers supprimés pour beatId=${beatId}, section=${section}`);
    res.status(200).json({ message: 'Fichiers supprimés' });
  } catch (err) {
    console.warn('⚠️ Problème lors du nettoyage :', err.message);
    res.status(500).json({ error: 'Erreur lors du nettoyage' });
  }
});

// Route pour lister le contenu de /temp
router.get('/temp', (req, res) => {
  console.log("➡️ GET /api/player/temp appelée");

  try {
    const files = fs.readdirSync(TEMP_DIR);
    const midiWavFiles = files.filter(file => file.endsWith('.mid') || file.endsWith('.wav'));

    console.log(`📂 Contenu de temp/ :\n${midiWavFiles.join('\n') || 'Aucun fichier .mid/.wav trouvé'}`);

    res.json({
      count: midiWavFiles.length,
      files: midiWavFiles
    });
  } catch (err) {
    console.error('❌ Erreur lors de la lecture du dossier temp :', err.message);
    res.status(500).json({ error: 'Erreur lecture du dossier temp' });
  }
});

module.exports = router;
