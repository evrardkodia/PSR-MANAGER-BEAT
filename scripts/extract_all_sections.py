#!/usr/bin/env python3
import sys, os, json, traceback
from collections import defaultdict
from mido import MidiFile, MidiTrack, Message

BASE_URL = "https://psr-manager-beat.onrender.com/temp"

ALL_LABELS = [
    "Intro A","Intro B","Intro C","Intro D",
    "Fill In AA","Fill In BB","Fill In CC","Fill In DD",
    "Main A","Main B","Main C","Main D",
    "Ending A","Ending B","Ending C","Ending D"
]

# ---------------- utils ----------------
def file_end_tick(mid: MidiFile) -> int:
    m = 0
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
        if t > m: m = t
    return m

def build_markers_start(mid: MidiFile):
    """(tick, label) pour META 'marker' uniquement (pour le START)."""
    out, seen = [], set()
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
            if msg.is_meta and msg.type == "marker" and hasattr(msg, "text"):
                key = (t, msg.text.strip())
                if key not in seen:
                    seen.add(key); out.append(key)
    out.sort(key=lambda x: x[0])
    return out

def build_all_meta(mid: MidiFile):
    """(tick, label, type) pour marker + text + cue_marker (pour la FIN)."""
    out, seen = [], set()
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
            if msg.is_meta and msg.type in ("marker","text","cue_marker") and hasattr(msg, "text"):
                key = (t, msg.text.strip(), msg.type)
                if key not in seen:
                    seen.add(key); out.append(key)
    out.sort(key=lambda x: x[0])
    return out

def find_bounds(markers_only, all_meta, label, fallback_end):
    """start = 1er marker == label ; end = 1er meta (marker/text/cue) STRICTEMENT > start."""
    start = None
    for tick, text in markers_only:
        if text == label:
            start = tick
            break
    if start is None:
        return None, None
    end = None
    for tick, _txt, _typ in all_meta:
        if tick > start:
            end = tick
            break
    if end is None:
        end = fallback_end
    if end <= start:
        end = start + 1
    return start, end

def window_has_notes(mid, start_tick, end_tick):
    if end_tick <= start_tick: return False
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
            if start_tick <= t < end_tick:
                if msg.type == "note_on" and getattr(msg, "velocity", 0) > 0:
                    return True
            elif t >= end_tick:
                break
    return False

def copy_section(mid: MidiFile, start_tick: int, end_tick: int) -> MidiFile:
    out = MidiFile(ticks_per_beat=mid.ticks_per_beat)
    for src in mid.tracks:
        dst = MidiTrack()
        out.tracks.append(dst)

        last_meta = {}          # tempo/time/key
        last_cc_bank = {}       # (ch, cc0/32) -> val
        last_prog = {}          # ch -> program
        last_sysex = []         # sysex vus avant start
        pending = {}            # (ch, note) -> any

        t = 0
        in_win = False
        last_emit = start_tick

        for msg in src:
            t += msg.time

            # État avant start
            if t <= start_tick:
                if msg.is_meta and msg.type in ("set_tempo","time_signature","key_signature"):
                    last_meta[msg.type] = msg.copy(time=0)
                elif msg.type == "control_change" and msg.control in (0,32):
                    last_cc_bank[(msg.channel, msg.control)] = msg.value
                elif msg.type == "program_change":
                    last_prog[msg.channel] = msg.program
                elif msg.type == "sysex":
                    last_sysex.append(msg.copy(time=0))

            # Copie [start, end)
            if start_tick <= t < end_tick:
                if not in_win:
                    # inject état au début
                    for s in last_sysex:
                        dst.append(s.copy(time=0))
                    for k in ("set_tempo","time_signature","key_signature"):
                        if k in last_meta: dst.append(last_meta[k].copy(time=0))
                    # bank select 0 puis 32
                    by_ch = defaultdict(dict)
                    for (ch, cc), val in last_cc_bank.items(): by_ch[ch][cc] = val
                    for ch, m in by_ch.items():
                        if 0 in m:  dst.append(Message("control_change", channel=ch, control=0,  value=m[0],  time=0))
                        if 32 in m: dst.append(Message("control_change", channel=ch, control=32, value=m[32], time=0))
                    for ch, prog in last_prog.items():
                        dst.append(Message("program_change", channel=ch, program=prog, time=0))
                    in_win = True
                    last_emit = start_tick

                # exclure meta de repère
                if msg.is_meta and msg.type in ("marker","text","cue_marker"):
                    continue

                delta = int(t - last_emit)
                dst.append(msg.copy(time=delta))
                last_emit = t

                if msg.type == "note_on" and getattr(msg, "velocity", 0) > 0:
                    pending[(msg.channel, msg.note)] = True
                elif msg.type == "note_off" or (msg.type == "note_on" and getattr(msg, "velocity", 0) == 0):
                    pending.pop((msg.channel, msg.note), None)

            if t >= end_tick:
                break

        # clôture propre fin de piste
        if in_win:
            for (ch, note) in list(pending.keys()):
                dst.append(Message("note_off", channel=ch, note=note, velocity=0, time=int(end_tick - last_emit)))
                last_emit = end_tick
            # sustain off + all notes off + reset controllers
            for ch in range(16):
                dst.append(Message("control_change", channel=ch, control=64,  value=0, time=0))
                dst.append(Message("control_change", channel=ch, control=123, value=0, time=0))
                dst.append(Message("control_change", channel=ch, control=121, value=0, time=0))
    return out

# --------------- batch ---------------
def extract_all_sections(input_path, output_dir):
    try:
        mid = MidiFile(input_path)
        markers_only = build_markers_start(mid)
        all_meta = build_all_meta(mid)
        beat_base = os.path.basename(input_path)
        beat_id = beat_base.split('_')[0] if '_' in beat_base else os.path.splitext(beat_base)[0]

        os.makedirs(output_dir, exist_ok=True)
        items = []

        for label in ALL_LABELS:
            start, end = find_bounds(markers_only, all_meta, label, file_end_tick(mid))
            if start is None:           # pas trouvé
                continue
            if end <= start:             # fenêtre vide
                continue
            if not window_has_notes(mid, start, end):  # rien à jouer
                continue

            outname = f"{beat_id}_{label.replace(' ', '_')}.mid"
            outpath = os.path.join(output_dir, outname)
            cut = copy_section(mid, start, end)
            cut.save(outpath)

            items.append({
                "sectionName": label,
                "midFilename": outname,
                "url": f"{BASE_URL}/{outname}"
            })

        print(json.dumps({"sections": items}, ensure_ascii=False))
        return 0
    except Exception:
        err = {"error": "exception", "trace": traceback.format_exc()}
        print(json.dumps(err))
        return 1

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 extract_all_sections.py input_full.mid output_dir")
        sys.exit(1)
    sys.exit(extract_all_sections(sys.argv[1], sys.argv[2]))
