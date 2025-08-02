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
const TIMIDITY_EXE = 'timidity'; // Timidity doit être installé et accessible dans le PATH
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// Chemin SoundFont récupéré depuis variable d'environnement SF2_PATH ou fallback
const SF2_PATH = process.env.SF2_PATH || path.join(__dirname, '..', 'soundfonts', 'Yamaha_PSR.sf2');
console.log('📀 Utilisation du SoundFont :', SF2_PATH);

// Chemin fixe du timidity.cfg à la racine (non créé dynamiquement)
const TIMIDITY_CFG_PATH = path.join(__dirname, '..', 'timidity.cfg');

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

// Route principale : extraction et génération audio complète sans extraction de section
router.post('/play-full', async (req, res) => {
  console.log("➡️ POST /api/player/play-full appelée");
  const { beatId } = req.body;

  if (!beatId) {
    return res.status(400).json({ error: 'beatId est requis' });
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

    const rawMidPath = path.join(TEMP_DIR, `${beat.id}_full_raw.mid`);
    const wavPath = path.join(TEMP_DIR, `${beat.id}_full.wav`);

    // Extraction MIDI brut complet
    extractMidiFromSty(inputStyPath, rawMidPath);

    if (!fs.existsSync(rawMidPath)) {
      return res.status(500).json({ error: 'MIDI brut manquant après extraction' });
    }

    // Conversion MIDI complet → WAV avec Timidity
    const args = [
      '-c', TIMIDITY_CFG_PATH,
      '-Ow',
      '-o', wavPath,
      rawMidPath
    ];

    console.log('🎶 Conversion Timidity (full) :', TIMIDITY_EXE, args.join(' '));
    const convertProcess = spawnSync(TIMIDITY_EXE, args, { encoding: 'utf-8' });

    console.log('📄 Timidity stdout:\n', convertProcess.stdout);
    console.error('📄 Timidity stderr:\n', convertProcess.stderr);

    if (convertProcess.error) {
      console.error('❌ Erreur Timidity spawnSync:', convertProcess.error);
      return res.status(500).json({ error: 'Erreur lors de la conversion MIDI → WAV' });
    }
    if (convertProcess.status !== 0) {
      console.error('❌ Timidity a quitté avec le code:', convertProcess.status);
      return res.status(500).json({ error: 'Erreur lors de la conversion MIDI → WAV' });
    }

    if (!fs.existsSync(wavPath)) {
      return res.status(500).json({ error: 'WAV final manquant après conversion' });
    }

    // Envoi du WAV complet au client
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="${beat.title}_full.wav"`);
    res.sendFile(wavPath);

  } catch (err) {
    console.error('❌ Erreur serveur (play-full) :', err);
    res.status(500).json({ error: 'Erreur serveur interne' });
  }
});

// Nettoyage des fichiers temporaires
router.post('/cleanup', async (req, res) => {
  console.log("➡️ POST /api/player/cleanup appelée");
  const { beatId } = req.body;

  if (!beatId) {
    return res.status(400).json({ error: 'beatId est requis' });
  }

  const filesToDelete = [
    path.join(TEMP_DIR, `${beatId}_full_raw.mid`),
    path.join(TEMP_DIR, `${beatId}_full.wav`),
  ];

  try {
    filesToDelete.forEach(filePath => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
    console.log(`🧹 Fichiers supprimés pour beatId=${beatId}`);
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
