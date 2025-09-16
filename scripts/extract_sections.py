from mido import MidiFile, MidiTrack, Message
import os
import sys
import traceback
import json
from collections import defaultdict

# ---------- Utils temps absolu ----------
def track_length_abs(track):
    t = 0
    for msg in track:
        t += msg.time
    return t

def file_end_tick(mid):
    return max(track_length_abs(tr) for tr in mid.tracks)

def norm_label(s: str) -> str:
    # trim, lower, underscores->space, compress spaces
    return " ".join(s.strip().lower().replace("_", " ").split())

def label_matches(lbl: str, wanted: str) -> bool:
    """Match tolérant: exact normalisé OU prefix OU contains (au besoin)."""
    a = norm_label(lbl)
    b = norm_label(wanted)
    if a == b:
        return True
    if a.startswith(b) or b.startswith(a):
        return True
    # dernier filet: contains (ex: "main b (var)" contient "main b")
    if b in a:
        return True
    return False

def build_markers_timeline(mid):
    """
    Retourne une liste triée [(tick, label, type)] de TOUS les marqueurs,
    en incluant 'marker', 'text', 'cue_marker'. Dédupliqués par (tick,label,type).
    """
    markers = []
    seen = set()
    for track in mid.tracks:
        abs_time = 0
        for msg in track:
            abs_time += msg.time
            if msg.is_meta and msg.type in ('marker', 'text', 'cue_marker') and hasattr(msg, 'text'):
                key = (abs_time, msg.text.strip(), msg.type)
                if key not in seen:
                    seen.add(key)
                    markers.append(key)
    markers.sort(key=lambda x: x[0])
    return markers

def find_section_bounds(markers, wanted_label, default_end):
    """
    start_tick = 1er marqueur dont le label matche (tolérant)
    end_tick   = 1er marqueur avec tick STRICTEMENT > start_tick (quel qu'il soit)
    """
    start_tick = None
    # 1) trouver start
    for (tick, label, _typ) in markers:
        if label_matches(label, wanted_label):
            start_tick = tick
            break
    if start_tick is None:
        return None, None

    # 2) trouver end: tick > start_tick (pas le suivant "index", le suivant "temps")
    end_tick = None
    for (tick, _label, _typ) in markers:
        if tick > start_tick:
            end_tick = tick
            break

    if end_tick is None:
        end_tick = default_end
    if end_tick <= start_tick:
        end_tick = start_tick + 1  # garde-fou
    return start_tick, end_tick

# ---------- Extraction ----------
SETUP_META_TYPES = {'set_tempo', 'time_signature', 'key_signature'}
SETUP_CC = {0, 32}  # Bank Select MSB/LSB

def copy_section(mid, start_tick, end_tick):
    """
    Renvoie un MidiFile ne contenant que [start_tick, end_tick) pour TOUTES les pistes.
    - Restaure un état minimal (sysex/tempo/time/key/bank/program) au début de chaque piste
      pour garder le rendu stable selon les synthés.
    - Exclut les meta 'marker'/'text'/'cue_marker' de la sortie.
    - Ferme les notes et envoie sustain off + all notes off + reset controllers à la fin.
    """
    out = MidiFile(ticks_per_beat=mid.ticks_per_beat)

    for src_track in mid.tracks:
        dst = MidiTrack()
        out.tracks.append(dst)

        # État à restaurer au début
        last_meta = {}        # 'set_tempo','time_signature','key_signature'
        last_cc_bank = {}     # (ch,cc)->val pour cc0/cc32
        last_prog = {}        # ch->program
        last_sysex = []       # sysex avant start

        # Suivi notes ouvertes
        pending_notes = {}

        abs_time = 0
        last_emitted_abs = start_tick
        in_section = False

        for msg in src_track:
            abs_time += msg.time

            # collecte état avant la fenêtre
            if abs_time <= start_tick:
                if msg.is_meta and msg.type in SETUP_META_TYPES:
                    last_meta[msg.type] = msg.copy(time=0)
                elif msg.type == 'control_change' and msg.control in SETUP_CC:
                    last_cc_bank[(msg.channel, msg.control)] = msg.value
                elif msg.type == 'program_change':
                    last_prog[msg.channel] = msg.program
                elif msg.type == 'sysex':
                    last_sysex.append(msg.copy(time=0))

            # copie dans la fenêtre
            if start_tick <= abs_time < end_tick:
                if not in_section:
                    # injecter l'état au début
                    for syx in last_sysex:
                        dst.append(syx.copy(time=0))
                    for t in ('set_tempo', 'time_signature', 'key_signature'):
                        if t in last_meta:
                            dst.append(last_meta[t].copy(time=0))
                    # bank select: cc0 puis cc32
                    by_ch = defaultdict(dict)
                    for (ch, cc), val in last_cc_bank.items():
                        by_ch[ch][cc] = val
                    for ch, m in by_ch.items():
                        if 0 in m:
                            dst.append(Message('control_change', channel=ch, control=0, value=m[0], time=0))
                        if 32 in m:
                            d
