#!/usr/bin/env python3
from mido import MidiFile, MidiTrack, Message
import os, sys, json, traceback

BASE_URL = "https://psr-manager-beat.onrender.com/temp"

# ---------- Utils ----------
def norm_label(s: str) -> str:
    return " ".join(s.strip().lower().replace("_", " ").split())

def label_matches(lbl: str, wanted: str) -> bool:
    a, b = norm_label(lbl), norm_label(wanted)
    if a == b: return True
    if a.startswith(b) or b.startswith(a): return True
    if b in a: return True
    return False

def total_ticks(mid: MidiFile) -> int:
    m = 0
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
        if t > m: m = t
    return m

def build_markers(mid: MidiFile):
    """[(tick, label, type)] avec marker/text/cue_marker, trié par tick."""
    out = []
    seen = set()
    for tr in mid.tracks:
        abs_t = 0
        for msg in tr:
            abs_t += msg.time
            if msg.is_meta and msg.type in ("marker","text","cue_marker") and hasattr(msg,"text"):
                key = (abs_t, msg.text.strip(), msg.type)
                if key not in seen:
                    seen.add(key)
                    out.append(key)
    out.sort(key=lambda x: x[0])
    return out

def find_bounds(markers, label, fallback_end):
    start = None
    for (tick, lab, _t) in markers:
        if label_matches(lab, label):
            start = tick
            break
    if start is None:
        return None, None
    end = None
    for (tick, _lab, _t) in markers:
        if tick > start:
            end = tick
            break
    if end is None: end = fallback_end
    if end <= start: end = start + 1
    return start, end

def cut_window(mid: MidiFile, start_tick: int, end_tick: int) -> MidiFile:
    """Copie brute [start,end), sans meta marker/text/cue_marker; ferme les notes à end."""
    out = MidiFile(ticks_per_beat=mid.ticks_per_beat)
    for src in mid.tracks:
        dst = MidiTrack()
        out.tracks.append(dst)
        abs_t = 0
        last_emit = start_tick
        pending = set()  # (ch, note)
        for msg in src:
            abs_t += msg.time
            if start_tick <= abs_t < end_tick:
                if msg.is_meta and msg.type in ("marker","text","cue_marker"):
                    continue
                delta = int(abs_t - last_emit)
                dst.append(msg.copy(time=delta))
                last_emit = abs_t
                if msg.type == "note_on" and getattr(msg,"velocity",0) > 0:
                    pending.add((msg.channel, msg.note))
                elif msg.type == "note_off" or (msg.type == "note_on" and getattr(msg,"velocity",0) == 0):
                    pending.discard((msg.channel, msg.note))
            elif abs_t >= end_tick:
                break
        # fermer à end
        for ch, note in list(pending):
            delta = int(end_tick - last_emit)
            dst.append(Message("note_off", channel=ch, note=note, velocity=0, time=delta))
            last_emit = end_tick
    return out

# ---------- Modes ----------
ALL_LABELS = [
    "Intro A","Intro B","Intro C","Intro D",
    "Fill In AA","Fill In BB","Fill In CC","Fill In DD",
    "Main A","Main B","Main C","Main D",
    "Ending A","Ending B","Ending C","Ending D"
]

def mode_batch(input_mid: str, out_dir: str, beat_id: str = None):
    """Extrait toutes les sections et imprime JSON sections[] (format attendu par le BE)."""
    mid = MidiFile(input_mid)
    markers = build_markers(mid)
    if not markers:
        print(json.dumps({"sections": []}))
        return 0

    if beat_id is None:
        base = os.path.basename(input_mid)
        beat_id = base.split("_")[0] if "_" in base else os.path.splitext(base)[0]

    os.makedirs(out_dir, exist_ok=True)
    items = []

    for label in ALL_LABELS:
        start, end = find_bounds(markers, label, total_ticks(mid))
        if start is None:
            continue
        section_mid = cut_window(mid, start, end)
        filename = f"{beat_id}_{label.replace(' ','_')}.mid"
        path = os.path.join(out_dir, filename)
        section_mid.save(path)
        items.append({
            "sectionName": label,
            "midFilename": filename,
            "url": f"{BASE_URL}/{filename}"
        })

    print(json.dumps({"sections": items}, ensure_ascii=False))
    return 0

def mode_single(input_mid: str, section_label: str, out_mid: str):
    """Extrait une section et imprime uniquement la durée (ex: 5.333)."""
    mid = MidiFile(input_mid)
    markers = build_markers(mid)
    start, end = find_bounds(markers, section_label, total_ticks(mid))
    if start is None:
        print("0.0")
        return 1
    section_mid = cut_window(mid, start, end)
    os.makedirs(os.path.dirname(out_mid) or ".", exist_ok=True)
    section_mid.save(out_mid)
    dur = round(MidiFile(out_mid).length, 3)
    print(dur)
    return 0

def main(argv):
    try:
        # Modes supportés:
        # 1) Lot:    python extract_section.py input_full.mid output_dir
        # 2) Unitaire:
        #    python extract_section.py input_full.mid "Main B" out.mid
        #    python extract_section.py input_full.mid out.mid "Main B"
        if len(argv) == 3 and not argv[2].lower().endswith(".mid"):
            return mode_batch(argv[1], argv[2])
        elif len(argv) == 4:
            a1, a2, a3 = argv[1], argv[2], argv[3]
            if a2.lower().endswith(".mid") and not a3.lower().endswith(".mid"):
                return mode_single(a1, a3, a2)
            elif not a2.lower().endswith(".mid") and a3.lower().endswith(".mid"):
                return mode_single(a1, a2, a3)
            else:
                return mode_single(a1, a2, a3)
        else:
            print("Usage:\n  python extract_section.py input_full.mid output_dir\n  python extract_section.py input_full.mid \"Section Name\" out.mid")
            return 1
    except Exception:
        print(json.dumps({"error":"exception","trace":traceback.format_exc()}))
        return 1

if __name__ == "__main__":
    sys.exit(main(sys.argv))
