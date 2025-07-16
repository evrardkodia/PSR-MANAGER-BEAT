# utils/sty_parser.py
import sys

def extract_midi_from_sty(sty_path, output_mid_path):
    with open(sty_path, 'rb') as f:
        data = f.read()

    # Recherche du header MIDI (MThd)
    start = data.find(b'MThd')
    if start == -1:
        print("⚠️ Aucun header MIDI trouvé dans le fichier STY")
        return False

    # Extraction des données MIDI depuis le header jusqu'à la fin
    midi_data = data[start:]

    with open(output_mid_path, 'wb') as f:
        f.write(midi_data)

    print(f"✅ MIDI extrait dans {output_mid_path}")
    return True

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python sty_parser.py input.sty output.mid")
        sys.exit(1)

    input_sty = sys.argv[1]
    output_mid = sys.argv[2]

    success = extract_midi_from_sty(input_sty, output_mid)
    if not success:
        sys.exit(1)
