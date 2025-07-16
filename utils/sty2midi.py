# utils/sty2midi.py
import sys
from mido import Message, MidiFile, MidiTrack, MetaMessage

def convert_sty_to_midi(sty_path, output_path):
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
    print(f"✅ MIDI StandardKit1 généré : {output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: sty2midi.py input.sty output.mid")
        sys.exit(1)

    convert_sty_to_midi(sys.argv[1], sys.argv[2])
