const express = require('express');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { spawnSync, execSync, spawn } = require('child_process');
const { PrismaClient } = require('@prisma/client');
const router = express.Router();
const prisma = new PrismaClient();
const { createClient } = require('@supabase/supabase-js');

console.log("🚀 routes/player.js chargé");

// ===== DEBUG HELPERS =====
const DEBUG_SYNTH = (process.env.DEBUG_SYNTH || '1') !== '0';

function quoteArg(a) {
  const s = String(a);
  return /[\s"'$`\\]/.test(s) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s;
}
function fmtCmd(bin, args) {
  return [bin, ...args.map(quoteArg)].join(' ');
}
function fileInfo(p) {
  try {
    const st = fs.statSync(p);
    return `${p} (${st.size} bytes)`;
  } catch {
    return `${p} (missing)`;
  }
}

// Chemins / binaires
const TEMP_DIR = path.join(__dirname, '..', 'temp');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

const FFPROBE_EXE = 'ffprobe';
const FFMPEG_EXE = process.env.FFMPEG_PATH || 'ffmpeg';
const SF2_PATH = process.env.SF2_PATH || path.join(__dirname, '..', 'soundfonts', 'Yamaha_PSR.sf2');
const TIMIDITY_EXE = 'timidity'; // TiMidity only

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

/* ──────────────────────────────────────────────────────────────
   Normalisation MIDI au tick 0 (tempo/TS + Bank/Program hors drums)
   ────────────────────────────────────────────────────────────── */
function normalizeSectionInplace(sectionMidPath) {
  const pyCode = `
import sys
from mido import MidiFile, MidiTrack, Message, MetaMessage

DRUMS = {9, 10}  # 0-based (CH10/CH11 humain)

sec_path = sys.argv[1]
mf = MidiFile(sec_path)
tpb = mf.ticks_per_beat

first_cc0, first_cc32, first_pc = {}, {}, {}
first_tempo = None
first_ts = None

for tr in mf.tracks:
    for msg in tr:
        if msg.is_meta:
            if first_tempo is None and msg.type == 'set_tempo':
                first_tempo = msg
            if first_ts is None and msg.type == 'time_signature':
                first_ts = msg
            continue
        if hasattr(msg, 'channel'):
            ch = msg.channel
            if msg.type == 'control_change':
                if ch not in DRUMS:
                    if msg.control == 0 and ch not in first_cc0:
                        first_cc0[ch] = msg.value
                    elif msg.control == 32 and ch not in first_cc32:
                        first_cc32[ch] = msg.value
            elif msg.type == 'program_change' and ch not in DRUMS and ch not in first_pc:
                first_pc[ch] = msg.program

setup = MidiTrack()
if first_tempo:
    setup.append(MetaMessage('set_tempo', tempo=first_tempo.tempo, time=0))
if first_ts:
    setup.append(MetaMessage('time_signature',
                             numerator=first_ts.numerator,
                             denominator=first_ts.denominator,
                             clocks_per_click=getattr(first_ts, 'clocks_per_click', 24),
                             notated_32nd_notes_per_beat=getattr(first_ts, 'notated_32nd_notes_per_beat', 8),
                             time=0))

for ch in sorted(set(first_cc0) | set(first_cc32) | set(first_pc)):
    if ch in DRUMS:
        continue
    msb = first_cc0.get(ch, None)
    lsb = first_cc32.get(ch, None)
    pc  = first_pc.get(ch, None)
    if msb is not None:
        setup.append(Message('control_change', channel=ch, control=0, value=msb, time=0))
    if lsb is not None:
        setup.append(Message('control_change', channel=ch, control=32, value=lsb, time=0))
    if pc is not None:
        setup.append(Message('program_change', channel=ch, program=pc, time=0))

new_mf = MidiFile(ticks_per_beat=tpb)
new_mf.tracks.append(setup)
for tr in mf.tracks:
    nt = MidiTrack()
    for msg in tr:
        nt.append(msg.copy())
    new_mf.tracks.append(nt)

new_mf.save(sec_path)
print("normalized_no_drums_bank:", sec_path)
`;
  const out = spawnSync('python3', ['-c', pyCode, sectionMidPath], { encoding: 'utf-8' });
  if (DEBUG_SYNTH) {
    console.log('🧰 normalizeSection stdout:', (out.stdout || '').trim());
    if (out.stderr?.trim()) console.warn('🧰 normalizeSection stderr:', out.stderr.trim());
  }
}

// (facultatif) mini dump pour debugger le head d’un MIDI
function dumpMidiHead(midPath, maxEventsPerTrack = 40) {
  const py = `
import sys, json
from mido import MidiFile
mf = MidiFile(sys.argv[1])
out = []
for ti, tr in enumerate(mf.tracks):
    cur = []
    t=0
    for i, m in enumerate(tr):
        t += m.time
        if i> ${maxEventsPerTrack}: break
        row = {'t':t, 'type': m.type}
        if not m.is_meta and hasattr(m,'channel'): row['ch']=m.channel
        if m.type=='control_change': row.update({'cc': m.control, 'val': m.value})
        if m.type=='program_change': row.update({'prog': m.program})
        if m.type=='note_on': row.update({'note': m.note, 'vel': m.velocity})
        if m.type=='time_signature': row.update({'num': m.numerator, 'den': m.denominator})
        if m.type=='set_tempo': row.update({'tempo': m.tempo})
        cur.append(row)
    out.append(cur)
print(json.dumps(out))
`;
  const out = spawnSync('python3', ['-c', py, midPath], { encoding: 'utf-8' });
  try { console.log('📝 MIDI HEAD =', JSON.parse(out.stdout)); } catch {}
}

/* ──────────────────────────────────────────────────────────────
   Lecture du tempo / signature depuis le MIDI (Python)
   ────────────────────────────────────────────────────────────── */
function readMidiMeta(midPath) {
  const py = `
from mido import MidiFile, tempo2bpm
import json, sys
mf = MidiFile(sys.argv[1])
bpm = 120.0
num, den = 4, 4
for tr in mf.tracks:
  for m in tr:
    if m.is_meta and m.type == 'set_tempo':
      bpm = float(tempo2bpm(m.tempo))
      break
for tr in mf.tracks:
  for m in tr:
    if m.is_meta and m.type == 'time_signature':
      num, den = m.numerator, m.denominator
      break
print(json.dumps({"bpm": bpm, "ts_num": num, "ts_den": den}))
`;
  const out = spawnSync('python3', ['-c', py, midPath], { encoding: 'utf-8' });
  if (out.status !== 0) {
    console.warn('⚠️ readMidiMeta stderr:', out.stderr);
    return { bpm: 120, ts_num: 4, ts_den: 4 };
  }
  try {
    const j = JSON.parse(String(out.stdout).trim());
    return {
      bpm: Number(j.bpm) || 120,
      ts_num: parseInt(j.ts_num) || 4,
      ts_den: parseInt(j.ts_den) || 4
    };
  } catch {
    return { bpm: 120, ts_num: 4, ts_den: 4 };
  }
}

/* ──────────────────────────────────────────────────────────────
   Quantification de durée sur un nombre ENTIER de mesures
   ────────────────────────────────────────────────────────────── */
function quantizeDurationToBars(rawSeconds, bpm, ts_num) {
  const bar = (60 / (bpm || 120)) * (ts_num || 4);
  if (!isFinite(bar) || bar <= 0) return rawSeconds;
  const bars = Math.max(1, Math.round(rawSeconds / bar));
  return bars * bar;
}

// --- Durée d’un WAV (pour debug éventuel) ---
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

// Lit la durée MIDI (en s) du .mid (via python + mido)
function getMidiDurationSec(midPath) {
  try {
    const code = 'from mido import MidiFile; import sys; print(MidiFile(sys.argv[1]).length)';
    const out = spawnSync('python3', ['-c', code, midPath], { encoding: 'utf-8' });
    if (out.status === 0) {
      const v = parseFloat(String(out.stdout).trim());
      return Number.isFinite(v) ? v : null;
    }
    console.error('getMidiDurationSec stderr:', out.stderr);
  } catch (e) {
    console.error('getMidiDurationSec error:', e);
  }
  return null;
}

// ---------- TiMidity: forçage strict de l'utilisation DU SF2 ----------
function makeTimidityCfg(sf2Path) {
  const cfg = `soundfont "${String(sf2Path).replace(/"/g, '\\"')}"\n`; // cfg minimal SANS include/source
  const cfgPath = path.join(TEMP_DIR, `timidity_${Date.now()}_${Math.random().toString(36).slice(2)}.cfg`);
  fs.writeFileSync(cfgPath, cfg, 'utf-8');
  return cfgPath;
}

function renderWithTimidity(midPath, wavPath, sf2Path, sampleRate = '44100') {
  const mid = path.resolve(midPath);
  const wav = path.resolve(wavPath);
  const sf2 = path.resolve(sf2Path);
  const cfgPath = makeTimidityCfg(sf2);

  const args = [
    '-c', cfgPath,
    '-Ow', '-o', wav,
    '-s', String(sampleRate),
    '-EFchorus=0', '-EFreverb=0',
    '-v',
    mid
  ];
  const env = { ...process.env, TIMIDITY_CFG: cfgPath };

  if (DEBUG_SYNTH) console.log('🔧 CMD timidity:', fmtCmd(TIMIDITY_EXE, args), '\nENV.TIMIDITY_CFG=', env.TIMIDITY_CFG);
  const proc = spawnSync(TIMIDITY_EXE, args, { encoding: 'utf-8', env });

  if (proc.stdout?.trim()) console.log('📄 timidity stdout:', proc.stdout.trim());
  if (proc.stderr?.trim()) console.warn('⚠️ timidity stderr:', proc.stderr.trim());

  const combined = (proc.stdout || '') + '\n' + (proc.stderr || '');
  const sf2Base = path.basename(sf2);
  if (proc.status !== 0 || !fs.existsSync(wav) || !combined.includes(sf2Base)) {
    try { fs.unlinkSync(cfgPath); } catch {}
    throw new Error(`TiMidity n'a pas confirmé l'utilisation de ${sf2Base} (fallback interdit). Code=${proc.status}`);
  }

  try { fs.unlinkSync(cfgPath); } catch {}
}

/* ──────────────────────────────────────────────────────────────
   🎯 CONVERSION ⇒ TiMidity forcé + trim ffmpeg
   ────────────────────────────────────────────────────────────── */
function convertMidToWav(midPath, wavPath) {
  console.log('🎶 Conversion via TiMidity (FORCÉ, cfg minimal)');
  console.log('📄 MID :', fileInfo(midPath));
  console.log('🎹 SF2 :', fileInfo(SF2_PATH));
  if (!fs.existsSync(SF2_PATH)) {
    throw new Error(`SoundFont introuvable: ${SF2_PATH}`);
  }

  const preTrimWav = wavPath.replace(/\.wav$/i, '_pretrim.wav');
  const sr = process.env.RENDER_SR || '44100';

  renderWithTimidity(midPath, preTrimWav, SF2_PATH, sr);

  const filter =
    'areverse,' +
    'silenceremove=start_periods=1:start_silence=0.35:start_threshold=-50dB,' +
    'areverse,' +
    'silenceremove=start_periods=1:start_silence=0.02:start_threshold=-40dB';

  const fArgs2 = ['-y','-i', preTrimWav, '-af', filter, '-acodec','pcm_s16le','-ar', sr, wavPath];
  if (DEBUG_SYNTH) console.log('🔧 CMD (ffmpeg trim):', fmtCmd(FFMPEG_EXE, fArgs2));
  const f = spawnSync(FFMPEG_EXE, fArgs2, { encoding: 'utf-8' });
  try { fs.unlinkSync(preTrimWav); } catch {}
  if (f.status !== 0 || !fs.existsSync(wavPath)) {
    throw new Error(`ffmpeg trimming a échoué (${f.status ?? 'n/a'})`);
  }

  console.log(`✅ Conversion + hard trim OK →`, fileInfo(wavPath));
}

function convertMidToWavAsync(midPath, wavPath) {
  return new Promise((resolve, reject) => {
    console.log('🎶 Conversion via TiMidity (async, FORCÉ, cfg minimal)');
    console.log('📄 MID :', fileInfo(midPath));
    console.log('🎹 SF2 :', fileInfo(SF2_PATH));
    if (!fs.existsSync(SF2_PATH)) return reject(new Error(`SoundFont introuvable: ${SF2_PATH}`));

    const preTrimWav = wavPath.replace(/\.wav$/i, '_pretrim.wav');
    const sr = process.env.RENDER_SR || '44100';

    try {
      renderWithTimidity(midPath, preTrimWav, SF2_PATH, sr);
    } catch (e) {
      return reject(e);
    }

    const filter =
      'areverse,' +
      'silenceremove=start_periods=1:start_silence=0.35:start_threshold=-50dB,' +
      'areverse,' +
      'silenceremove=start_periods=1:start_silence=0.02:start_threshold=-40dB';
    const fArgs = ['-y','-i', preTrimWav, '-af', filter, '-acodec','pcm_s16le','-ar', sr, wavPath];
    if (DEBUG_SYNTH) console.log('🔧 CMD (ffmpeg trim):', fmtCmd(FFMPEG_EXE, fArgs));

    const ff = spawn(FFMPEG_EXE, fArgs, { encoding: 'utf-8' });
    let fe = '';
    ff.stderr?.on('data', d => fe += d.toString());
    ff.on('error', reject);
    ff.on('close', c => {
      try { fs.unlinkSync(preTrimWav); } catch {}
      if (c !== 0 || !fs.existsSync(wavPath)) {
        return reject(new Error(`ffmpeg exit ${c}: ${fe}`));
      }
      console.log(`✅ Conversion + hard trim OK →`, fileInfo(wavPath));
      resolve();
    });
  });
}

// Coupe le WAV exactement à la durée souhaitée (petite marge anti-click)
const TAIL_EARLY_MS = 0.000;
function hardTrimToDuration(wavPath, seconds) {
  const out = wavPath.replace(/\.wav$/i, '.tight.wav');
  const target = Math.max(0, Number(seconds) - TAIL_EARLY_MS);
  const args = ['-y', '-i', wavPath, '-t', `${target}`, '-acodec', 'pcm_s16le', '-ar', '44100', out];
  const p = spawnSync(FFMPEG_EXE, args, { encoding: 'utf-8' });
  if (p.status !== 0) {
    console.error('ffmpeg -t stderr:', p.stderr);
    throw new Error('hardTrimToDuration failed');
  }
  fs.renameSync(out, wavPath);
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

    // 💡 Injecte tempo/TS + Bank/Program hors drums (9 & 10)
    normalizeSectionInplace(rawMidPath);

    let duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      duration = getMidiDurationSec(rawMidPath);
    }

    if (!fs.existsSync(rawMidPath)) {
      return res.status(500).json({ error: 'Fichier MIDI extrait manquant après extraction' });
    }

    const wavPath = path.join(TEMP_DIR, `${beatId}_main_${mainLetter}.wav`);
    convertMidToWav(rawMidPath, wavPath);
    if (!fs.existsSync(wavPath)) {
      return res.status(500).json({ error: 'Fichier WAV manquant après conversion' });
    }

    // 🔁 Quantifie la durée au nombre ENTIER de mesures
    const meta = readMidiMeta(rawMidPath);
    const targetSec = quantizeDurationToBars(duration || getMidiDurationSec(rawMidPath) || getWavDurationSec(wavPath), meta.bpm, meta.ts_num);
    if (targetSec && targetSec > 0) hardTrimToDuration(wavPath, targetSec);

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
    return res.status(500).json({ error: 'Impossible de lire le dossier temp' });
  }
});

// --- Préparation + manifest séquenceur (gapless & transitions) ---

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    // 1️⃣ Télécharger le .sty
    const inputStyPath = path.join(UPLOAD_DIR, beat.filename);
    await downloadStyFromUrl(beat.url, inputStyPath);

    // 2️⃣ Extraire le MIDI complet
    const fullMidPath = path.join(TEMP_DIR, `${beatId}_full.mid`);
    extractMidiFromSty(inputStyPath, fullMidPath);

    // 3️⃣ Extraire toutes les sections via le script Python
    const pythonScript = path.join(__dirname, '../scripts/extract_all_sections.py');
    const stdout = execSync(`python3 ${pythonScript} "${fullMidPath}" "${TEMP_DIR}"`, { encoding: 'utf-8' });
    const pyJson = JSON.parse(stdout.trim());

    const sectionsArray = Array.isArray(pyJson.sections) ? pyJson.sections : [];
    const uploadResults = [];

    // Métadonnées globales
    let globalBpm = beat.tempo || 120;
    let globalTsNum = 4, globalTsDen = 4;

    // 4️⃣ Conversion + Upload Supabase
    for (const section of sectionsArray) {
      const midPath = path.join(TEMP_DIR, section.midFilename);

      normalizeSectionInplace(midPath);

      const wavPath = midPath.replace(/\.mid$/i, '.wav');

      const meta = readMidiMeta(midPath);
      if (!globalBpm) globalBpm = meta.bpm;
      if (globalTsNum === 4 && globalTsDen === 4) { globalTsNum = meta.ts_num; globalTsDen = meta.ts_den; }

      await convertMidToWavAsync(midPath, wavPath);
      if (!fs.existsSync(wavPath)) continue;

      const midiDur = getMidiDurationSec(midPath);
      const targetSec = quantizeDurationToBars(midiDur || getWavDurationSec(wavPath), meta.bpm, meta.ts_num);
      if (targetSec && targetSec > 0) hardTrimToDuration(wavPath, targetSec);

      const durationSec = getWavDurationSec(wavPath);

      // Upload MIDI
      const midBuffer = fs.readFileSync(midPath);
      const { error: midErr } = await supabase
        .storage
        .from('midiAndWav')
        .upload(`${beatId}/${section.midFilename}`, midBuffer, { cacheControl: '3600', upsert: true });
      if (midErr) console.error(`Erreur upload MID ${section.midFilename}:`, midErr);

      // Upload WAV
      const wavBuffer = fs.readFileSync(wavPath);
      const { error: wavErr } = await supabase
        .storage
        .from('midiAndWav')
        .upload(`${beatId}/${path.basename(wavPath)}`, wavBuffer, { cacheControl: '3600', upsert: true });
      if (wavErr) console.error(`Erreur upload WAV ${path.basename(wavPath)}:`, wavErr);

      uploadResults.push({
        section: section.sectionName,
        loop: /^Main\s+[ABCD]$/i.test(section.sectionName),
        oneShot: /^(Fill In\s+[ABCD]{2}|Intro\s+[ABCD]|Ending\s+[ABCD])$/i.test(section.sectionName),
        midFilename: section.midFilename,
        midiUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/midiAndWav/${beatId}/${section.midFilename}`,
        wavFilename: path.basename(wavPath),
        wavUrl: `${process.env.SUPABASE_URL}/storage/v1/object/public/midiAndWav/${beatId}/${path.basename(wavPath)}`,
        durationSec,
        bpm: meta.bpm,
        beatsPerBar: meta.ts_num
      });
    }

    const fillMap = {
      'Main A': 'Fill In AA',
      'Main B': 'Fill In BB',
      'Main C': 'Fill In CC',
      'Main D': 'Fill In DD'
    };

    const barDurSec = (60 / (globalBpm || 120)) * (globalTsNum || 4);

    const manifest = {
      beatId,
      baseTempoBpm: globalBpm,
      beatsPerBar: globalTsNum,
      barDurSec,
      quantizeLeadMs: 12,
      tempoFactorDefault: 1.0,
      sections: uploadResults,
      fillMap
    };

    return res.json(manifest);
  } catch (err) {
    console.error('❌ Erreur serveur (prepare-all-sections) :', err);
    return res.status(500).json({ error: 'Erreur serveur interne lors de la préparation des sections' });
  }
});

// --- endpoint manifest simple en GET ---
router.get('/sequencer-manifest', async (req, res) => {
  const beatId = parseInt(req.query.beatId, 10);
  if (!beatId) return res.status(400).json({ error: 'beatId requis' });

  try {
    const baseUrl = publicBaseUrl(req);
    const files = await fs.promises.readdir(TEMP_DIR);

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
