# scripts/render_xg.py
import argparse, tempfile, os, subprocess, sys, shutil, hashlib
from mido import MidiFile, MidiTrack, Message, MetaMessage

def log_info(*a):  print("ℹ️", *a, file=sys.stderr, flush=True)
def log_ok(*a):    print("✅", *a, file=sys.stderr, flush=True)
def log_warn(*a):  print("⚠️", *a, file=sys.stderr, flush=True)
def log_err(*a):   print("❌", *a, file=sys.stderr, flush=True)

def which(binname):
    return shutil.which(binname)

def run_and_log(cmd, check=False, env=None):
    log_info("CMD:", " ".join([f'"{c}"' if " " in c else c for c in cmd]))
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
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

XG_ON = bytes([0xF0, 0x43, 0x10, 0x4C, 0x00, 0x00, 0x7E, 0x00, 0xF7])

def ensure_xg_setup(mf: MidiFile, reverb=40, chorus=0, pb_range=2) -> MidiFile:
    setup = MidiTrack()
    setup.append(Message('sysex', data=XG_ON[1:-1], time=0))
    for ch in range(16):
        setup.append(Message('control_change', channel=ch, control=7,  value=100, time=0))
        setup.append(Message('control_change', channel=ch, control=10, value=64,  time=0))
        setup.append(Message('control_change', channel=ch, control=11, value=127, time=0))
        setup.append(Message('control_change', channel=ch, control=91, value=int(reverb), time=0))
        setup.append(Message('control_change', channel=ch, control=93, value=int(chorus), time=0))
        # RPN pitch-bend range = 0,0
        setup.append(Message('control_change', channel=ch, control=101, value=0, time=0))
        setup.append(Message('control_change', channel=ch, control=100, value=0, time=0))
        setup.append(Message('control_change', channel=ch, control=6,   value=int(pb_range), time=0))
        setup.append(Message('control_change', channel=ch, control=38,  value=0, time=0))
        setup.append(Message('control_change', channel=ch, control=101, value=127, time=0))
        setup.append(Message('control_change', channel=ch, control=100, value=127, time=0))
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    out.tracks.append(setup)
    for tr in mf.tracks:
        nt = MidiTrack()
        for m in tr: nt.append(m.copy())
        out.tracks.append(nt)
    return out

def collect_first_bank_pc(mf: MidiFile):
    first_cc0, first_cc32, first_pc = {}, {}, {}
    for tr in mf.tracks:
        for m in tr:
            if m.is_meta or not hasattr(m, 'channel'): 
                continue
            ch = m.channel
            if m.type == 'control_change':
                if m.control == 0 and ch not in first_cc0:   first_cc0[ch] = m.value
                if m.control == 32 and ch not in first_cc32: first_cc32[ch] = m.value
            elif m.type == 'program_change' and ch not in first_pc:
                first_pc[ch] = m.program
    return first_cc0, first_cc32, first_pc

def reemit_banks_programs_at_zero(mf: MidiFile, drum_channels=(9,10)) -> MidiFile:
    cc0, cc32, pc = collect_first_bank_pc(mf)
    setup = MidiTrack()
    for ch in range(16):
        if ch in drum_channels:  # on laisse les drums gérés à part
            continue
        msb = cc0.get(ch); lsb = cc32.get(ch); prg = pc.get(ch)
        if msb is not None:
            setup.append(Message('control_change', channel=ch, control=0, value=msb, time=0))
        if lsb is not None:
            setup.append(Message('control_change', channel=ch, control=32, value=lsb, time=0))
        if prg is not None:
            setup.append(Message('program_change', channel=ch, program=prg, time=0))
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    out.tracks.append(setup)
    for tr in mf.tracks:
        nt = MidiTrack()
        for m in tr: nt.append(m.copy())
        out.tracks.append(nt)
    return out

def force_gm_drum(mf: MidiFile, drum_channels=(9,10)) -> MidiFile:
    """
    Rend le comportement de TiMidity prévisible:
      - supprime CC0/CC32 sur CH9/CH10
      - force Program Change 0 (Standard Kit)
    (Le kit exact XG ne sera pas choisi, mais on évite les 'notes fantômes'.)
    """
    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    for tr in mf.tracks:
        nt = MidiTrack()
        for m in tr:
            msg = m.copy()
            if not msg.is_meta and hasattr(msg, 'channel') and msg.channel in drum_channels:
                if msg.type == 'control_change' and msg.control in (0,32):
                    # drop bank selects on drum channels
                    continue
                if msg.type == 'program_change':
                    msg.program = 0  # Standard Kit
            nt.append(msg)
        out.tracks.append(nt)
    return out

def sha16(path):
    try:
        h=hashlib.sha256()
        with open(path,'rb') as f:
            for chunk in iter(lambda: f.read(1<<20), b''):
                h.update(chunk)
        return h.hexdigest()[:16]
    except: return "?"

def run_timidity(sf2, mid, wav, sr=44100):
    if which('timidity') is None:
        log_warn("timidity introuvable dans le PATH")
        return subprocess.CompletedProcess(args=[], returncode=127)
    # cfg MINIMAL → aucune directive exotique
    cfg = f"soundfont {sf2}\n"
    with tempfile.NamedTemporaryFile('w', suffix='.cfg', delete=False, encoding='utf-8') as f:
        f.write(cfg)
        cfg_path = f.name
    env = os.environ.copy()
    env['TIMIDITY_CFG'] = cfg_path
    args = ['timidity','-c', cfg_path, '-Ow','-s', str(sr), '-o', wav, '-EFreverb=0','-EFchorus=0', mid]
    try:
        proc = run_and_log(args, env=env)
    finally:
        try: os.remove(cfg_path)
        except: pass
    return proc

def main():
    ap = argparse.ArgumentParser(description="Rendu WAV via TiMidity++ (XG setup + normalisation).")
    ap.add_argument('midi_in')
    ap.add_argument('wav_out')
    ap.add_argument('--sf2', required=True)
    ap.add_argument('--sr', type=int, default=44100)
    ap.add_argument('--no-xg', action='store_true')
    ap.add_argument('--no-reemit', action='store_true')
    ap.add_argument('--force-gm-drum', action='store_true', default=True,
                    help="Forcer CH10/11 (9/10 zero-based) en Standard GM Drum (PC=0). Défaut: ON.")
    ap.add_argument('--no-ffmpeg-fix', action='store_true')
    args = ap.parse_args()

    if not os.path.isfile(args.midi_in):
        log_err("MIDI introuvable:", args.midi_in); sys.exit(2)
    if not os.path.isfile(args.sf2):
        log_err("SF2 introuvable:", args.sf2); sys.exit(2)

    log_info("MIDI :", args.midi_in)
    log_info("SF2  :", args.sf2, "(sha256/16:", sha16(args.sf2)+")")
    log_info("WAV  :", args.wav_out)
    log_info("SR   :", args.sr)

    # Chargement et préparation
    try:
        mf = MidiFile(args.midi_in)
    except Exception as e:
        log_err("Échec lecture MIDI:", e); sys.exit(3)

    if not args.no_xg:
        log_info("Prep : XG System On + CC7/10/11 + CC91/93 + RPN PB=2")
        mf = ensure_xg_setup(mf, reverb=40, chorus=0, pb_range=2)
    if not args.no_reemit:
        log_info("Prep : réémission CC0/32/PC au tick 0 (hors drums)")
        mf = reemit_banks_programs_at_zero(mf, drum_channels=(9,10))
    if args.force_gm_drum:
        log_info("Prep : CH10/11 → Standard GM Drum (PC=0), bank selects ignorés")
        mf = force_gm_drum(mf, drum_channels=(9,10))

    # Sauvegarde temp
    fd, mid_fixed = tempfile.mkstemp(suffix='_xg.mid'); os.close(fd)
    try:
        mf.save(mid_fixed)
        log_ok("MIDI préparé :", mid_fixed)
    except Exception as e:
        log_err("Échec sauvegarde MIDI préparé:", e); sys.exit(4)

    # TiMidity only
    p = run_timidity(args.sf2, mid_fixed, args.wav_out, sr=args.sr)

    try: os.remove(mid_fixed)
    except: pass

    if p.returncode != 0 or not os.path.isfile(args.wav_out):
        log_err("Rendu audio échoué. Code:", p.returncode)
        sys.exit(p.returncode or 1)

    # Normalisation WAV (PCM 16-bit / 44.1k)
    if not args.no_ffmpeg_fix:
        if which('ffmpeg') is None:
            log_warn("ffmpeg introuvable, WAV brut conservé")
        else:
            tmp = args.wav_out + ".tmp"
            try:
                run_and_log(['ffmpeg','-y','-i', args.wav_out, '-acodec','pcm_s16le','-ar', str(args.sr), tmp], check=True)
                os.replace(tmp, args.wav_out)
                log_ok("WAV final PCM 16-bit/44.1k :", args.wav_out)
            except Exception as e:
                log_warn("ffmpeg normalisation échouée, WAV brut conservé :", e)
    else:
        log_info("Normalisation ffmpeg désactivée (--no-ffmpeg-fix)")

    log_ok("Terminé :", args.wav_out)

if __name__ == '__main__':
    main()
