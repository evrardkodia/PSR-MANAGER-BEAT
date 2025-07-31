const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch'); // Ajouté pour le téléchargement
const { execSync, spawnSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

console.log("🚀 routes/player.js chargé");

// Chemins
const TIMIDITY_EXE = `"C:\\Program Files (x86)\\Timidity\\timidity.exe"`;
const TIMIDITY_CFG = `"C:\\Users\\DELL\\PSRMANAGERSTYLE\\timidity.cfg"`;
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const PY_EXTRACT_SCRIPT = path.join(__dirname, '..', 'scripts', 'extract_main.py');
const SOX_PATH = 'sox'; // Doit être dans le PATH système

// Chemin SoundFont récupéré depuis variable d'environnement SF2_PATH ou fallback
const SF2_PATH = process.env.SF2_PATH || path.join(__dirname, '..', 'soundfonts', 'Yamaha_PSR.sf2');
console.log('📀 Utilisation du SoundFont :', SF2_PATH);

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Route test ping simple
router.get('/ping', (req, res) => {
  console.log("➡️ GET /api/player/ping reçu");
  res.json({ message: 'pong' });
});

// 🔧 Suppression du silence final
function trimSilenceFromWav(wavPath) {
  const trimmedPath = wavPath.replace('.wav', '_trimmed.wav');
  try {
    const cmd = `${SOX_PATH} "${wavPath}" "${trimmedPath}" reverse silence 1 0.1 0.1% reverse`;
    console.log(`✂️ Suppression silence : ${cmd}`);
    execSync(cmd, { stdio: 'inherit' });

    if (fs.existsSync(trimmedPath)) {
      fs.unlinkSync(wavPath);
      fs.renameSync(trimmedPath, wavPath);
      console.log(`✅ Silence supprimé : ${wavPath}`);
    } else {
      console.warn('⚠️ Fichier trimmed non trouvé, on garde le WAV original');
    }
  } catch (err) {
    console.error('❌ Erreur suppression du silence :', err.message);
  }
}

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

// Fonction utilitaire pour téléchargement du .sty depuis Supabase
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

    // Téléchargement obligatoire du fichier .sty depuis Supabase
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

    // 2) Extraction section spécifique via Python
    const extractProcess = spawnSync('python', [PY_EXTRACT_SCRIPT, rawMidPath, extractedMidPath, section], { encoding: 'utf-8' });

    console.log('Python stdout:', extractProcess.stdout);
    console.error('Python stderr:', extractProcess.stderr);

    if (extractProcess.status !== 0) {
      console.error('❌ Script Python erreur :', extractProcess.stderr);
      return res.status(500).json({ error: `Échec extraction section ${section}` });
    }

    const outputLines = extractProcess.stdout.trim().split('\n');
    const durationStr = outputLines[outputLines.length - 1];
    const midiDuration = parseFloat(durationStr);
    console.log(`🎯 MIDI section extraite (${section}) | Durée : ${midiDuration}s`);

    // Diagnostic : liste fichiers dans temp après extraction Python
    try {
      const files = fs.readdirSync(TEMP_DIR);
      console.log('🔎 Contenu de temp après extraction Python:', files);
    } catch (err) {
      console.error('❌ Erreur lecture dossier temp:', err);
    }

    // 3) Conversion MIDI → WAV avec SoundFont local
    const convertCmd = `${TIMIDITY_EXE} "${extractedMidPath}" -Ow -o "${wavPath}" -s44100 -c ${TIMIDITY_CFG} -EFreverb=0 -EFchorus=0 -A120 -soundfont "${SF2_PATH}"`;
    console.log('🎶 Conversion TiMidity++ :', convertCmd);
    execSync(convertCmd, { stdio: 'inherit' });

    // 4) Suppression du silence
    trimSilenceFromWav(wavPath);

    if (!fs.existsSync(wavPath)) {
      return res.status(500).json({ error: 'WAV final manquant' });
    }

    // 5) Envoi au client
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

// === NOUVELLE ROUTE POUR LISTER LE CONTENU DE /temp ===
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
