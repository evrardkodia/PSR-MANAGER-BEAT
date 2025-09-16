import sys
import os
import json
import traceback
from mido import MidiFile, MidiTrack, Message

BASE_URL = "https://psr-manager-beat.onrender.com/temp"

# --------- utils ---------
def norm_label(s: str) -> str:
    # normalise: trim, lower, remplace _ par espace, compresse espaces
    return " ".join(s.strip().lower().replace("_", " ").split())

def total_ticks(mid: MidiFile) -> int:
    m = 0
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
        if t > m:
            m = t
    return m

def build_markers(mid: MidiFile):
    """Retourne une liste triée [(tick, raw_text, norm_text)] de TOUS les marqueurs du fichier."""
    marks = []
    for tr in mid.tracks:
        abs_t = 0
        for msg in tr:
            abs_t += msg.time
            if msg.is_meta and msg.type == "marker" and hasattr(msg, "text"):
                raw = msg.text.strip()
                marks.append((abs_t, raw, norm_label(raw)))
    marks.sort(key=lambda x: x[0])
    return marks

# --------- extraction robuste: [start, prochain marqueur) ---------
def extract_section(mid: MidiFile, section_name: str, _next_section_name_unused, output_path: str):
    try:
        tpb = mid.ticks_per_beat
        out = MidiFile(ticks_per_beat=tpb)

        marks = build_markers(mid)
        wanted = norm_label(section_name)

        # start = tick du marqueur exact (normalisé)
        start_tick = None
        end_tick = None

        for i, (tick, raw, normed) in enumerate(marks):
            if normed == wanted:
                start_tick = tick
                # end = tick du prochain marqueur (peu importe son nom)
                if i + 1 < len(marks):
                    end_tick = marks[i + 1][0]
                break

        if start_tick is None:
            # section introuvable
            return {section_name: 0}

        if end_tick is None:
            # pas de marqueur suivant -> fin = fin réelle du morceau
            end_tick = total_ticks(mid)

        # copie fenêtre [start_tick, end_tick)
        for src in mid.tracks:
            dst = MidiTrack()
            out.tracks.append(dst)

            # états à réinjecter
            last_meta = {}         # 'set_tempo','time_signature','key_signature'
            bank = {}              # ch -> {0:val, 32:val}
            last_prog = {}         # ch -> program
            sysex_list = []        # sysex à rejouer

            # notes en cours
            pending = {}

            abs_t = 0
            in_win = False
            last_emit = start_tick  # point de référence pour deltas

            # on parcourt la piste
            for msg in src:
                abs_t += msg.time

                # collecter état avant fenêtre
                if not in_win and abs_t <= start_tick:
                    if msg.is_meta and msg.type in ('set_tempo', 'time_signature', 'key_signature'):
                        last_meta[msg.type] = msg.copy(time=0)
                    elif msg.type == 'control_change' and msg.control in (0, 32):
                        bank.setdefault(msg.channel, {})[msg.control] = msg.value
                    elif msg.type == 'program_change':
                        last_prog[msg.channel] = msg.program
                    elif msg.type == 'sysex':
                        sysex_list.append(msg.copy(time=0))

                # dans la fenêtre
                if start_tick <= abs_t < end_tick:
                    if not in_win:
                        # injecter l'état de départ
                        for s in sysex_list:
                            dst.append(s.copy(time=0))
                        for t in ('set_tempo','time_signature','key_signature'):
                            if t in last_meta:
                                dst.append(last_meta[t].copy(time=0))
                        # bank select: 0 puis 32 (si présents)
                        for ch, vals in bank.items():
                            if 0 in vals:
                                dst.append(Message('control_change', channel=ch, control=0, value=vals[0], time=0))
                            if 32 in vals:
                                dst.append(Message('control_change', channel=ch, control=32, value=vals[32], time=0))
                        for ch, prog in last_prog.items():
                            dst.append(Message('program_change', channel=ch, program=prog, time=0))

                        in_win = True
                        last_emit = start_tick

                    # ignorer les meta 'marker' dans le rendu de section
                    if msg.is_meta and msg.type == 'marker':
                        continue

                    delta = int(abs_t - last_emit)
                    dst.append(msg.copy(time=delta))
                    last_emit = abs_t

                    # suivi des notes
                    if msg.type == 'note_on' and getattr(msg, 'velocity', 0) > 0:
                        pending[(msg.channel, msg.note)] = last_emit
                    elif msg.type == 'note_off' or (msg.type == 'note_on' and getattr(msg, 'velocity', 0) == 0):
                        pending.pop((msg.channel, msg.note), None)

                elif abs_t >= end_tick:
                    break

            # fermer les notes qui restent ouvertes à end_tick
            for (ch, note), _ in list(pending.items()):
                delta = int(end_tick - last_emit)
                dst.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_emit = end_tick

        out.save(output_path)
        return {section_name: 1}
    except Exception:
        print("Erreur dans extract_section:", traceback.format_exc(), file=sys.stderr)
        return {section_name: 0}

def extract_all_sections(input_path, output_dir):
    # L'ordre ici ne sert plus à borner la fin : on découpe au prochain marqueur réel
    sections = [
        'Intro A', 'Intro B', 'Intro C', 'Intro D',
        'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
        'Main A', 'Main B', 'Main C', 'Main D',
        'Ending A', 'Ending B', 'Ending C', 'Ending D'
    ]

    result = {"sections": []}

    try:
        mid = MidiFile(input_path)

        # beatId depuis le nom d'entrée: ex "9_full.mid" -> "9"
        basename = os.path.basename(input_path)
        beat_id = basename.split('_')[0] if '_' in basename else 'unknown'

        for i, section in enumerate(sections):
            next_section = sections[i + 1] if i + 1 < len(sections) else None  # ignoré par extract_section
            filename = f"{beat_id}_{section.replace(' ', '_')}.mid"
            output_file = os.path.join(output_dir, filename)
            section_result = extract_section(mid, section, next_section, output_file)
            if section_result.get(section) == 1:
                result["sections"].append({
                    "sectionName": section,
                    "midFilename": filename,
                    "url": f"{BASE_URL}/{filename}"
                })

        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        err_json = json.dumps({"error": f"Erreur générale : {str(e)}"})
        print(err_json, file=sys.stderr)
        print(err_json)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 extract_all_sections.py input_full.mid output_dir")
        sys.exit(1)

    input_full_mid = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    extract_all_sections(input_full_mid, output_dir)
