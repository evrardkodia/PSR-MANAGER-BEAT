from mido import MidiFile, MidiTrack, MetaMessage
import sys

def extract_section(input_path, output_path, section_name):
    mid = MidiFile(input_path)
    ticks_per_beat = mid.ticks_per_beat
    out = MidiFile(ticks_per_beat=ticks_per_beat)

    start_tick = None
    end_tick = None

    # Ordre des sections Yamaha
    section_order = ['Intro A', 'Intro B', 'Intro C', 'Intro D',
                     'Main A', 'Main B', 'Main C', 'Main D',
                     'Ending A', 'Ending B', 'Ending C', 'Ending D']

    try:
        index = section_order.index(section_name)
    except ValueError:
        print(f"Erreur : section '{section_name}' non reconnue")
        return False, 0.0

    next_section = section_order[index + 1] if index + 1 < len(section_order) else None

    # Chercher les marqueurs dans toutes les pistes pour start et end
    for track in mid.tracks:
        abs_time = 0
        for msg in track:
            abs_time += msg.time
            if msg.type == 'marker':
                label = msg.text.strip()
                if label == section_name and start_tick is None:
                    start_tick = abs_time
                elif label == next_section and start_tick is not None:
                    end_tick = abs_time
                    break

    if start_tick is None:
        print(f"Erreur : section '{section_name}' non trouvée")
        return False, 0.0

    # Si pas de section suivante → fin du morceau
    if end_tick is None:
        end_tick = mid.length * mid.ticks_per_beat * 2  # grosse estimation (sécuritaire)

    for track in mid.tracks:
        new_track = MidiTrack()
        abs_time = 0
        in_section = False
        last_tick = 0
        setup_msgs = []

        for msg in track:
            abs_time += msg.time

            if abs_time <= start_tick and (
                msg.type in ['set_tempo', 'key_signature', 'time_signature', 'smpte_offset'] or
                (msg.type == 'control_change' and msg.control in [0, 32]) or
                msg.type in ['program_change', 'pitchwheel', 'sysex']
            ):
                setup_msgs.append(msg.copy(time=msg.time))

            if start_tick <= abs_time <= end_tick:
                if not in_section:
                    # Injecter setup messages avec temps 0
                    for sm in setup_msgs:
                        sm.time = 0
                        new_track.append(sm)
                    in_section = True
                    last_tick = start_tick

                delta = abs_time - last_tick
                new_track.append(msg.copy(time=delta))
                last_tick = abs_time

            elif abs_time > end_tick:
                break

        out.tracks.append(new_track)

    out.save(output_path)

    # Calculer durée réelle de la sortie
    extracted = MidiFile(output_path)
    print(round(extracted.length, 3))  # stdout récupérée côté Node.js

    return True, extracted.length


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print("Usage: python extract_main.py input.mid output.mid section_name")
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    section_name = sys.argv[3]

    success, _ = extract_section(input_path, output_path, section_name)
    if not success:
        sys.exit(1)
