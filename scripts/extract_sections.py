from mido import MidiFile, MidiTrack, Message
import os
import sys
import traceback
import json

def extract_section(mid, section_name, next_section_name, output_path):
    try:
        ticks_per_beat = mid.ticks_per_beat
        out = MidiFile(ticks_per_beat=ticks_per_beat)

        # Trouver les ticks absolus de début et fin de section selon markers
        start_tick = None
        end_tick = None

        for track in mid.tracks:
            abs_time = 0
            for msg in track:
                abs_time += msg.time
                if msg.type == 'marker' and hasattr(msg, 'text'):
                    label = msg.text.strip()
                    if label == section_name and start_tick is None:
                        start_tick = abs_time
                    elif label == next_section_name and start_tick is not None:
                        end_tick = abs_time
                        break

            if end_tick is not None:
                break  # On a trouvé fin, on peut sortir du loop

        if start_tick is None:
            # Section non trouvée
            return {section_name: 0}

        if end_tick is None:
            # Pas de marqueur fin, prend la longueur totale midi (en ticks)
            # MidiFile length est en secondes, on convertit en ticks approximatif
            estimated_length_ticks = int(mid.length * ticks_per_beat * 4)  # *4 pour marge large
            end_tick = estimated_length_ticks

        for track in mid.tracks:
            new_track = MidiTrack()
            abs_time = 0
            in_section = False
            last_tick = 0
            setup_msgs = []
            pending_noteoffs = {}

            for msg in track:
                abs_time += msg.time

                # Messages setup avant section (tempo, signature, etc)
                if not in_section and abs_time <= start_tick and (
                    msg.type in ['set_tempo', 'key_signature', 'time_signature'] or
                    (msg.type == 'control_change' and msg.control in [0, 32]) or
                    msg.type in ['program_change', 'sysex']
                ):
                    setup_msgs.append(msg.copy(time=msg.time))

                # Pendant section
                if start_tick <= abs_time <= end_tick:
                    if not in_section:
                        # Première fois dans section : injecter messages setup à time=0
                        for sm in setup_msgs:
                            sm.time = 0
                            new_track.append(sm)
                        in_section = True
                        last_tick = start_tick

                    delta = abs_time - last_tick
                    new_track.append(msg.copy(time=delta))
                    last_tick = abs_time

                    # Suivi note_on/note_off pour fermeture correcte
                    if msg.type == 'note_on' and msg.velocity > 0:
                        pending_noteoffs[(msg.channel, msg.note)] = last_tick
                    elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                        pending_noteoffs.pop((msg.channel, msg.note), None)

                elif abs_time > end_tick:
                    break

            # Fermer toutes les notes ouvertes à la fin de la section
            for (ch, note), t in pending_noteoffs.items():
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
