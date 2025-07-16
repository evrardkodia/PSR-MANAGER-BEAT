const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();

const prisma = new PrismaClient();

const SOUND_FONT_PATH = "C:\\Users\\DELL\\PSRMANAGERSTYLE\\soundfonts\\Yamaha_PSR.sf2";
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

/**
 * Extrait le flux MIDI contenu dans un fichier .sty Yamaha
 * @param {string} styPath - chemin du fichier .sty
 * @param {string} outputMidPath - chemin de sortie du .mid
 */
function extractMidiFromSty(styPath, outputMidPath) {
  const data = fs.readFileSync(styPath);
  const headerIndex = data.indexOf(Buffer.from('MThd'));
  if (headerIndex === -1) {
    throw new Error('Aucun header MIDI (MThd) trouvé dans le fichier .sty');
  }
  const midiData = data.slice(headerIndex);
  fs.writeFileSync(outputMidPath, midiData);
  console.log(`✅ MIDI extrait avec succès : ${outputMidPath}`);
}

router.post('/play-section', express.json(), async (req, res) => {
  const { beatId, section } = req.body;
  console.log('📥 Requête reçue :', { beatId, section });

  if (!beatId || !section) {
    return res.status(400).json({ error: 'beatId et section sont requis' });
  }

  try {
    // Recherche du beat en base
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });
    if (!beat) {
      console.warn('❌ Beat introuvable en base');
      return res.status(404).json({ error: 'Beat introuvable' });
    }

    // Chemin du fichier .sty
    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);
    if (!fs.existsSync(inputStyPath)) {
      console.warn('❌ Fichier .sty non trouvé');
      return res.status(404).json({ error: 'Fichier .sty non trouvé' });
    }

    const safeSection = section.replace(/\s+/g, '_');
    const midPath = path.join(TEMP_DIR, `${beat.id}_${safeSection}.mid`);
    const wavPath = path.join(TEMP_DIR, `${beat.id}_${safeSection}.wav`);

    // Extraction MIDI du .sty (toujours refaire pour garantir mise à jour)
    extractMidiFromSty(inputStyPath, midPath);

    if (!fs.existsSync(midPath)) {
      console.error('❌ Fichier MIDI non généré');
      return res.status(500).json({ error: 'Fichier MIDI manquant après extraction' });
    }

    // Conversion .mid -> .wav avec FluidSynth
    const convertCmd = `fluidsynth -F "${wavPath}" -r 44100 -ni "${SOUND_FONT_PATH}" "${midPath}"`;
    console.log('🎶 Conversion FluidSynth :', convertCmd);
    execSync(convertCmd, { stdio: 'inherit' });

    if (!fs.existsSync(wavPath)) {
      console.error('❌ Fichier WAV non généré');
      return res.status(500).json({ error: 'Fichier WAV manquant après conversion' });
    }

    console.log(`✅ Conversion réussie : ${wavPath}`);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', `inline; filename="${beat.title}_${section}.wav"`);
    res.sendFile(wavPath);

  } catch (err) {
    console.error('❌ Erreur serveur :', err);
    res.status(500).json({ error: 'Erreur serveur interne' });
  }
});

router.post('/cleanup', express.json(), async (req, res) => {
  const { beatId, section } = req.body;
  if (!beatId || !section) {
    return res.status(400).json({ error: 'beatId et section sont requis' });
  }

  const safeSection = section.replace(/\s+/g, '_');
  const midPath = path.join(TEMP_DIR, `${beatId}_${safeSection}.mid`);
  const wavPath = path.join(TEMP_DIR, `${beatId}_${safeSection}.wav`);

  try {
    if (fs.existsSync(midPath)) fs.unlinkSync(midPath);
    if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
    console.log(`🧹 Fichiers temporaires supprimés : ${midPath}, ${wavPath}`);
    res.status(200).json({ message: 'Fichiers temporaires supprimés' });
  } catch (err) {
    console.warn('⚠️ Suppression échouée :', err.message);
    res.status(500).json({ error: 'Échec suppression fichiers' });
  }
});

module.exports = router;
