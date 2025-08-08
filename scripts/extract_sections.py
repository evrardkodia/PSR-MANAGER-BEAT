from mido import MidiFile, MidiTrack, Message
import os
import sys
import traceback

DEBUG_LOG = os.path.join(os.path.dirname(__file__), 'python_debug.log')

def log_debug(message):
    with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
        f.write(message + '\n')

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
                if msg.type == 'marker':
                    label = msg.text.strip()
                    if label == section_name and start_tick is None:
                        start_tick = abs_time
                    elif label == next_section_name and start_tick is not None:
                        end_tick = abs_time
                        break

        if start_tick is None:
            print(f"{section_name} non trouvé")
            return False

        if end_tick is None:
            end_tick = mid.length * ticks_per_beat * 2  # estimation large

        for track in mid.tracks:
            new_track = MidiTrack()
            abs_time = 0
            in_section = False
            last_tick = 0
            setup_msgs = []
            pending_noteoffs = {}

            for msg in track:
                abs_time += msg.time

                if abs_time <= start_tick and (
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

            for (ch, note), t in pending_noteoffs.items():
                delta = end_tick - last_tick
                new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_tick = end_tick

            out.tracks.append(new_track)

        out.save(output_path)
        print(f"✅ {section_name} extrait → {os.path.basename(output_path)}")
        return True

    except Exception as e:
        print(f"Erreur lors de l'extraction de {section_name}: {e}")
        log_debug(traceback.format_exc())
        return False

def extract_all_sections(input_path, output_dir):
    if os.path.exists(DEBUG_LOG):
        os.remove(DEBUG_LOG)

    try:
        mid = MidiFile(input_path)

        sections = [
            'Intro A', 'Intro B', 'Intro C', 'Intro D',
            'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
            'Main A', 'Main B', 'Main C', 'Main D',
            'Ending A', 'Ending B', 'Ending C', 'Ending D'
        ]

        for i, section in enumerate(sections):
            next_section = sections[i + 1] if i + 1 < len(sections) else None
            output_file = os.path.join(output_dir, f"{section.replace(' ', '_')}.mid")
            extract_section(mid, section, next_section, output_file)

    except Exception as e:
        print(f"Erreur générale : {e}")
        log_debug(traceback.format_exc())

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python extract_sections.py input.mid output_directory")
        sys.exit(1)

    input_mid = sys.argv[1]
    output_directory = sys.argv[2]

    if not os.path.exists(output_directory):
        os.makedirs(output_directory)

    extract_all_sections(input_mid, output_directory)
