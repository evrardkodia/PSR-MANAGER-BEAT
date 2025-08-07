from mido import MidiFile, MidiTrack, Message, MetaMessage
import os
import traceback

DEBUG_LOG = os.path.join(os.path.dirname(__file__), 'python_debug.log')

def log_debug(message):
    with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
        f.write(message + '\n')

def extract_section(input_path, output_path, section_name):
    try:
        log_debug(f"Début extraction section '{section_name}' depuis {input_path}")
        mid = MidiFile(input_path)
        ticks_per_beat = mid.ticks_per_beat
        out = MidiFile(ticks_per_beat=ticks_per_beat)

        start_tick = None
        end_tick = None

        section_order = [
            'Intro A', 'Intro B', 'Intro C', 'Intro D',
            'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
            'Main A', 'Main B', 'Main C', 'Main D',
            'Ending A', 'Ending B', 'Ending C', 'Ending D'
        ]

        try:
            index = section_order.index(section_name)
        except ValueError:
            log_debug(f"Section {section_name} non reconnue")
            return False, 0.0

        next_section = section_order[index + 1] if index + 1 < len(section_order) else None

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
            log_debug(f"Section {section_name} absente.")
            return False, 0.0

        if end_tick is None:
            end_tick = mid.length * ticks_per_beat * 2

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
                    msg.type in ['set_tempo', 'key_signature', 'time_signature', 'smpte_offset'] or
                    (msg.type == 'control_change' and msg.control in [0, 32]) or
                    msg.type in ['program_change', 'pitchwheel', 'sysex']
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
                    elif msg.type in ('note_off',) or (msg.type == 'note_on' and msg.velocity == 0):
                        pending_noteoffs.pop((msg.channel, msg.note), None)

                elif abs_time > end_tick:
                    break

            for (ch, note), t in pending_noteoffs.items():
                delta = end_tick - last_tick
                new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_tick = end_tick

            out.tracks.append(new_track)

        out.save(output_path)
        extracted = MidiFile(output_path)
        log_debug(f"Section {section_name} extraite vers {output_path} (durée: {extracted.length:.2f}s)")
        return True, round(extracted.length, 2)

    except Exception as e:
        err_text = f"Erreur extraction {section_name} : {str(e)}\n{traceback.format_exc()}"
        log_debug(err_text)
        return False, 0.0


if __name__ == "__main__":
    import sys

    if os.path.exists(DEBUG_LOG):
        os.remove(DEBUG_LOG)

    if len(sys.argv) != 2:
        print("Usage: python extract_all_sections.py input.mid")
        sys.exit(1)

    input_path = sys.argv[1]
    base_name = os.path.splitext(os.path.basename(input_path))[0]
    output_dir = os.path.dirname(input_path)

    sections_to_extract = [
        'Intro A', 'Intro B', 'Intro C', 'Intro D',
    'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
    'Main A', 'Main B', 'Main C', 'Main D',
    'Ending A', 'Ending B', 'Ending C', 'Ending D'
    ]

    for section in sections_to_extract:
        output_path = os.path.join(output_dir, f"{base_name}_{section.replace(' ', '_')}.mid")
        extract_section(input_path, output_path, section)
