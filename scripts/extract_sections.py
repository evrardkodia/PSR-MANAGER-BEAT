from mido import MidiFile, MidiTrack, Message
import os
import sys
import traceback
import json

def extract_section(mid, section_name, next_section_name, output_path):
    try:
        ticks_per_beat = mid.ticks_per_beat
        out = MidiFile(ticks_per_beat=ticks_per_beat)

        start_tick = None
        end_tick = None

        # Trouver début et fin de section
        for track in mid.tracks:
            abs_time = 0
            for msg in track:
                abs_time += msg.time
                if msg.type == 'marker':
                    label = msg.text.strip()
                    if label == section_name and start_tick is None:
                        start_tick = abs_time
                    elif label == next_section_name and start_tick is not None:
                        end_tick = abs_time
                        break
            if end_tick is not None:
                break

        if start_tick is None:
            return {section_name: 0}

        if end_tick is None:
            # Fin du fichier si pas de marqueur suivant
            end_tick = max(sum(msg.time for msg in tr) for tr in mid.tracks)

        for track in mid.tracks:
            new_track = MidiTrack()
            abs_time = 0
            in_section = False
            last_tick = start_tick
            setup_msgs = []
            pending_notes = {}

            for msg in track:
                abs_time += msg.time

                # Sauvegarder configuration avant début
                if not in_section and abs_time <= start_tick and (
                    msg.type in ['set_tempo', 'key_signature', 'time_signature'] or
                    (msg.type == 'control_change' and msg.control in [0, 32]) or
                    msg.type in ['program_change', 'sysex']
                ):
                    setup_msgs.append(msg.copy(time=0))

                # Entrer dans la section
                if abs_time >= start_tick and abs_time < end_tick:
                    if not in_section:
                        for sm in setup_msgs:
                            new_track.append(sm)
                        in_section = True
                        last_tick = start_tick

                    delta = abs_time - last_tick
                    new_track.append(msg.copy(time=delta))
                    last_tick = abs_time

                    if msg.type == 'note_on' and msg.velocity > 0:
                        pending_notes[(msg.channel, msg.note)] = last_tick
                    elif msg.type in ['note_off', 'note_on'] and msg.velocity == 0:
                        pending_notes.pop((msg.channel, msg.note), None)

                # Stop si on arrive exactement sur le prochain marqueur
                if abs_time >= end_tick:
                    break

            # Fermer toutes les notes ouvertes à la fin de la section
            for (ch, note), t in pending_notes.items():
                delta = end_tick - last_tick
                new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_tick = end_tick

            out.tracks.append(new_track)

        out.save(output_path)
        return {section_name: 1}

    except Exception:
        print("Erreur lors de l'extraction de la section:", traceback.format_exc(), file=sys.stderr)
        return {section_name: 0}

def extract_all_sections(input_path, output_dir):
    sections = [
        'Intro A', 'Intro B', 'Intro C', 'Intro D',
        'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
        'Main A', 'Main B', 'Main C', 'Main D',
        'Ending A', 'Ending B', 'Ending C', 'Ending D'
    ]

    result = {"sections": {}}

    try:
        mid = MidiFile(input_path)

        for i, section in enumerate(sections):
            next_section = sections[i + 1] if i + 1 < len(sections) else None
            output_file = os.path.join(output_dir, f"{section.replace(' ', '_')}.mid")
            section_data = extract_section(mid, section, next_section, output_file)
            result["sections"].update(section_data)

        print(json.dumps(result))

    except Exception as e:
        err_json = json.dumps({"error": f"Erreur générale : {str(e)}"})
        print(err_json, file=sys.stderr)
        print(err_json)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python extract_sections.py input.mid output_directory")
        sys.exit(1)

    input_mid = sys.argv[1]
    output_directory = sys.argv[2]

    if not os.path.exists(output_directory):
        os.makedirs(output_directory)

    extract_all_sections(input_mid, output_directory)
