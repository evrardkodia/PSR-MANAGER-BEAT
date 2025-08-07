from mido import MidiFile, MidiTrack, Message, MetaMessage
import sys
import os
import traceback

# Fichier de log pour le debug
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

        # Ordre logique des sections dans le fichier MIDI
        section_order = ['Intro A', 'Intro B', 'Intro C', 'Intro D',
                         'Main A', 'Main B', 'Main C', 'Main D',
                         'Ending A', 'Ending B', 'Ending C', 'Ending D']

        # Trouver la section demandée
        try:
            index = section_order.index(section_name)
        except ValueError:
            err_msg = f"Erreur : section '{section_name}' non reconnue"
            print(err_msg)
            log_debug(err_msg)
            return False, 0.0

        next_section = section_order[index + 1] if index + 1 < len(section_order) else None

        # Recherche des marqueurs de début et fin de section
        for track in mid.tracks:
            abs_time = 0
            for msg in track:
                abs_time += msg.time
                if msg.type == 'marker':
                    label = msg.text.strip()
                    if label == section_name and start_tick is None:
                        start_tick = abs_time
                        log_debug(f"Début section trouvé à tick {start_tick}")
                    elif label == next_section and start_tick is not None:
                        end_tick = abs_time
                        log_debug(f"Fin section trouvé à tick {end_tick}")
                        break

        if start_tick is None:
            err_msg = f"Erreur : section '{section_name}' non trouvée"
            print(err_msg)
            log_debug(err_msg)
            return False, 0.0

        if end_tick is None:
            end_tick = mid.length * ticks_per_beat * 2  # estimation prudente
            log_debug(f"Aucune fin section trouvée, estimation à tick {end_tick}")

        # Extraire les messages MIDI pour cette section
        for track in mid.tracks:
            new_track = MidiTrack()
            abs_time = 0
            in_section = False
            last_tick = 0
            setup_msgs = []
            pending_noteoffs = {}

            for msg in track:
                abs_time += msg.time

                # Enregistrer les messages de setup avant la section
                if abs_time <= start_tick and (
                    msg.type in ['set_tempo', 'key_signature', 'time_signature', 'smpte_offset'] or
                    (msg.type == 'control_change' and msg.control in [0, 32]) or
                    msg.type in ['program_change', 'pitchwheel', 'sysex']
                ):
                    setup_msgs.append(msg.copy(time=msg.time))

                # Pendant la section
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

                    # ✅ Injection depuis code C : gestion fine des note_off restants
                    if msg.type == 'note_on' and msg.velocity > 0:
                        pending_noteoffs[(msg.channel, msg.note)] = last_tick
                    elif msg.type in ('note_off',) or (msg.type == 'note_on' and msg.velocity == 0):
                        pending_noteoffs.pop((msg.channel, msg.note), None)

                elif abs_time > end_tick:
                    break

            # ✅ Injection depuis code C : envoyer les note_off restants à la fin
            for (ch, note), t in pending_noteoffs.items():
                delta = end_tick - last_tick
                new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_tick = end_tick

            out.tracks.append(new_track)

        # Sauvegarde du nouveau fichier MIDI
        out.save(output_path)
        log_debug(f"Section extraite sauvegardée dans {output_path}")

        extracted = MidiFile(output_path)
        duration = round(extracted.length, 3)
        print(duration)  # stdout captée dans Node.js
        log_debug(f"Durée MIDI extraite : {duration}s")

        return True, duration

    except Exception as e:
        err_text = f"Exception lors de l'extraction : {str(e)}\n{traceback.format_exc()}"
        print(err_text)
        log_debug(err_text)
        return False, 0.0


if __name__ == "__main__":
    # Nettoyer fichier debug avant exécution
    if os.path.exists(DEBUG_LOG):
        os.remove(DEBUG_LOG)

    if len(sys.argv) != 4:
        usage = "Usage: python extract_main.py input.mid output.mid section_name"
        print(usage)
        log_debug(usage)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    section_name = sys.argv[3]

    success, _ = extract_section(input_path, output_path, section_name)
    if not success:
        sys.exit(1)
