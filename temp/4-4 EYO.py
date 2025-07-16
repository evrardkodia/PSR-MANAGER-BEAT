
from mido import MidiFile, MidiTrack, Message, MetaMessage

def convert(output_path):
    mid = MidiFile()
    track = MidiTrack()
    mid.tracks.append(track)

    track.append(MetaMessage('set_tempo', tempo=500000))  # tempo à 120

    track.append(Message('note_on', note=35, velocity=64, time=0))
    track.append(Message('note_on', note=38, velocity=64, time=0))
    track.append(Message('note_on', note=42, velocity=64, time=0))
    track.append(Message('note_off', note=35, velocity=64, time=480))
    track.append(Message('note_off', note=38, velocity=64, time=480))
    track.append(Message('note_off', note=42, velocity=64, time=480))

    mid.save(output_path)

if __name__ == "__main__":
    import sys
    convert(sys.argv[1])
