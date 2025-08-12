from mido import MidiFile, MidiTrack, Message
import os
import sys
import traceback

def log(msg):
    print(msg, flush=True)  # flush=True pour que ça s'affiche tout de suite

def extract_section(mid, section_name, next_section_name, output_path):
    try:
        ticks_per_beat = mid.ticks_per_beat
        out = MidiFile(ticks_per_beat=ticks_per_beat)

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
                break

        if start_tick is None:
            log(f"[WARN] Section '{section_name}' non trouvée dans le fichier MIDI.")
            return False

        if end_tick is None:
            # Prendre une valeur après la fin (marge large)
            end_tick = int(mid.length * ticks_per_beat * 4)

        for track in mid.tracks:
            new_track = MidiTrack()
            abs_time = 0
            in_section = False
            last_tick = 0
            setup_msgs = []
            pending_noteoffs = {}

            for msg in track:
                abs_time += msg.time

                if not in_section and abs_time <= start_tick and (
                    msg.type in ['set_tempo', 'key_signature', 'time_signature'] or
                    (msg.type == 'control_change' and msg.control in [0, 32]) or
                    msg.type in ['program_change', 'sysex']
                ):
                    setup_msgs.append(msg.copy(time=msg.time))

                if start_tick <= abs_time <= end_tick:
                    if not in_section:
                        for sm in setup_msgs:
                            sm.time = 0
                            new_track.append(sm)
                        in_section = True
                        last_tick = start_tick

                    delta = abs_time - last_tick
                    new_track.append(msg.copy(time=delta))
                    last_tick = abs_time

                    if msg.type == 'note_on' and msg.velocity > 0:
                        pending_noteoffs[(msg.channel, msg.note)] = last_tick
                    elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                        pending_noteoffs.pop((msg.channel, msg.note), None)

                elif abs_time > end_tick:
                    break

            # Fermer notes ouvertes
            for (ch, note), t in pending_noteoffs.items():
                delta = end_tick - last_tick
                new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_tick = end_tick

            out.tracks.append(new_track)

        out.save(output_path)
        log(f"[OK] Section '{section_name}' extraite vers '{output_path}'.")
        return True

    except Exception:
        log(f"[ERREUR] Extraction section '{section_name}' échouée:\n{traceback.format_exc()}")
        return False

def extract_all_sections(input_mid_path, output_dir):
    sections = [
        'Intro A', 'Intro B', 'Intro C', 'Intro D',
        'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
        'Main A', 'Main B', 'Main C', 'Main D',
        'Ending A', 'Ending B', 'Ending C', 'Ending D'
    ]

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    mid = MidiFile(input_mid_path)

    log(f"Début extraction de toutes les sections depuis '{input_mid_path}' vers '{output_dir}'.")

    for i, section in enumerate(sections):
        next_section = sections[i + 1] if i + 1 < len(sections) else None
        filename = f"{section.replace(' ', '_')}.mid"
        output_path = os.path.join(output_dir, filename)
        success = extract_section(mid, section, next_section, output_path)
        if not success:
            log(f"[WARN] Section '{section}' non extraite.")

    log("Extraction terminée.")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python extract_all_sections.py input_full.mid output_directory")
        sys.exit(1)

    input_mid = sys.argv[1]
    output_dir = sys.argv[2]

    extract_all_sections(input_mid, output_dir)
