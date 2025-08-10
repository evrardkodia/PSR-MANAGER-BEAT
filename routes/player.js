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
const TIMIDITY_EXE = 'timidity';
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

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

  if (result.stdout?.trim()) {
    console.log('🐍 extract_main.py stdout:', result.stdout.trim());
  }

  if (result.stderr?.trim()) {
    console.error('🐍 extract_main.py stderr:', result.stderr.trim());
  }

  if (result.status !== 0) {
    throw new Error(`extract_main.py a échoué avec le code ${result.status}`);
  }

  return result.stdout;
}


function convertMidToWav(midPath, wavPath) {
  console.log('🎶 Conversion Timidity :', TIMIDITY_EXE, '-c', TIMIDITY_CFG_PATH, '-Ow', '--preserve-silence', '-A120', '-o', wavPath, midPath);
  const args = ['-c', TIMIDITY_CFG_PATH, '-Ow', '--preserve-silence', '-A120', '-o', wavPath, midPath];
  const convertProcess = spawnSync(TIMIDITY_EXE, args, { encoding: 'utf-8' });

  if (convertProcess.error) throw convertProcess.error;
  if (convertProcess.status !== 0) {
    console.error('❌ Timidity stderr:', convertProcess.stderr);
    throw new Error(`Timidity a échoué avec le code ${convertProcess.status}`);
  }
  console.log('✅ Conversion MIDI → WAV terminée');
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

// Routes

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
    // Récupérer beat dans la base
    const beat = await prisma.beat.findUnique({ where: { id: beatId } });
    if (!beat || !beat.url) {
      return res.status(404).json({ error: 'Beat ou URL introuvable' });
    }

    // Téléchargement fichier .sty
    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);
    await downloadStyFromUrl(beat.url, inputStyPath);

    // Extraction full MIDI
    const fullMidPath = path.join(TEMP_DIR, `${beatId}_full.mid`);
    extractMidiFromSty(inputStyPath, fullMidPath);

    // Lancer extract_sections.py pour lister sections
    const pyScript = path.join(SCRIPTS_DIR, 'extract_sections.py');
    const args = [pyScript, fullMidPath, TEMP_DIR];
    const result = spawnSync('python3', args, { encoding: 'utf-8' });

    if (result.error) throw result.error;
    if (result.stderr?.trim()) console.error('🐍 extract_sections.py stderr:', result.stderr.trim());
    if (result.status !== 0) {
      throw new Error(`extract_sections.py a échoué avec le code ${result.status}`);
    }

    console.log('🐍 extract_sections.py stdout:', result.stdout.trim());
    const sectionsJson = JSON.parse(result.stdout.trim());
    const sections = sectionsJson.sections || {};

    // Helper : transforme "Main A" → "main_a"
    function normalizeSectionName(name) {
      return name.toLowerCase().replace(/\s+/g, '_');
    }

    // Fonction pour générer un mid sectionné (synchrone)
    function generateMidSection(sectionName) {
      const outMid = path.join(TEMP_DIR, `${beatId}_${normalizeSectionName(sectionName)}.mid`);
      // La commande python avec option --section et --output (à adapter si nécessaire)
      const cmd = `python3 ${pyScript} --input "${fullMidPath}" --section "${sectionName}" --output "${outMid}"`;
      const execResult = spawnSync(cmd, { shell: true, encoding: 'utf-8' });
      if (execResult.error || execResult.status !== 0) {
        console.warn(`⚠️ Erreur extraction MIDI section ${sectionName}:`, execResult.stderr || execResult.error);
        return null;
      }
      return outMid;
    }

    // Fonction conversion mid → wav
    function convertMidToWav(midPath) {
      return new Promise((resolve, reject) => {
        const wavPath = midPath.replace(/\.mid$/i, '.wav');
        const cmd = `timidity "${midPath}" -Ow -o - | ffmpeg -y -i pipe: -ac 2 -ar 44100 "${wavPath}"`;
        exec(cmd, (error) => {
          if (error) {
            console.warn(`⚠️ Erreur conversion WAV pour ${midPath}:`, error);
            return reject(error);
          }
          resolve(wavPath);
        });
      });
    }

    // Générer tous les mid et wav pour sections actives
    const generatedWavs = {};
    for (const [sectionName, isActive] of Object.entries(sections)) {
      if (isActive) {
        const midFile = generateMidSection(sectionName);
        if (midFile) {
          try {
            const wavFile = await convertMidToWav(midFile);
            // Stockage url relative pour frontend (adapter selon static server)
            generatedWavs[normalizeSectionName(sectionName)] = `/temp/${path.basename(wavFile)}`;
          } catch {
            // erreur déjà loggée dans convertMidToWav
          }
        }
      }
    }

    // Déterminer wavUrl par défaut = premier main_a, main_b, main_c, main_d dispo
    const mainsOrder = ['main_a', 'main_b', 'main_c', 'main_d'];
    let defaultWavUrl = null;
    for (const m of mainsOrder) {
      if (generatedWavs[m]) {
        defaultWavUrl = generatedWavs[m];
        break;
      }
    }

    // Formater la liste sections avec clés normalisées (minuscules + underscore)
    const normalizedSections = {};
    for (const [key, val] of Object.entries(sections)) {
      normalizedSections[normalizeSectionName(key)] = val;
    }

    // Retourner la réponse complète
    return res.json({
      sections: normalizedSections,
      wavUrl: defaultWavUrl,
    });
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
