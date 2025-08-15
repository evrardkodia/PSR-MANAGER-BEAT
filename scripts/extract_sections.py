from mido import MidiFile, MidiTrack, Message, MetaMessage
import os
import sys
import traceback
import json
from collections import defaultdict

# ---------- Utilitaires temps absolu ----------
def track_length_abs(track):
    t = 0
    for msg in track:
        t += msg.time
    return t

def file_end_tick(mid):
    return max(track_length_abs(tr) for tr in mid.tracks)

# ---------- Nouvelle collecte stricte des marqueurs ----------
def build_markers_timeline(mid):
    """
    Retourne une liste triée [(tick, label)] de TOUS les marqueurs présents.
    """
    markers = []
    for tr in mid.tracks:
        abs_t = 0
        for m in tr:
            abs_t += m.time
            if m.is_meta and m.type == 'marker':
                markers.append((abs_t, m.text.strip()))
    markers.sort(key=lambda x: x[0])
    return markers

def find_section_bounds(markers, label, default_end):
    """
    Trouve start_tick et end_tick pour le premier label trouvé.
    end_tick = tick du marqueur suivant (quel que soit son nom), sinon default_end.
    """
    for i, (t, txt) in enumerate(markers):
        if txt == label:
            start_tick = t
            end_tick = markers[i+1][0] if i+1 < len(markers) else default_end
            return start_tick, end_tick
    return None, None

# ---------- Extraction ----------
SETUP_META_TYPES = {'set_tempo', 'time_signature', 'key_signature'}
SETUP_CC = {0, 32}  # Bank Select MSB/LSB

def copy_section(mid, start_tick, end_tick):
    """
    Extrait [start_tick, end_tick) pour toutes les pistes.
    Exclut les marqueurs, ferme toutes les notes et remet les contrôleurs.
    """
    out = MidiFile(ticks_per_beat=mid.ticks_per_beat)

    for src_track in mid.tracks:
        dst = MidiTrack()
        out.tracks.append(dst)

        # États à restaurer
        last_meta = {}
        last_cc_bank = {}
        last_prog = {}
        last_sysex = []

        pending_notes = {}
        abs_time = 0
        last_emitted_abs = start_tick
        in_section = False

        for msg in src_track:
            abs_time += msg.time

            # Collecte des états avant start
            if abs_time <= start_tick:
                if msg.is_meta and msg.type in SETUP_META_TYPES:
                    last_meta[msg.type] = msg.copy(time=0)
                elif msg.type == 'control_change' and msg.control in SETUP_CC:
                    last_cc_bank[(msg.channel, msg.control)] = msg.value
                elif msg.type == 'program_change':
                    last_prog[msg.channel] = msg.program
                elif msg.type == 'sysex':
                    last_sysex.append(msg.copy(time=0))

            # Copie à l'intérieur de la fenêtre
            if start_tick <= abs_time < end_tick:
                if not in_section:
                    # Injection des états initiaux
                    for syx in last_sysex:
                        dst.append(syx.copy(time=0))
                    for t in ('set_tempo', 'time_signature', 'key_signature'):
                        if t in last_meta:
                            dst.append(last_meta[t].copy(time=0))
                    by_ch = defaultdict(dict)
                    for (ch, cc), val in last_cc_bank.items():
                        by_ch[ch][cc] = val
                    for ch, m in by_ch.items():
                        if 0 in m:
                            dst.append(Message('control_change', channel=ch, control=0, value=m[0], time=0))
                        if 32 in m:
                            dst.append(Message('control_change', channel=ch, control=32, value=m[32], time=0))
                    for ch, prog in last_prog.items():
                        dst.append(Message('program_change', channel=ch, program=prog, time=0))
                    in_section = True
                    last_emitted_abs = start_tick

                # Ignorer tous les marqueurs
                if msg.is_meta and msg.type == 'marker':
                    continue

                delta = abs_time - last_emitted_abs
                copied = msg.copy(time=delta)

                if copied.type == 'note_on' and copied.velocity > 0:
                    pending_notes[(copied.channel, copied.note)] = abs_time
                elif copied.type == 'note_off' or (copied.type == 'note_on' and copied.velocity == 0):
                    pending_notes.pop((copied.channel, copied.note), None)

                dst.append(copied)
                last_emitted_abs = abs_time

            if abs_time >= end_tick:
                break

        # Fermeture propre
        if in_section:
            for (ch, note), start_t in list(pending_notes.items()):
                delta = end_tick - last_emitted_abs
                dst.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_emitted_abs = end_tick
            for ch in range(16):
                dst.append(Message('control_change', channel=ch, control=64, value=0, time=0))
                dst.append(Message('control_change', channel=ch, control=123, value=0, time=0))
                dst.append(Message('control_change', channel=ch, control=121, value=0, time=0))

    return out

# ---------- API ----------
ALL_LABELS = [
    'Intro A', 'Intro B', 'Intro C', 'Intro D',
    'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
    'Main A', 'Main B', 'Main C', 'Main D',
    'Ending A', 'Ending B', 'Ending C', 'Ending D'
]

def extract_one_section(mid, label, markers, out_dir):
    end_fallback = file_end_tick(mid)
    start_tick, end_tick = find_section_bounds(markers, label, end_fallback)
    if start_tick is None:
        return {label: 0}
    section_mid = copy_section(mid, start_tick, end_tick)
    out_path = os.path.join(out_dir, f"{label.replace(' ', '_')}.mid")
    section_mid.save(out_path)
    return {label: 1}

def extract_all_sections(input_path, output_dir):
    result = {"sections": {}}
    try:
        mid = MidiFile(input_path)
        markers = build_markers_timeline(mid)
        for label in ALL_LABELS:
            res = extract_one_section(mid, label, markers, output_dir)
            result["sections"].update(res)
        print(json.dumps(result))
    except Exception as e:
        err_json = json.dumps({"error": f"Erreur générale : {str(e)}"})
        print(err_json, file=sys.stderr)
        print(err_json)

# ---------- CLI ----------
if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python extract_sections.py input.mid output_directory")
        sys.exit(1)

    input_mid = sys.argv[1]
    output_directory = sys.argv[2]
    os.makedirs(output_directory, exist_ok=True)
    extract_all_sections(input_mid, output_directory)
