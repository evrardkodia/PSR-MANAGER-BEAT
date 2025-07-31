# utils/sty2midi.py
import sys
import os
import traceback
from mido import Message, MidiFile, MidiTrack, MetaMessage

DEBUG_LOG = os.path.join(os.path.dirname(__file__), 'sty2midi_debug.log')

def log_debug(message):
    with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
        f.write(message + '\n')

def convert_sty_to_midi(sty_path, output_path):
    try:
        log_debug(f"Démarrage conversion STY → MIDI : {sty_path}")
        mid = MidiFile()
        track = MidiTrack()
        mid.tracks.append(track)

        # Tempo : 120 bpm (500000 us par tempo)
        track.append(MetaMessage('set_tempo', tempo=500000, time=0))

        # Bank Select MSB (controller 0) à 127 (StandardKit1)
        track.append(Message('control_change', control=0, value=127, time=0))
        # Bank Select LSB (controller 32) à 0
        track.append(Message('control_change', control=32, value=0, time=0))
        # Program Change à 0 (StandardKit1)
        track.append(Message('program_change', program=0, time=0))

        # Notes percussions sur canal 9 (index 9)
        # Quelques notes typiques batterie : grosse caisse (35), caisse claire (38), charleston (42)
        percussion_notes = [35, 38, 42]
        for note in percussion_notes:
            track.append(Message('note_on', channel=9, note=note, velocity=127, time=480))
            track.append(Message('note_off', channel=9, note=note, velocity=127, time=480))

        mid.save(output_path)
        success_msg = f"✅ MIDI StandardKit1 généré : {output_path}"
        print(success_msg)
        log_debug(success_msg)

    except Exception as e:
        err_text = f"Exception dans convert_sty_to_midi : {str(e)}\n{traceback.format_exc()}"
        print(err_text)
        log_debug(err_text)
        sys.exit(1)

if __name__ == '__main__':
    # Nettoyer fichier debug au démarrage
    if os.path.exists(DEBUG_LOG):
        os.remove(DEBUG_LOG)

    if len(sys.argv) < 3:
        usage = "Usage: sty2midi.py input.sty output.mid"
        print(usage)
        with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
            f.write(usage + '\n')
        sys.exit(1)

    convert_sty_to_midi(sys.argv[1], sys.argv[2])
