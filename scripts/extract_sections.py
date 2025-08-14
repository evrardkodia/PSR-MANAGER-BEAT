from mido import MidiFile, MidiTrack, Message, MetaMessage
import os
import sys
import traceback
import json

def extract_section(mid, section_name, next_section_name, output_path):
    """
    Extrait une section du MIDI en se basant sur les markers.
    Supprime les silences en fin de section et n'inclut pas les notes des sections suivantes.
    """
    try:
        ticks_per_beat = mid.ticks_per_beat
        out = MidiFile(ticks_per_beat=ticks_per_beat)
        start_tick = None
        end_tick = None

        # 1️⃣ Détecter start et end ticks
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
            return {section_name: 0}  # section non trouvée

        if end_tick is None:
            # Si pas de marqueur de fin, prend le dernier tick réel du midi
            end_tick = max(
                sum(msg.time for msg in track) for track in mid.tracks
            )

        # 2️⃣ Extraire la section
        for track in mid.tracks:
            new_track = MidiTrack()
            abs_time = 0
            in_section = False
            last_tick = 0
            setup_msgs = []

            # Liste des notes ouvertes pour fermeture correcte
            open_notes = []

            for msg in track:
                abs_time += msg.time

                # Messages setup avant section
                if not in_section and abs_time <= start_tick and (
                    msg.type in ['set_tempo', 'key_signature', 'time_signature'] or
                    (msg.type == 'control_change' and msg.control in [0, 32]) or
                    msg.type in ['program_change', 'sysex']
                ):
                    setup_msgs.append(msg.copy(time=msg.time))

                # Messages pendant la section
                if start_tick <= abs_time <= end_tick:
                    if not in_section:
                        # injecter setup à time=0
                        for sm in setup_msgs:
                            sm.time = 0
                            new_track.append(sm)
                        in_section = True
                        last_tick = start_tick

                    delta = abs_time - last_tick
                    new_track.append(msg.copy(time=delta))
                    last_tick = abs_time

                    # Suivi note_on/note_off
                    if msg.type == 'note_on' and msg.velocity > 0:
                        open_notes.append((msg.channel, msg.note))
                    elif (msg.type == 'note_off') or (msg.type == 'note_on' and msg.velocity == 0):
                        if (msg.channel, msg.note) in open_notes:
                            open_notes.remove((msg.channel, msg.note))

            # 3️⃣ Fermer automatiquement les notes encore ouvertes à la fin de la section
            if open_notes:
                for ch, note in open_notes:
                    new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=0))

            out.tracks.append(new_track)

        # 4️⃣ Sauvegarde
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
