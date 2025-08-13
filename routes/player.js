const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { spawnSync, execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const { spawn } = require('child_process');
const router = express.Router();
const prisma = new PrismaClient();


console.log("🚀 routes/player.js chargé");

// Chemins
const TIMIDITY_EXE = 'timidity';
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const FFPROBE_EXE = 'ffprobe';

// Utilise la variable d'environnement FFMPEG_PATH ou 'ffmpeg' par défaut
const FFMPEG_EXE = process.env.FFMPEG_PATH || 'ffmpeg';

const SF2_PATH = process.env.SF2_PATH || path.join(__dirname, '..', 'soundfonts', 'Yamaha_PSR.sf2');
const TIMIDITY_CFG_PATH = path.join(__dirname, '..', 'timidity.cfg');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// --- Utils ---
function publicBaseUrl(req) {
  const fromEnv = process.env.PUBLIC_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

async function downloadStyFromUrl(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Erreur téléchargement fichier .sty : ${response.status} ${response.statusText}`);
  const buffer = await response.buffer();
  fs.writeFileSync(destPath, buffer);
  console.log(`✅ Fichier .sty téléchargé : ${destPath}`);
}

function extractMidiFromSty(styPath, outputMidPath) {
  const data = fs.readFileSync(styPath);
  const headerIndex = data.indexOf(Buffer.from('MThd'));
  if (headerIndex === -1) throw new Error('Aucun header MIDI (MThd) trouvé dans le fichier .sty');
  const midiData = data.slice(headerIndex);
  fs.writeFileSync(outputMidPath, midiData);
  console.log(`✅ MIDI brut extrait : ${outputMidPath}`);
}

function extractMainWithPython(inputMidPath, outputMidPath, sectionName) {
  console.log(`🔧 Extraction section "${sectionName}" via extract_main.py`);
  const pyScript = path.join(SCRIPTS_DIR, 'extract_main.py');
  const args = [pyScript, inputMidPath, outputMidPath, sectionName];
  const result = spawnSync('python3', args, { encoding: 'utf-8' });

  if (result.error) {
    console.error('❌ Erreur lors du spawn python:', result.error);
    throw result.error;
  }
  if (result.stdout?.trim()) console.log('🐍 extract_main.py stdout:', result.stdout.trim());
  if (result.stderr?.trim()) console.error('🐍 extract_main.py stderr:', result.stderr.trim());
  if (result.status !== 0) throw new Error(`extract_main.py a échoué avec le code ${result.status}`);

  return result.stdout;
}


function convertMidToWavAsync(midPath, wavPath) {
  return new Promise((resolve, reject) => {
    const args = ['-c', TIMIDITY_CFG_PATH, '-Ow', '--preserve-silence', '-A120', '-o', wavPath, midPath];
    const proc = spawn(TIMIDITY_EXE, args);

    proc.on('error', (err) => reject(err));
    proc.stderr.on('data', (data) => {
      console.error('timidity stderr:', data.toString());
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Conversion MIDI → WAV terminée : ${wavPath}`);
        resolve();
      } else {
        reject(new Error(`Timidity a échoué avec le code ${code}`));
      }
    });
  });
}

function trimWavFile(wavPath, duration) {
  const trimmedPath = wavPath.replace(/\.wav$/, '_trimmed.wav');
  const args = ['-i', wavPath, '-t', `${duration}`, '-c', 'copy', trimmedPath];
  const result = spawnSync(FFMPEG_EXE, args, { encoding: 'utf-8' });

  if (result.error || result.status !== 0) {
    console.error('❌ ffmpeg stderr:', result.stderr?.toString());
    console.error('❌ ffmpeg stdout:', result.stdout?.toString());
    if (result.error && result.error.code === 'ENOENT') {
      throw new Error('ffmpeg non trouvé dans l’environnement. Assure-toi qu’il est bien installé dans le Dockerfile.');
    }
    throw new Error('ffmpeg trim failed');
  }

  fs.renameSync(trimmedPath, wavPath);
  console.log('🔪 WAV rogné à', duration, 'secondes');
}

// --- Durée d’un WAV (pour planifier sans blanc) ---
function getWavDurationSec(wavPath) {
  try {
    const out = execSync(`${FFPROBE_EXE} -v error -show_entries format=duration -of default=nw=1:nk=1 -i "${wavPath}"`, { encoding: 'utf-8' });
    const val = parseFloat(String(out).trim());
    return isNaN(val) ? null : val;
  } catch (e) {
    console.warn('⚠️ Impossible de lire la durée via ffprobe:', e.message);
    return null;
  }
}


// --- Routes ---

router.post('/prepare-main', async (req, res) => {
  console.log('➡️ POST /api/player/prepare-main appelée');
  const { beatId, mainLetter } = req.body;

  if (!beatId || !mainLetter) {
    return res.status(400).json({ error: 'beatId et mainLetter sont requis' });
  }

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });
    if (!beat || !beat.url) {
      return res.status(404).json({ error: 'Beat ou URL introuvable' });
    }

    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);
    await downloadStyFromUrl(beat.url, inputStyPath);

    const fullMidPath = path.join(TEMP_DIR, `${beatId}_full.mid`);
    extractMidiFromSty(inputStyPath, fullMidPath);

    const rawMidPath = path.join(TEMP_DIR, `${beatId}_main_${mainLetter}_raw.mid`);
    const sectionName = `Main ${mainLetter}`;
    const stdout = extractMainWithPython(fullMidPath, rawMidPath, sectionName);
    const duration = parseFloat(stdout.trim());

    if (!fs.existsSync(rawMidPath)) {
      return res.status(500).json({ error: 'Fichier MIDI extrait manquant après extraction' });
    }

    const wavPath = path.join(TEMP_DIR, `${beatId}_main_${mainLetter}.wav`);
    convertMidToWav(rawMidPath, wavPath);

    if (!fs.existsSync(wavPath)) {
      return res.status(500).json({ error: 'Fichier WAV manquant après conversion' });
    }

    if (!isNaN(duration)) {
      trimWavFile(wavPath, duration);
    }

    const wavUrl = `${publicBaseUrl(req)}/temp/${path.basename(wavPath)}`;
    console.log(`✅ Préparation terminée, wav accessible : ${wavUrl}`);

    return res.json({ wavUrl });
  } catch (err) {
    console.error('❌ Erreur serveur (prepare-main) :', err);
    return res.status(500).json({ error: 'Erreur serveur interne lors de la préparation main' });
  }
});

// --- Log de la structure de sections ---
router.post('/prepare-all', async (req, res) => {
  console.log('➡️ POST /api/player/prepare-all appelée');
  const { beatId } = req.body;

  if (!beatId) {
    return res.status(400).json({ error: 'beatId est requis' });
  }

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });
    if (!beat || !beat.url) {
      return res.status(404).json({ error: 'Beat ou URL introuvable' });
    }

    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);
    await downloadStyFromUrl(beat.url, inputStyPath);
    console.log(`✅ Fichier .sty téléchargé : ${inputStyPath}`);

    const fullMidPath = path.join(TEMP_DIR, `${beatId}_full.mid`);
    extractMidiFromSty(inputStyPath, fullMidPath);
    console.log(`✅ MIDI brut extrait : ${fullMidPath}`);

    const pyScript = path.join(SCRIPTS_DIR, 'extract_sections.py');
    const args = [pyScript, fullMidPath, TEMP_DIR];
    const result = spawnSync('python3', args, { encoding: 'utf-8' });

    if (result.error) throw result.error;
    if (result.stderr?.trim()) console.error('🐍 extract_sections.py stderr:', result.stderr.trim());
    if (result.status !== 0) throw new Error(`extract_sections.py a échoué avec le code ${result.status}`);
    if (!result.stdout) throw new Error("extract_sections.py n'a pas renvoyé de données JSON");

    const sectionsJson = JSON.parse(result.stdout.trim());
    console.log('🐍 extract_sections.py stdout (sections trouvées) :', sectionsJson);

    return res.json({ sections: sectionsJson.sections });
  } catch (err) {
    console.error('❌ Erreur serveur (prepare-all) :', err);
    return res.status(500).json({ error: 'Erreur serveur interne lors de la préparation des sections' });
  }
});

router.post('/play-section', (req, res) => {
  const { beatId, mainLetter } = req.body;
  if (!beatId || !mainLetter) {
    return res.status(400).json({ error: 'beatId et mainLetter sont requis' });
  }

  const fileName = `${beatId}_main_${mainLetter}.wav`;
  const fullPath = path.join(TEMP_DIR, fileName);

  console.log(`➡️ POST /api/player/play-section pour beatId=${beatId} main=${mainLetter}`);
  console.log(`🔎 Vérification existence: ${fullPath}`);

  if (!fs.existsSync(fullPath)) {
    console.error(`❌ Fichier introuvable: ${fullPath}`);
    return res.status(404).json({ error: 'Fichier WAV introuvable. Réessayez de préparer le main.' });
  }

  const base = publicBaseUrl(req);
  const wavUrl = `${base}/temp/${fileName}`;
  console.log(`✅ WAV prêt: ${wavUrl}`);

  return res.json({ wavUrl, message: 'Lecture WAV confirmée côté serveur' });
});

router.get('/stream', (req, res) => {
  const { beatId, mainLetter } = req.query;
  if (!beatId || !mainLetter) {
    return res.status(400).json({ error: 'beatId et mainLetter sont requis' });
  }
  const fileName = `${beatId}_main_${mainLetter}.wav`;
  const fullPath = path.join(TEMP_DIR, fileName);

  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'Fichier WAV introuvable.' });
  }

  res.setHeader('Content-Type', 'audio/wav');
  return res.sendFile(fullPath);
});

router.post('/cleanup', async (req, res) => {
  console.log("➡️ POST /api/player/cleanup appelée");
  const { beatId } = req.body;

  if (!beatId) return res.status(400).json({ error: 'beatId est requis' });

  const filesToDelete = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(String(beatId)));

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

router.get('/list-temps', async (req, res) => {
  try {
    const files = await fs.promises.readdir(TEMP_DIR);
    res.json({ files });
  } catch (err) {
    console.error('❌ Erreur lecture dossier temp:', err);
    res.status(500).json({ error: 'Impossible de lire le dossier temp' });
  }
});

// --- NOUVEAU : préparation + manifest séquenceur (gapless & transitions) ---
router.post('/prepare-all-sections', async (req, res) => {
  console.log('➡️ POST /api/player/prepare-all-sections appelée');
  const { beatId } = req.body;

  if (!beatId) {
    return res.status(400).json({ error: 'beatId est requis' });
  }

  try {
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });
    if (!beat || !beat.url) {
      return res.status(404).json({ error: 'Beat ou URL introuvable' });
    }

    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);
    await downloadStyFromUrl(beat.url, inputStyPath);

    const fullMidPath = path.join(TEMP_DIR, `${beatId}_full.mid`);
    extractMidiFromSty(inputStyPath, fullMidPath);

    const pythonScript = path.join(__dirname, '../scripts/extract_all_sections.py');
    const command = `python3 ${pythonScript} "${fullMidPath}" "${TEMP_DIR}"`;
    const stdout = execSync(command, { encoding: 'utf-8' });
    console.log('DEBUG stdout:', stdout);

    const pyJson = JSON.parse(stdout.trim());
    const baseUrl = publicBaseUrl(req);

    const sectionsArray = Array.isArray(pyJson.sections) ? pyJson.sections : [];

    // Conversion MIDI->WAV en parallèle
    const conversionPromises = sectionsArray.map(async (section) => {
      const midPath = path.join(TEMP_DIR, section.midFilename);
      const wavPath = midPath.replace(/\.mid$/i, '.wav');

      await convertMidToWavAsync(midPath, wavPath);

      if (fs.existsSync(wavPath)) {
        const durationSec = getWavDurationSec(wavPath);
        const isMain = /^Main\s+[ABCD]$/i.test(section.sectionName);
        const isFill = /^Fill In\s+[ABCD]{2}$/i.test(section.sectionName);
        const isIntro = /^Intro\s+[ABCD]$/i.test(section.sectionName);
        const isEnding = /^Ending\s+[ABCD]$/i.test(section.sectionName);

        return {
          section: section.sectionName,
          loop: !!isMain,
          oneShot: !!(isFill || isIntro || isEnding),
          midFilename: section.midFilename,
          midiUrl: `${baseUrl}/temp/${path.basename(section.midFilename)}`,
          wavUrl: `${baseUrl}/temp/${path.basename(wavPath)}`,
          durationSec
        };
      }
      return null;
    });

    const sectionsWithWav = (await Promise.all(conversionPromises)).filter(Boolean);

    const fillMap = {
      'Main A': 'Fill In AA',
      'Main B': 'Fill In BB',
      'Main C': 'Fill In CC',
      'Main D': 'Fill In DD'
    };

    const manifest = {
      beatId,
      tempoFactorDefault: 1.0,
      sections: sectionsWithWav,
      fillMap
    };

    return res.json(manifest);
  } catch (err) {
    console.error('❌ Erreur serveur (prepare-all-sections) :', err);
    return res.status(500).json({ error: 'Erreur serveur interne lors de la préparation des sections' });
  }
});


// --- NOUVEAU : endpoint manifest simple en GET (pratique pour (re)charger côté front) ---
router.get('/sequencer-manifest', async (req, res) => {
  const beatId = parseInt(req.query.beatId, 10);
  if (!beatId) return res.status(400).json({ error: 'beatId requis' });

  // Réutilise la logique de /prepare-all-sections mais sans relancer l’extraction/convert si déjà présents
  try {
    const baseUrl = publicBaseUrl(req);
    const files = await fs.promises.readdir(TEMP_DIR);

    // Détecte sections déjà extraites (mid + wav)
    const mains = ['A','B','C','D'];
    const families = [
      ...mains.map(l => `Main ${l}`),
      ...mains.map(l => `Fill In ${l}${l}`),
      ...mains.map(l => `Intro ${l}`),
      ...mains.map(l => `Ending ${l}`)
    ];

    const sections = [];
    for (const fam of families) {
      const safe = fam.replace(/\s+/g, '_');
      // Nom potentiels créés par ton script python: "<beatId>_<safe>.mid"
      const midName = `${beatId}_${safe}.mid`;
      const wavName = `${beatId}_${safe}.wav`;
      const midPath = path.join(TEMP_DIR, midName);
      const wavPath = path.join(TEMP_DIR, wavName);
      if (fs.existsSync(midPath) && fs.existsSync(wavPath)) {
        const durationSec = getWavDurationSec(wavPath);
        const isMain = /^Main\s+[ABCD]$/i.test(fam);
        const isFill = /^Fill In\s+[ABCD]{2}$/i.test(fam);
        const isIntro = /^Intro\s+[ABCD]$/i.test(fam);
        const isEnding = /^Ending\s+[ABCD]$/i.test(fam);

        sections.push({
          section: fam,
          loop: !!isMain,
          oneShot: !!(isFill || isIntro || isEnding),
          midFilename: midName,
          midiUrl: `${baseUrl}/temp/${midName}`,
          wavUrl: `${baseUrl}/temp/${wavName}`,
          durationSec
        });
      }
    }

    const fillMap = {
      'Main A': 'Fill In AA',
      'Main B': 'Fill In BB',
      'Main C': 'Fill In CC',
      'Main D': 'Fill In DD'
    };

    return res.json({
      beatId,
      tempoFactorDefault: 1.0,
      sections,
      fillMap
    });
  } catch (err) {
    console.error('❌ Erreur /sequencer-manifest :', err);
    return res.status(500).json({ error: 'Erreur lors de la construction du manifest' });
  }
});

module.exports = router;
