from mido import MidiFile, MidiTrack, Message

def force_instruments(midi_path, output_path):
    mid = MidiFile(midi_path)
    for track in mid.tracks:
        new_events = []
        used_channels = set()
        for msg in track:
            if msg.type in ('program_change', 'control_change'):
                used_channels.add(msg.channel)
        for ch in used_channels:
            # Exemple : Bank 0, LSB 0, instrument 0 (acoustic grand piano)
            new_events.extend([
                Message('control_change', channel=ch, control=0, value=0, time=0),  # MSB
                Message('control_change', channel=ch, control=32, value=0, time=0), # LSB
                Message('program_change', channel=ch, program=0, time=0)            # PC
            ])
        track[:] = new_events + track
    mid.save(output_path)
    print(f"✅ MIDI corrigé exporté vers {output_path}")
