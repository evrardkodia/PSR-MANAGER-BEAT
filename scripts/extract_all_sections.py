def extract_section(mid, section_name, _next_section_name_unused, output_path):
    """
    Coupe la section [start_marker, prochain_marker) :
    - start = tick du marqueur 'section_name'
    - end   = tick du 1er marqueur strictement après start (peu importe son libellé)
    - si pas de marqueur après: end = fin réelle du morceau
    - on n'exporte pas les meta 'marker'
    """
    try:
        out = MidiFile(ticks_per_beat=mid.ticks_per_beat)

        # 1) Construire la timeline de TOUS les marqueurs (tick, label), toutes pistes confondues
        markers = []
        for track in mid.tracks:
            abs_time = 0
            for msg in track:
                abs_time += msg.time
                if msg.is_meta and msg.type == 'marker' and hasattr(msg, 'text'):
                    markers.append((abs_time, msg.text.strip()))
        markers.sort(key=lambda x: x[0])

        # 2) start = tick du marqueur 'section_name'
        start_tick = None
        for i, (tick, label) in enumerate(markers):
            if label == section_name:
                start_tick = tick
                break
        if start_tick is None:
            return {section_name: 0}

        # 3) end = tick du PREMIER marqueur STRICTEMENT après start_tick (quel qu'il soit)
        end_tick = None
        for tick, _ in markers:
            if tick > start_tick:
                end_tick = tick
                break
        if end_tick is None:
            # pas de marqueur suivant -> fin réelle (max des ticks)
            end_tick = 0
            for tr in mid.tracks:
                t = 0
                for msg in tr:
                    t += msg.time
                if t > end_tick:
                    end_tick = t

        # garde-fou: au moins 1 tick
        if end_tick <= start_tick:
            end_tick = start_tick + 1

        # 4) Copier bruts les événements dans [start_tick, end_tick), sans ré-injecter de setup (comme demandé)
        for track in mid.tracks:
            new_track = MidiTrack()
            out.tracks.append(new_track)

            abs_time = 0
            last_emit = start_tick
            pending_notes = set()  # {(ch, note)}

            for msg in track:
                abs_time += msg.time

                if start_tick <= abs_time < end_tick:
                    # ignorer les meta 'marker' dans la sortie
                    if msg.is_meta and msg.type == 'marker':
                        continue

                    delta = int(abs_time - last_emit)
                    new_track.append(msg.copy(time=delta))
                    last_emit = abs_time

                    # suivi des notes pour fermer proprement à la fin
                    if msg.type == 'note_on' and getattr(msg, 'velocity', 0) > 0:
                        pending_notes.add((msg.channel, msg.note))
                    elif msg.type == 'note_off' or (msg.type == 'note_on' and getattr(msg, 'velocity', 0) == 0):
                        pending_notes.discard((msg.channel, msg.note))

                elif abs_time >= end_tick:
                    break

            # 5) Fermer les notes encore ouvertes exactement à end_tick
            for ch, note in list(pending_notes):
                delta = int(end_tick - last_emit)
                new_track.append(Message('note_off', channel=ch, note=note, velocity=0, time=delta))
                last_emit = end_tick

        out.save(output_path)
        return {section_name: 1}

    except Exception:
        print("Erreur dans extract_section:", traceback.format_exc(), file=sys.stderr)
        return {section_name: 0}

def extract_all_sections(input_path, output_dir):
    # L'ordre ici ne sert plus à borner la fin : on découpe au prochain marqueur réel
    sections = [
        'Intro A', 'Intro B', 'Intro C', 'Intro D',
        'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD',
        'Main A', 'Main B', 'Main C', 'Main D',
        'Ending A', 'Ending B', 'Ending C', 'Ending D'
    ]

    result = {"sections": []}

    try:
        mid = MidiFile(input_path)

        # beatId depuis le nom d'entrée: ex "9_full.mid" -> "9"
        basename = os.path.basename(input_path)
        beat_id = basename.split('_')[0] if '_' in basename else 'unknown'

        for i, section in enumerate(sections):
            next_section = sections[i + 1] if i + 1 < len(sections) else None  # ignoré par extract_section
            filename = f"{beat_id}_{section.replace(' ', '_')}.mid"
            output_file = os.path.join(output_dir, filename)
            section_result = extract_section(mid, section, next_section, output_file)
            if section_result.get(section) == 1:
                result["sections"].append({
                    "sectionName": section,
                    "midFilename": filename,
                    "url": f"{BASE_URL}/{filename}"
                })

        print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        err_json = json.dumps({"error": f"Erreur générale : {str(e)}"})
        print(err_json, file=sys.stderr)
        print(err_json)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 extract_all_sections.py input_full.mid output_dir")
        sys.exit(1)

    input_full_mid = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    extract_all_sections(input_full_mid, output_dir)
