# utils/sty_parser.py
import sys
import os
import traceback

DEBUG_LOG = os.path.join(os.path.dirname(__file__), 'sty_parser_debug.log')

def log_debug(message):
    with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
        f.write(message + '\n')

def extract_midi_from_sty(sty_path, output_mid_path):
    try:
        log_debug(f"Démarrage extraction MIDI depuis STY : {sty_path}")
        with open(sty_path, 'rb') as f:
            data = f.read()

        start = data.find(b'MThd')
        if start == -1:
            msg = "⚠️ Aucun header MIDI trouvé dans le fichier STY"
            print(msg)
            log_debug(msg)
            return False

        midi_data = data[start:]

        with open(output_mid_path, 'wb') as f:
            f.write(midi_data)

        success_msg = f"✅ MIDI extrait dans {output_mid_path}"
        print(success_msg)
        log_debug(success_msg)
        return True

    except Exception as e:
        err_text = f"Exception dans extract_midi_from_sty : {str(e)}\n{traceback.format_exc()}"
        print(err_text)
        log_debug(err_text)
        return False

if __name__ == '__main__':
    # Nettoyer fichier debug avant chaque run
    if os.path.exists(DEBUG_LOG):
        os.remove(DEBUG_LOG)

    if len(sys.argv) < 3:
        usage = "Usage: python sty_parser.py input.sty output.mid"
        print(usage)
        with open(DEBUG_LOG, 'a', encoding='utf-8') as f:
            f.write(usage + '\n')
        sys.exit(1)

    input_sty = sys.argv[1]
    output_mid = sys.argv[2]

    success = extract_midi_from_sty(input_sty, output_mid)
    if not success:
        sys.exit(1)
