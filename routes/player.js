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
const TIMIDITY_EXE = 'timidity'; // timidity doit être installé et dans le PATH
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

const SF2_PATH = process.env.SF2_PATH || path.join(__dirname, '..', 'soundfonts', 'Yamaha_PSR.sf2');
const TIMIDITY_CFG_PATH = path.join(__dirname, '..', 'timidity.cfg');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Téléchargement du .sty depuis URL
async function downloadStyFromUrl(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erreur téléchargement fichier .sty : ${response.status} ${response.statusText}`);
  const buffer = await response.buffer();
  fs.writeFileSync(destPath, buffer);
  console.log(`✅ Fichier .sty téléchargé : ${destPath}`);
}

// Extraction MIDI brut complet depuis .sty (header MThd)
function extractMidiFromSty(styPath, outputMidPath) {
  const data = fs.readFileSync(styPath);
  const headerIndex = data.indexOf(Buffer.from('MThd'));
  if (headerIndex === -1) throw new Error('Aucun header MIDI (MThd) trouvé dans le fichier .sty');
  const midiData = data.slice(headerIndex);
  fs.writeFileSync(outputMidPath, midiData);
  console.log(`✅ MIDI brut extrait : ${outputMidPath}`);
}

// Extraction main via script Python : spawnSync avec logging complet
function extractMainWithPython(inputMidPath, outputMidPath, sectionName) {
  console.log(`🔧 Extraction section "${sectionName}" via extract_main.py`);
  const pyScript = path.join(SCRIPTS_DIR, 'extract_main.py');

  // Arguments positionnels : input.mid output.mid section_name
  const args = [pyScript, inputMidPath, outputMidPath, sectionName];

  const result = spawnSync('python3', args, { encoding: 'utf-8' });

  if (result.error) {
    console.error('❌ Erreur spawnSync:', result.error);
    throw result.error;
  }

  if (result.stdout && result.stdout.trim() !== '') {
    console.log('🐍 extract_main.py stdout:', result.stdout.trim());
  }

  if (result.stderr && result.stderr.trim() !== '') {
    console.error('🐍 extract_main.py stderr:', result.stderr.trim());
  }

  if (result.status !== 0) {
    throw new Error(`extract_main.py a échoué avec le code ${result.status}`);
  }

  console.log('✅ Extraction section terminée');
}

// Conversion MIDI → WAV avec Timidity
function convertMidToWav(midPath, wavPath) {
  console.log('🎶 Conversion Timidity :', TIMIDITY_EXE, '-c', TIMIDITY_CFG_PATH, '-Ow', '-o', wavPath, midPath);
  const args = ['-c', TIMIDITY_CFG_PATH, '-Ow', '-o', wavPath, midPath];
  const convertProcess = spawnSync(TIMIDITY_EXE, args, { encoding: 'utf-8' });

  if (convertProcess.error) throw convertProcess.error;
  if (convertProcess.status !== 0) {
    console.error('❌ Timidity stderr:', convertProcess.stderr);
    throw new Error(`Timidity a échoué avec le code ${convertProcess.status}`);
  }
  console.log('✅ Conversion MIDI → WAV terminée');
}

// Route qui prépare le main (extraction + conversion WAV)
router.post('/prepare-main', async (req, res) => {
  console.log('➡️ POST /api/player/prepare-main appelée');
  const { beatId, mainLetter } = req.body;

  if (!beatId) return res.status(400).json({ error: 'beatId est requis' });
  if (!mainLetter) return res.status(400).json({ error: 'mainLetter est requis' });

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });
    if (!beat) return res.status(404).json({ error: 'Beat introuvable' });
    if (!beat.url) return res.status(404).json({ error: 'URL du fichier .sty manquante' });

    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);

    // Télécharger le .sty dans uploads/
    await downloadStyFromUrl(beat.url, inputStyPath);

    // 1️⃣ Extraire le MIDI brut complet depuis .sty
    const fullMidPath = path.join(TEMP_DIR, `${beatId}_full.mid`);
    extractMidiFromSty(inputStyPath, fullMidPath);

    // 2️⃣ Extraire la section "Main X" du MIDI complet via Python
    const rawMidPath = path.join(TEMP_DIR, `${beatId}_main_${mainLetter}_raw.mid`);
    const sectionName = `Main ${mainLetter}`; // ex: "Main A"
    extractMainWithPython(fullMidPath, rawMidPath, sectionName);

    if (!fs.existsSync(rawMidPath)) {
      return res.status(500).json({ error: 'Fichier MIDI extrait manquant après extraction' });
    }

    // 3️⃣ Conversion MIDI → WAV
    const wavPath = path.join(TEMP_DIR, `${beatId}_main_${mainLetter}.wav`);
    convertMidToWav(rawMidPath, wavPath);

    if (!fs.existsSync(wavPath)) {
      return res.status(500).json({ error: 'Fichier WAV manquant après conversion' });
    }

    const wavUrl = `/temp/${path.basename(wavPath)}`;
    console.log(`✅ Préparation terminée, wav accessible : ${wavUrl}`);

    return res.json({ wavUrl });
  } catch (err) {
    console.error('❌ Erreur serveur (prepare-main) :', err);
    return res.status(500).json({ error: 'Erreur serveur interne lors de la préparation main' });
  }
});

// Route play-section (confirm que WAV est prêt, lecture côté client)
router.post('/play-section', (req, res) => {
  console.log('➡️ POST /api/player/play-section appelée');
  res.json({ message: 'Le fichier wav est prêt, lecture côté client' });
});

// Nettoyage fichiers temp (optionnel)
router.post('/cleanup', async (req, res) => {
  console.log("➡️ POST /api/player/cleanup appelée");
  const { beatId } = req.body;

  if (!beatId) return res.status(400).json({ error: 'beatId est requis' });

  // Supprime tous fichiers temp liés au beat (raw midi + wav mainX)
  const filesToDelete = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(beatId));

  try {
    filesToDelete.forEach(file => {
      const p = path.join(TEMP_DIR, file);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    console.log(`🧹 Fichiers temporaires supprimés pour beatId=${beatId}`);
    res.status(200).json({ message: 'Fichiers supprimés' });
  } catch (err) {
    console.warn('⚠️ Problème nettoyage :', err.message);
    res.status(500).json({ error: 'Erreur lors du nettoyage' });
  }
});

// Liste contenu dossier temp
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
    console.error('❌ Erreur lecture dossier temp :', err.message);
    res.status(500).json({ error: 'Erreur lecture du dossier temp' });
  }
});

module.exports = router;
