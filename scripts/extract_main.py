from mido import MidiFile, MidiTrack, Message
import sys
import os
import traceback

# Fichier de log pour le debug
DEBUG_LOG = os.path.join(os.path.dirname(__file__), 'python_debug.log')

def log_debug(message):
    try:
        with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
            f.write(message + '\n')
    except Exception:
        pass

def build_markers(mid: MidiFile):
    """Retourne la timeline triée de TOUS les marqueurs: [(tick, label)]."""
    marks = []
    for track in mid.tracks:
        abs_time = 0
        for msg in track:
            abs_time += msg.time
            if msg.is_meta and msg.type == 'marker' and hasattr(msg, 'text'):
                marks.append((abs_time, msg.text.strip()))
    marks.sort(key=lambda x: x[0])
    return marks

def total_ticks(mid: MidiFile) -> int:
    """Tick de fin réelle (max de toutes les pistes)."""
    m = 0
    for tr in mid.tracks:
        t = 0
        for msg in tr:
            t += msg.time
        if t > m:
            m = t
    return m

def extract_section(input_path, output_path, section_name):
    """
    Découpe stricte = [start_marker, prochain_marker):
      - start = tick du marqueur 'section_name'
      - end   = tick du 1er marqueur STRICTEMENT après start (quel qu'il soit)
      - si pas de marqueur suivant -> end = fin réelle (max ticks)
    Sortie sans meta 'marker'. Pas d'injection tempo/sysex/bank/etc.
    """
    try:
        log_debug(f"Début extraction section '{section_name}' depuis {input_path}")

        mid = MidiFile(input_path)
        out = MidiFile(ticks_per_beat=mid.ticks_per_beat)

        # --- 1) Timeline des marqueurs (toutes pistes)
        markers = build_markers(mid)
        if not markers:
            err_msg = "Aucun marqueur trouvé dans le MIDI."
            print(err_msg)
            log_debug(err_msg)
            return False, 0.0

        # --- 2) start = tick du marqueur demandé
        start_tick = None
        for tick, label in markers:
            if label == section_name:
                start_tick = tick
                break

        if start_tick is None:
            err_msg = f"Erreur : section '{section_name}' non trouvée"
            print(err_msg)
            log_debug(err_msg)
            return False, 0.0

        log_debug(f"[{section_name}] start_tick={start_tick}")

        # --- 3) end = 1er marqueur strictement après start (indifférent du libellé)
        end_tick = None
        for tick, _ in markers:
            if tick > start_tick:
                end_tick = tick
                break

        if end_tick is None:
            end_tick = total_ticks(mid)  # fin réelle du morceau
            log_debug(f"[{section_name}] pas de prochain marqueur → end_tick=fin réelle {end_tick}")
        else:
            log_debug(f"[{section_name}] end_tick(prochain marqueur)={end_tick}")

        # garde-fou: intervalle non nul
        if end_tick <= start_tick:
            end_tick = start_tick + 1
            log_debug(f"[{section_name}] garde-fou → end_tick={end_tick}")

        # --- 4) Copie brute des événements dans [start_tick, end_tick), sans 'marker'
        for track in mid.tracks:
            new_track = MidiTrack()
            out.tracks.append(new_track)

            abs_time = 0
            last_emit = start_tick
            pending_noteoffs = set()  # {(ch, note)}

            for msg in track:
                abs_time += msg.time

                if start_tick <= abs_time < end_tick:
                    # ignorer les meta 'marker' dans la sortie
                    if msg.is_meta and msg.type == 'marker':
                        continue

                    delta = int(abs_time - last_emit)
                    new_track.append(msg.copy(time=delta))
                    last_emit = abs_time

                    # suivi des notes à fermer proprement
                    if msg.type == 'note_on' and getattr(msg, 'velocity', 0) > 0:
                        pending_noteoffs.add((msg.channel, msg.note))
                    elif msg.type == 'note_off' or (msg.type == 'note_on' and getattr(msg, 'velocity', 0) == 0):
                        pending_noteoffs.discard((msg.channel, msg.note))

                elif abs_time >= end_tick:
                    break

            # Ajouter les note_off manquants exactement à end_tick
            for ch, note in list(pending_noteoffs):
                delta = int(end_tick - last_emit)
                new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_emit = end_tick

        out.save(output_path)
        log_debug(f"Section extraite sauvegardée dans {output_path}")

        extracted = MidiFile(output_path)
        duration = round(extracted.length, 3)
        print(duration)  # certaines routes lisent la durée sur stdout
        log_debug(f"Durée MIDI extraite : {duration}s (start={start_tick}, end={end_tick})")

        return True, duration

    except Exception as e:
        err_text = f"Exception lors de l'extraction : {str(e)}\n{traceback.format_exc()}"
        print(err_text)
        log_debug(err_text)
        return False, 0.0


if __name__ == "__main__":
    # reset log
    if os.path.exists(DEBUG_LOG):
        try:
            os.remove(DEBUG_LOG)
        except Exception:
            pass

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
