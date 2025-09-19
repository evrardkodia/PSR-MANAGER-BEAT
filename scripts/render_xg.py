# scripts/render_xg.py
import argparse, tempfile, os, subprocess, sys, json, shutil
from collections import defaultdict
from mido import MidiFile, MidiTrack, Message

# ──────────────────────────────────────────────────────────────
# Utilitaires de log
# ──────────────────────────────────────────────────────────────
def log_info(*a):  print("ℹ️", *a, file=sys.stderr, flush=True)
def log_ok(*a):    print("✅", *a, file=sys.stderr, flush=True)
def log_warn(*a):  print("⚠️", *a, file=sys.stderr, flush=True)
def log_err(*a):   print("❌", *a, file=sys.stderr, flush=True)

def which(binname):
    return shutil.which(binname)

def run_and_log(cmd, check=False):
    log_info("CMD:", " ".join([f'"{c}"' if " " in c else c for c in cmd]))
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = (proc.stdout or b"").decode(errors="ignore")
    err = (proc.stderr or b"").decode(errors="ignore")
    if out.strip():
        lines = out.strip().splitlines()
        log_info("stdout:", "\n".join(lines[-15:]))
    if err.strip():
        lines = err.strip().splitlines()
        log_info("stderr:", "\n".join(lines[-20:]))
    if check and proc.returncode != 0:
        log_err("exit code:", proc.returncode)
        raise subprocess.CalledProcessError(proc.returncode, cmd, output=proc.stdout, stderr=proc.stderr)
    return proc

# SysEx "XG System On" (Yamaha)
XG_ON = bytes([0xF0, 0x43, 0x10, 0x4C, 0x00, 0x00, 0x7E, 0x00, 0xF7])

# ──────────────────────────────────────────────────────────────
# Préparation XG / banques & programmes
# ──────────────────────────────────────────────────────────────
def ensure_xg_setup(mf: MidiFile, reverb=40, chorus=0, pb_range=2) -> MidiFile:
    """XG System On + défauts utiles. Ne force pas les drums ici (on le fera juste après, de façon explicite)."""
    setup = MidiTrack()
    setup.append(Message('sysex', data=XG_ON[1:-1], time=0))
    for ch in range(16):
        setup.append(Message('control_change', channel=ch, control=7,  value=100, time=0))
        setup.append(Message('control_change', channel=ch, control=10, value=64,  time=0))
        setup.append(Message('control_change', channel=ch, control=11, value=127, time=0))
        setup.append(Message('control_change', channel=ch, control=91, value=int(reverb), time=0))
        setup.append(Message('control_change', channel=ch, control=93, value=int(chorus), time=0))
        # RPN Pitch Bend Range = pb_range
        setup.append(Message('control_change', channel=ch, control=101, value=0, time=0))
        setup.append(Message('control_change', channel=ch, control=100, value=0, time=0))
        setup.append(Message('control_change', channel=ch, control=6,   value=int(pb_range), time=0))
        setup.append(Message('control_change', channel=ch, control=38,  value=0, time=0))
        setup.append(Message('control_change', channel=ch, control=101, value=127, time=0))
        setup.append(Message('control_change', channel=ch, control=100, value=127, time=0))
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    out.tracks.append(setup)
    for tr in mf.tracks:
        nt = MidiTrack();  [nt.append(m.copy()) for m in tr]
        out.tracks.append(nt)
    return out

def collect_first_bank_pc(mf: MidiFile):
    cc0, cc32, pc = {}, {}, {}
    for tr in mf.tracks:
        for m in tr:
            if m.is_meta or not hasattr(m, 'channel'):
                continue
            ch = m.channel
            if m.type == 'control_change':
                if m.control == 0  and ch not in cc0:  cc0[ch]  = m.value
                if m.control == 32 and ch not in cc32: cc32[ch] = m.value
            elif m.type == 'program_change' and ch not in pc:
                pc[ch] = m.program
    return cc0, cc32, pc

def reemit_banks_programs_at_zero(mf: MidiFile) -> MidiFile:
    """Réémet CC0→CC32→PC pour chaque canal à t=0 (dans le bon ordre)."""
    cc0, cc32, pc = collect_first_bank_pc(mf)
    for ch in range(16):
        msb, lsb, prg = cc0.get(ch), cc32.get(ch), pc.get(ch)
        if msb is not None or lsb is not None or prg is not None:
            log_info(f"CH{ch+1:02d} init: MSB={msb} LSB={lsb} PC={prg}")
    setup = MidiTrack()
    for ch in range(16):
        msb, lsb, prg = cc0.get(ch), cc32.get(ch), pc.get(ch)
        if msb is not None: setup.append(Message('control_change', channel=ch, control=0,  value=msb, time=0))
        if lsb is not None: setup.append(Message('control_change', channel=ch, control=32, value=lsb, time=0))
        if prg is not None: setup.append(Message('program_change',  channel=ch, program=prg, time=0))
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    out.tracks.append(setup)
    for tr in mf.tracks:
        nt = MidiTrack();  [nt.append(m.copy()) for m in tr]
        out.tracks.append(nt)
    return out

def force_drums_kit_at_zero(mf: MidiFile, drum_channels=(9,10), msb=0, lsb=127, program=0) -> MidiFile:
    """Force le kit batterie au tick 0 (banque 0/127, PC 0) sur les canaux drums indiqués."""
    setup = MidiTrack()
    for ch in drum_channels:
        if 0 <= ch <= 15:
            setup.append(Message('control_change', channel=ch, control=0,  value=msb, time=0))
            setup.append(Message('control_change', channel=ch, control=32, value=lsb, time=0))
            setup.append(Message('program_change',  channel=ch, program=program, time=0))
            log_info(f"CH{ch+1:02d} DRUM KIT forcé: MSB={msb} LSB={lsb} PC={program}")
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    out.tracks.append(setup)
    for tr in mf.tracks:
        nt = MidiTrack();  [nt.append(m.copy()) for m in tr]
        out.tracks.append(nt)
    return out

def block_later_bank_prog_on_drums(mf: MidiFile, drum_channels=(9,10)) -> MidiFile:
    """Supprime tout CC0/CC32/Program Change postérieurs sur les canaux drums (on garde seulement ce qu’on a mis à t=0)."""
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    for tr in mf.tracks:
        nt = MidiTrack()
        first_tick = True
        cur_time = 0
        for m in tr:
            cur_time += getattr(m, 'time', 0)
            if not m.is_meta and hasattr(m, 'channel') and m.channel in drum_channels:
                if m.type == 'control_change' and m.control in (0, 32):
                    if cur_time > 0:
                        # on bloque
                        continue
                if m.type == 'program_change' and cur_time > 0:
                    continue
            nt.append(m.copy())
            first_tick = False
        out.tracks.append(nt)
    log_ok(f"Bloquage des CC0/32/PC ultérieurs sur drums {drum_channels}")
    return out

# ──────────────────────────────────────────────────────────────
# Stats & Remap drums (facultatif)
# ──────────────────────────────────────────────────────────────
def drum_notes_stats(mf: MidiFile, drum_channels=(9,10)):
    used = defaultdict(int)
    for tr in mf.tracks:
        for m in tr:
            if getattr(m, 'type', '') == 'note_on' and getattr(m, 'velocity', 0) > 0 and getattr(m, 'channel', -1) in drum_channels:
                used[m.note] += 1
    if used:
        top = sorted(used.items(), key=lambda kv: (-kv[1], kv[0]))
        show = ", ".join([f"{n}({c})" for n, c in top[:50]])
        log_info("Notes drums rencontrées:", show)
    else:
        log_info("Aucune note rencontrée sur canaux drums", drum_channels)

def load_xg_remap_table(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
        table = {int(k): int(v) for k, v in raw.items()}
        log_ok(f"Remap XG→GM chargé ({len(table)} entrées) depuis {path}")
        return table
    except FileNotFoundError:
        return {}
    except Exception as e:
        log_warn(f"Remap ignoré ({e})");  return {}

def apply_drum_note_remap(mf: MidiFile, mapping, drum_channels=(9,10)) -> MidiFile:
    if not mapping: return mf
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    for tr in mf.tracks:
        nt = MidiTrack()
        for m in tr:
            msg = m.copy()
            if getattr(msg, 'type', '') in ('note_on','note_off') and getattr(msg, 'channel', -1) in drum_channels:
                old = msg.note;  new = mapping.get(old, old)
                if new != old: msg.note = new
            nt.append(msg)
        out.tracks.append(nt)
    log_ok(f"Remap XG→GM appliqué (taille table: {len(mapping)}) sur drums {drum_channels}")
    return out

# ──────────────────────────────────────────────────────────────
# Moteurs de rendu
# ──────────────────────────────────────────────────────────────
def run_fluidsynth(sf2, mid, wav, sr=44100, enable_reverb=False, enable_chorus=False, extra_opts=None):
    if which('fluidsynth') is None:
        log_warn("fluidsynth introuvable");  return subprocess.CompletedProcess(args=[], returncode=127)
    args = [
        'fluidsynth','-ni',
        '-a','file','-F', wav, '-T','wav',
        '-r', str(sr), '-g','1.0',
        '-o','synth.dynamic-sample-loading=1',
        '-o',f'synth.reverb.active={"1" if enable_reverb else "0"}',
        '-o',f'synth.chorus.active={"1" if enable_chorus else "0"}',
        sf2, mid
    ]
    if extra_opts: args += list(extra_opts)
    return run_and_log(args)

def run_timidity(sf2, mid, wav, sr=44100, map_127_to_128=True):
    if which('timidity') is None:
        log_warn("timidity introuvable");  return subprocess.CompletedProcess(args=[], returncode=127)
    cfg_lines = [f"soundfont {sf2}\n"]
    if map_127_to_128:
        for prog in range(128):
            cfg_lines.append(f"map 127 {prog} 128 {prog}\n")
    cfg = "".join(cfg_lines)
    with tempfile.NamedTemporaryFile('w', suffix='.cfg', delete=False, encoding='utf-8') as f:
        f.write(cfg);  cfg_path = f.name
    env = os.environ.copy();  env['TIMIDITY_CFG'] = cfg_path
    args = ['timidity','-c', cfg_path, '-Ow','-s', str(sr), '-o', wav, '-EFreverb=0','-EFchorus=0', mid]
    try:
        proc = run_and_log(args)
    finally:
        try: os.remove(cfg_path)
        except: pass
    return proc

# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="Rendu WAV fidèle au SF2, verrouillage strict des drums et des banques.")
    ap.add_argument('midi_in');  ap.add_argument('wav_out')
    ap.add_argument('--sf2', required=True)
    ap.add_argument('--sr', type=int, default=44100)
    ap.add_argument('--engine', choices=['auto','fluidsynth','timidity'], default='auto')
    ap.add_argument('--no-xg', action='store_true')
    ap.add_argument('--no-reemit', action='store_true')
    ap.add_argument('--drums', default='9,10', help="Canaux drums (ex: '9,10' ou '10' ou '').")
    ap.add_argument('--reverb', type=int, default=40);  ap.add_argument('--chorus', type=int, default=0)
    ap.add_argument('--pb', type=int, default=2)
    ap.add_argument('--fs-reverb', action='store_true');  ap.add_argument('--fs-chorus', action='store_true')
    ap.add_argument('--xg-remap-json', default=os.path.join(os.path.dirname(__file__),'xg_drum_remap.json'))
    ap.add_argument('--no-ffmpeg-fix', action='store_true')
    args = ap.parse_args()

    if not os.path.isfile(args.midi_in): log_err("MIDI introuvable:", args.midi_in); sys.exit(2)
    if not os.path.isfile(args.sf2):     log_err("SF2 introuvable:", args.sf2);    sys.exit(2)

    # Parse drums
    drums_channels = tuple(int(x) for x in args.drums.split(',') if x.strip().isdigit())

    log_info("MIDI :", args.midi_in);  log_info("SF2  :", args.sf2)
    log_info("WAV  :", args.wav_out);  log_info("SR   :", args.sr)
    log_info("Eng  :", args.engine);   log_info("Drums:", drums_channels if drums_channels else "(aucun)")

    # Charger & préparer
    try: mf = MidiFile(args.midi_in)
    except Exception as e: log_err("Lecture MIDI:", e); sys.exit(3)

    if not args.no_xg:
        mf = ensure_xg_setup(mf, reverb=args.reverb, chorus=args.chorus, pb_range=args.pb)

    # Réémettre banques/programmes (ordre correct)
    if not args.no_reemit:
        mf = reemit_banks_programs_at_zero(mf)

    # Verrouiller les drums: forcer kit + bloquer toute modif ultérieure (banque / PC)
    if drums_channels:
        mf = force_drums_kit_at_zero(mf, drum_channels=drums_channels, msb=0, lsb=127, program=0)
        mf = block_later_bank_prog_on_drums(mf, drum_channels=drums_channels)

    # Stats & remap optionnel
    drum_notes_stats(mf, drum_channels=drums_channels if drums_channels else (9,10))
    mapping = load_xg_remap_table(args.xg_remap_json)
    if mapping:
        mf = apply_drum_note_remap(mf, mapping, drum_channels=drums_channels if drums_channels else (9,10))

    # Sauvegarde MIDI temporaire
    fd, mid_fixed = tempfile.mkstemp(suffix='_xg.mid'); os.close(fd)
    try:
        mf.save(mid_fixed);  log_ok("MIDI préparé:", mid_fixed)
    except Exception as e:
        log_err("Sauvegarde MIDI préparé:", e); sys.exit(4)

    # Rendu
    proc = None
    if args.engine in ('auto','fluidsynth'):
        log_info("Essai FluidSynth…")
        p = run_fluidsynth(args.sf2, mid_fixed, args.wav_out, sr=args.sr,
                           enable_reverb=args.fs_reverb, enable_chorus=args.fs_chorus)
        if p.returncode == 0 and os.path.isfile(args.wav_out):
            proc = p
        else:
            log_warn("FluidSynth KO, fallback TiMidity…")

    if proc is None:
        proc = run_timidity(args.sf2, mid_fixed, args.wav_out, sr=args.sr)

    try: os.remove(mid_fixed)
    except: pass

    if proc.returncode != 0 or not os.path.isfile(args.wav_out):
        log_err("Rendu audio échoué. Code:", proc.returncode); sys.exit(proc.returncode or 1)

    if not args.no_ffmpeg_fix:
        if which('ffmpeg') is None:
            log_warn("ffmpeg introuvable — pas de normalisation PCM 16-bit/44.1k")
        else:
            tmp = args.wav_out + ".tmp"
            try:
                run_and_log(['ffmpeg','-y','-i', args.wav_out, '-acodec','pcm_s16le','-ar', str(args.sr), tmp], check=True)
                os.replace(tmp, args.wav_out)
                log_ok("WAV normalisé PCM 16-bit/44.1k:", args.wav_out)
            except Exception as e:
                log_warn("Normalisation ffmpeg échouée, WAV brut conservé:", e)
    else:
        log_info("Normalisation ffmpeg désactivée")

    log_ok("Terminé:", args.wav_out)

if __name__ == '__main__':
    main()
