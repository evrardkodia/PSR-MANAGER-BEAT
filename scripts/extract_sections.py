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

def build_markers_timeline(mid):
    """
    Liste triée [(tick, label)] de TOUS les meta 'marker' (dédupliqués par (tick,label)).
    (On reste strict: pas de 'text', pas de 'cue_marker'.)
    """
    markers = []
    seen = set()
    for track in mid.tracks:
        abs_time = 0
        for msg in track:
            abs_time += msg.time
            if msg.is_meta and msg.type == 'marker':
                key = (abs_time, msg.text.strip())
                if key not in seen:
                    seen.add(key)
                    markers.append(key)
    markers.sort(key=lambda x: x[0])
    return markers

def find_section_bounds(markers, label, default_end):
    """
    (start_tick, end_tick) pour le PREMIER 'label' rencontré.
    end_tick = tick du PREMIER marqueur suivant chronologique, QUEL QUE SOIT SON NOM.
    NOTE : on autorise que le prochain marqueur soit au MÊME tick (section potentiellement vide).
    """
    for i, (tick, text) in enumerate(markers):
        if text == label:
            start_tick = tick
            end_tick = markers[i+1][0] if i + 1 < len(markers) else default_end
            return start_tick, end_tick
    return None, None

def window_has_notes(mid, start_tick, end_tick):
    """Vrai s'il y a au moins une note_on (velocity > 0) dans [start,end)."""
    if end_tick <= start_tick:
        return False
    for track in mid.tracks:
        abs_time = 0
        for msg in track:
            abs_time += msg.time
            if start_tick <= abs_time < end_tick:
                if msg.type == 'note_on' and getattr(msg, 'velocity', 0) > 0:
                    return True
            elif abs_time >= end_tick:
                break
    return False

# ---------- Extraction ----------
SETUP_META_TYPES = {'set_tempo', 'time_signature', 'key_signature'}
SETUP_CC = {0, 32}  # Bank Select MSB/LSB

def copy_section(mid, start_tick, end_tick):
    """
    Retourne un MidiFile avec uniquement [start_tick, end_tick) sur TOUTES les pistes.
    - Restaure un état minimal (sysex/tempo/time/key/bank/program) au début.
    - Exclut les meta 'marker'.
    - Ferme proprement les notes et envoie sustain/off & resets en fin.
    """
    out = MidiFile(ticks_per_beat=mid.ticks_per_beat)

    for src_track in mid.tracks:
        dst = MidiTrack()
        out.tracks.append(dst)

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

            # Collecte état avant fenêtre
            if abs_time <= start_tick:
                if msg.is_meta and msg.type in SETUP_META_TYPES:
                    last_meta[msg.type] = msg.copy(time=0)
                elif msg.type == 'control_change' and msg.control in SETUP_CC:
                    last_cc_bank[(msg.channel, msg.control)] = msg.value
                elif msg.type == 'program_change':
                    last_prog[msg.channel] = msg.program
                elif msg.type == 'sysex':
                    last_sysex.append(msg.copy(time=0))

            # Copie dans fenêtre
            if start_tick <= abs_time < end_tick:
                if not in_section:
                    # injecter état
                    for syx in last_sysex:
                        dst.append(syx.copy(time=0))
                    for t in ('set_tempo','time_signature','key_signature'):
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
            for (ch, note), _ in list(pending_notes.items()):
                delta = end_tick - last_emitted_abs
                dst.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_emitted_abs = end_tick

            for ch in range(16):
                dst.append(Message('control_change', channel=ch, control=64, value=0, time=0))
                dst.append(Message('control_change', channel=ch, control=123, value=0, time=0))
                dst.append(Message('control_change', channel=ch, control=121, value=0, time=0))

    return out

# ---------- API extraction par nom ----------
ALL_LABELS = [
    'Intro A', 'Intro B', 'Intro C', 'Intro D',
    'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
    'Main A', 'Main B', 'Main C', 'Main D',
    'Ending A', 'Ending B', 'Ending C', 'Ending D'
]

def extract_one_section(mid, label, markers, out_dir):
    end_fallback = file_end_tick(mid)
    start_tick, end_tick = find_section_bounds(markers, label, end_fallback)

    # 1) Pas de start -> indisponible
    if start_tick is None:
        return {label: 0}

    # 2) Fenêtre vide ou sans note -> on marque indisponible, on NE SAUVE PAS
    if end_tick <= start_tick or not window_has_notes(mid, start_tick, end_tick):
        return {label: 0}

    # 3) OK → copier et enregistrer
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
