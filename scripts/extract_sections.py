from mido import MidiFile, MidiTrack, Message, MetaMessage
import os
import sys
import traceback
import json
from collections import defaultdict

# ---------- Utilitaires temps absolu ----------
def track_length_abs(track):
    t = 0
    for msg in track:
        t += msg.time
    return t

def file_end_tick(mid):
    return max(track_length_abs(tr) for tr in mid.tracks)

def build_markers_timeline(mid):
    """
    Retourne une liste triée [(tick, label)] de TOUS les marqueurs (dédupliqués par (tick,label)).
    On ne considère que les meta 'marker' (pas 'text', pas 'cue_marker'), comme tu le souhaites.
    """
    markers = []
    seen = set()
    for track in mid.tracks:
        abs_time = 0
        for msg in track:
            abs_time += msg.time
            if msg.is_meta and msg.type in ('marker',):  # strict: seulement 'marker'
                key = (abs_time, msg.text.strip())
                if key not in seen:
                    seen.add(key)
                    markers.append(key)
    markers.sort(key=lambda x: x[0])
    return markers

def find_section_bounds(markers, label, default_end):
    """
    Trouve (start_tick, end_tick) pour LE PREMIER marqueur 'label' rencontré.
    end_tick = tick du PREMIER marqueur suivant chronologiquement, QUEL QUE SOIT SON NOM.
    IMPORTANT: on accepte un "prochain" marqueur au MÊME TICK (tick == start_tick) si présent.
    (=> s'il y a un marqueur juste derrière au même tick, la section est volontairement vide.)
    """
    for i, (tick, text) in enumerate(markers):
        if text == label:
            start_tick = tick
            # Chercher le tout premier marqueur après l'index i, même s'il a le même tick
            end_tick = None
            for j in range(i + 1, len(markers)):
                next_tick, _ = markers[j]
                # NOTE: <= autoriserait de retomber sur le même marqueur; on veut le "suivant" dans la liste,
                # donc on teste à partir de j = i+1 et on accepte tick == start_tick.
                end_tick = next_tick
                break
            if end_tick is None:
                end_tick = default_end
            return start_tick, end_tick
    return None, None

# ---------- Extraction ----------
SETUP_META_TYPES = {'set_tempo', 'time_signature', 'key_signature'}
SETUP_CC = {0, 32}  # Bank Select MSB/LSB

def copy_section(mid, start_tick, end_tick):
    """
    Renvoie un MidiFile ne contenant que [start_tick, end_tick) pour TOUTES les pistes,
    avec restauration des paramètres utiles au début de chaque piste.
    Exclut les meta 'marker' de la sortie.
    Force la fermeture des notes + release sustain + resets à la fin.
    """
    out = MidiFile(ticks_per_beat=mid.ticks_per_beat)

    for src_track in mid.tracks:
        dst = MidiTrack()
        out.tracks.append(dst)

        # État à restaurer au début
        last_meta = {}        # un seul de chaque type meta (tempo, time, key)
        last_cc_bank = {}     # par canal: (cc0, cc32) vus
        last_prog = {}        # par canal: last program_change
        last_sysex = []       # sysex vus avant start

        # Gestion notes ouvertes dans la section
        pending_notes = {}    # (ch, note) -> last_tick_in_dst (abs)

        # 1) Premier passage : collecter états AVANT start et copier flux DANS la fenêtre
        abs_time = 0
        last_emitted_abs = start_tick  # référence pour delta during copy
        in_section = False

        for msg in src_track:
            abs_time += msg.time

            # Collecte de l'état AVANT start_tick
            if abs_time <= start_tick:
                if msg.is_meta and msg.type in SETUP_META_TYPES:
                    last_meta[msg.type] = msg.copy(time=0)
                elif msg.type == 'control_change' and msg.control in SETUP_CC:
                    last_cc_bank[(msg.channel, msg.control)] = msg.value
                elif msg.type == 'program_change':
                    last_prog[msg.channel] = msg.program
                elif msg.type == 'sysex':
                    # garder le dernier sysex vu (certains styles envoient des init)
                    last_sysex.append(msg.copy(time=0))

            # Copie stricte à l'intérieur [start, end)
            if start_tick <= abs_time < end_tick:
                if not in_section:
                    # Injecter état au tick 0 de la section
                    # Ordre: sysex -> tempo -> time_sig -> key_sig -> bank -> program
                    for syx in last_sysex:
                        dst.append(syx.copy(time=0))
                    for t in ('set_tempo', 'time_signature', 'key_signature'):
                        if t in last_meta:
                            dst.append(last_meta[t].copy(time=0))
                    # Bank select (émettre CC0 puis CC32 si disponibles par canal)
                    by_ch = defaultdict(dict)
                    for (ch, cc), val in last_cc_bank.items():
                        by_ch[ch][cc] = val
                    # CC0 puis CC32
                    for ch, m in by_ch.items():
                        if 0 in m:
                            dst.append(Message('control_change', channel=ch, control=0, value=m[0], time=0))
                        if 32 in m:
                            dst.append(Message('control_change', channel=ch, control=32, value=m[32], time=0))
                    # Program change
                    for ch, prog in last_prog.items():
                        dst.append(Message('program_change', channel=ch, program=prog, time=0))

                    in_section = True
                    last_emitted_abs = start_tick

                # Sauter les meta 'marker' pour ne jamais les inclure
                if msg.is_meta and msg.type == 'marker':
                    continue

                delta = abs_time - last_emitted_abs
                copied = msg.copy(time=delta)

                # Normaliser les note_off
                if copied.type == 'note_on' and copied.velocity > 0:
                    pending_notes[(copied.channel, copied.note)] = abs_time
                elif copied.type == 'note_off' or (copied.type == 'note_on' and copied.velocity == 0):
                    pending_notes.pop((copied.channel, copied.note), None)

                dst.ap
