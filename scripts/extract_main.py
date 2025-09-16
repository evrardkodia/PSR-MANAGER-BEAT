from mido import MidiFile, MidiTrack, Message, MetaMessage
import os

input_path = './temp/test_extraction.mid'
output_path = './temp/mainA_extracted.mid'

mid = MidiFile(input_path)
ticks_per_beat = mid.ticks_per_beat
out = MidiFile(ticks_per_beat=ticks_per_beat)

# Étape 1 : Trouver les ticks de début et fin de la section "Main A"
start_tick = None
end_tick = None

for track in mid.tracks:
    abs_time = 0
    for msg in track:
        abs_time += msg.time
        if msg.type == 'marker' and 'Main A' in msg.text:
            start_tick = abs_time
        if msg.type == 'marker' and start_tick is not None and 'Main B' in msg.text:
            end_tick = abs_time
            break

if start_tick is None or end_tick is None:
    print("❌ Aucun événement trouvé pour la section 'Main A'")
    exit(1)

print(f"⏱ Main A start tick: {start_tick}, end tick: {end_tick}")

# Étape 2 : Extraire les événements essentiels + Main A
for i, track in enumerate(mid.tracks):
    new_track = MidiTrack()
    abs_time = 0
    buffer_setup = []
    in_mainA = False

    for msg in track:
        abs_time += msg.time

        # Toujours garder tempo, signature, sysex, CC initiaux
        if abs_time <= start_tick and (
            msg.type in ['set_tempo', 'time_signature', 'key_signature', 'smpte_offset'] or
            (msg.type == 'control_change' and msg.control in [0, 32]) or  # MSB/LSB
            msg.type in ['program_change', 'pitchwheel', 'sysex']
        ):
            buffer_setup.append(msg.copy(time=msg.time))

        # Une fois arrivé dans Main A
        if start_tick <= abs_time <= end_tick:
            if not in_mainA:
                # Insérer le buffer setup avant de commencer la section
                for setup_msg in buffer_setup:
                    new_track.append(setup_msg.copy())
                in_mainA = True
            new_track.append(msg.copy(time=msg.time))

        # Si on a fini la section Main A
        if abs_time > end_tick:
            break

    out.tracks.append(new_track)

# Étape 3 : Sauvegarde
out.save(output_path)
print(f"✅ Section 'Main A' extraite avec contexte et fidélité : {output_path}")

