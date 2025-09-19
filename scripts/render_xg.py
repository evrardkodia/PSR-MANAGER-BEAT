# scripts/render_xg.py
import argparse, tempfile, os, subprocess, sys, shutil
from mido import MidiFile, MidiTrack, Message

# ──────────────────────────────────────────────────────────────
# Utilitaires de log
# ──────────────────────────────────────────────────────────────
def log_info(*a):  print("ℹ️", *a, file=sys.stderr, flush=True)
def log_ok(*a):    print("✅", *a, file=sys.stderr, flush=True)
def log_warn(*a):  print("⚠️", *a, file=sys.stderr, flush=True)
def log_err(*a):   print("❌", *a, file=sys.stderr, flush=True)

def which(binname):
    p = shutil.which(binname)
    return p if p else None

def run_and_log(cmd, check=False):
    log_info("CMD:", " ".join([f'"{c}"' if " " in c else c for c in cmd]))
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = (proc.stdout or b"").decode(errors="ignore")
    err = (proc.stderr or b"").decode(errors="ignore")
    if out.strip():
        # ne pas spammer, afficher seulement la fin si trop long
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
# Préparation XG
# ──────────────────────────────────────────────────────────────
def ensure_xg_setup(mf: MidiFile, drum_channels=(9,10), reverb=40, chorus=0, pb_range=2) -> MidiFile:
    setup = MidiTrack()
    # XG System On (mido enlève F0/F7)
    setup.append(Message('sysex', data=XG_ON[1:-1], time=0))

    # Defaults utiles
    for ch in range(16):
        setup.append(Message('control_change', channel=ch, control=7,  value=100, time=0))  # volume
        setup.append(Message('control_change', channel=ch, control=10, value=64,  time=0))  # pan
        setup.append(Message('control_change', channel=ch, control=11, value=127, time=0))  # expression
        setup.append(Message('control_change', channel=ch, control=91, value=int(reverb), time=0))  # reverb send
        setup.append(Message('control_change', channel=ch, control=93, value=int(chorus), time=0))  # chorus send

        # RPN pitch-bend range
        setup.append(Message('control_change', channel=ch, control=101, value=0, time=0))  # RPN MSB
        setup.append(Message('control_change', channel=ch, control=100, value=0, time=0))  # RPN LSB
        setup.append(Message('control_change', channel=ch, control=6,   value=int(pb_range), time=0))  # Data MSB
        setup.append(Message('control_change', channel=ch, control=38,  value=0, time=0))  # Data LSB
        # RPN null
        setup.append(Message('control_change', channel=ch, control=101, value=127, time=0))
        setup.append(Message('control_change', channel=ch, control=100, value=127, time=0))

    # Drums sur canaux spécifiés => bank 128 (CC32=127), PC=0
    for ch in drum_channels:
        if 0 <= ch <= 15:
            setup.append(Message('control_change', channel=ch, control=0,  value=0,   time=0))
            setup.append(Message('control_change', channel=ch, control=32, value=127, time=0))
            setup.append(Message('program_change', channel=ch, program=0, time=0))

    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    out.tracks.append(setup)
    for tr in mf.tracks:
        nt = MidiTrack()
        for m in tr:
            nt.append(m.copy())
        out.tracks.append(nt)
    return out

def reemit_banks_programs_at_zero(mf: MidiFile, drum_channels=(9,10)) -> MidiFile:
    first_cc0, first_cc32, first_pc, used_ch = {}, {}, {}, set()
    for tr in mf.tracks:
        for m in tr:
            if m.is_meta: continue
            if not hasattr(m, 'channel'): continue
            ch = m.channel
            if m.type == 'control_change':
                if m.control == 0  and ch not in first_cc0:  first_cc0[ch]  = m.value
                if m.control == 32 and ch not in first_cc32: first_cc32[ch] = m.value
            elif m.type == 'program_change' and ch not in first_pc:
                first_pc[ch] = m.program
            elif m.type == 'note_on' and m.velocity > 0:
                used_ch.add(ch)

    setup = MidiTrack()
    for ch in sorted(used_ch):
        if ch in drum_channels:  # on laisse les drums tels qu’on a forcés
            continue
        if ch in first_cc0:
            setup.append(Message('control_change', channel=ch, control=0, value=first_cc0[ch], time=0))
        if ch in first_cc32:
            setup.append(Message('control_change', channel=ch, control=32, value=first_cc32[ch], time=0))
        if ch in first_pc:
            setup.append(Message('program_change', channel=ch, program=first_pc[ch], time=0))

    out = MidiFile(ticks_per_beat=mf.ticks_per_beat)
    out.tracks.append(setup)
    for tr in mf.tracks:
        nt = MidiTrack()
        for m in tr:
            nt.append(m.copy())
        out.tracks.append(nt)
    return out

# ──────────────────────────────────────────────────────────────
# Moteurs de rendu
# ──────────────────────────────────────────────────────────────
def run_fluidsynth(sf2, mid, wav, sr=44100, enable_reverb=False, enable_chorus=False, extra_opts=None):
    if which('fluidsynth') is None:
        log_warn("fluidsynth introuvable dans le PATH")
        return subprocess.CompletedProcess(args=[], returncode=127)
    args = [
        'fluidsynth','-ni',
        '-a','file','-F', wav, '-T','wav',
        '-r', str(sr), '-g','1.0',
        '-o','synth.dynamic-sample-loading=1',
        '-o',f'synth.reverb.active={"1" if enable_reverb else "0"}',
        '-o',f'synth.chorus.active={"1" if enable_chorus else "0"}',
        sf2, mid
    ]
    if extra_opts:
        # Permet d’injecter -o foo=bar supplémentaires (ex: depuis un env)
        args[0:0] = []
    return run_and_log(args)

def run_timidity(sf2, mid, wav, sr=44100):
    if which('timidity') is None:
        log_warn("timidity introuvable dans le PATH")
        return subprocess.CompletedProcess(args=[], returncode=127)
    cfg = f"soundfont {sf2}\n"
    with tempfile.NamedTemporaryFile('w', suffix='.cfg', delete=False) as f:
        f.write(cfg)
        cfg_path = f.name
    env = os.environ.copy()
    env['TIMIDITY_CFG'] = cfg_path
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
    ap = argparse.ArgumentParser(description="Rendu WAV fidèle au SF2 avec préparation XG du MIDI.")
    ap.add_argument('midi_in', help="Chemin du MIDI source (déjà généré par tes scripts).")
    ap.add_argument('wav_out', help="Chemin du WAV de sortie.")
    ap.add_argument('--sf2', required=True, help="Chemin du SoundFont .sf2")
    ap.add_argument('--sr', type=int, default=44100, help="Sample rate (défaut 44100)")
    ap.add_argument('--engine', choices=['auto','fluidsynth','timidity'], default='auto', help="Moteur de synthèse")
    ap.add_argument('--no-xg', action='store_true', help="Ne pas injecter XG System On / defaults")
    ap.add_argument('--no-reemit', action='store_true', help="Ne pas réémettre CC0/32/PC au tick 0")
    ap.add_argument('--drums', default='9,10', help="Canaux batterie forcés (ex: '9,10' ou '10' ou '').")
    ap.add_argument('--reverb', type=int, default=40, help="CC91 envoyé au tick 0 (0-127)")
    ap.add_argument('--chorus', type=int, default=0, help="CC93 envoyé au tick 0 (0-127)")
    ap.add_argument('--pb', type=int, default=2, help="Pitch-bend range en demi-tons (RPN 0,0)")
    ap.add_argument('--fs-reverb', action='store_true', help="Activer la reverb interne FluidSynth")
    ap.add_argument('--fs-chorus', action='store_true', help="Activer le chorus interne FluidSynth")
    ap.add_argument('--no-ffmpeg-fix', action='store_true', help="Ne pas repasser au format PCM 16-bit/44.1k via ffmpeg")
    args = ap.parse_args()

    if not os.path.isfile(args.midi_in):
        log_err("MIDI introuvable:", args.midi_in); sys.exit(2)
    if not os.path.isfile(args.sf2):
        log_err("SF2 introuvable:", args.sf2); sys.exit(2)

    # Drum channels parsing
    drum_channels = []
    if args.drums.strip():
        try:
            drum_channels = [int(x) for x in args.drums.split(',') if x.strip()!='']
        except ValueError:
            log_warn("Paramètre --drums invalide, utilisation des valeurs par défaut 9,10")
            drum_channels = [9,10]

    log_info("MIDI  :", args.midi_in)
    log_info("SF2   :", args.sf2)
    log_info("WAV   :", args.wav_out)
    log_info("SR    :", args.sr)
    log_info("Eng   :", args.engine)
    log_info("Drums :", drum_channels if drum_channels else "(aucun forcé)")
    if not args.no_xg:
        log_info("Prep  : XG System On + CC7/10/11 + CC91/93 + RPN pitch-bend =", args.pb)
    if not args.no_reemit:
        log_info("Prep  : réémission CC0/32/PC au tick 0")

    # Charger MIDI
    try:
        mf = MidiFile(args.midi_in)
    except Exception as e:
        log_err("Echec lecture MIDI:", e); sys.exit(3)

    # Préparation XG (optionnelle)
    if not args.no_xg:
        mf = ensure_xg_setup(mf, drum_channels=tuple(drum_channels), reverb=args.reverb, chorus=args.chorus, pb_range=args.pb)
    if not args.no_reemit:
        mf = reemit_banks_programs_at_zero(mf, drum_channels=tuple(drum_channels))

    # Sauvegarde MIDI temporaire
    fd, mid_fixed = tempfile.mkstemp(suffix='_xg.mid'); os.close(fd)
    try:
        mf.save(mid_fixed)
        log_ok("MIDI préparé :", mid_fixed)
    except Exception as e:
        log_err("Echec sauvegarde MIDI préparé:", e); sys.exit(4)

    # Rendu audio
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

    # Nettoyage temporaire
    try: os.remove(mid_fixed)
    except: pass

    if proc.returncode != 0 or not os.path.isfile(args.wav_out):
        log_err("Rendu audio échoué. Code:", proc.returncode)
        # la sortie d'erreur a déjà été affichée par run_and_log
        sys.exit(proc.returncode or 1)

    # Reformatage WAV via ffmpeg (assure PCM 16-bit / 44.1k)
    if not args.no_ffmpeg_fix:
        if which('ffmpeg') is None:
            log_warn("ffmpeg introuvable, saut du reformatage PCM 16-bit/44.1k")
        else:
            tmp = args.wav_out + ".tmp"
            try:
                run_and_log(['ffmpeg','-y','-i', args.wav_out, '-acodec','pcm_s16le','-ar', str(args.sr), tmp], check=True)
                os.replace(tmp, args.wav_out)
                log_ok("WAV final normalisé PCM 16-bit/44.1k :", args.wav_out)
            except Exception as e:
                log_warn("ffmpeg normalisation échouée, WAV brut conservé :", e)
    else:
        log_info("Normalisation ffmpeg désactivée (--no-ffmpeg-fix)")

    log_ok("Terminé :", args.wav_out)

if __name__ == '__main__':
    main()
