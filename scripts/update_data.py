#!/usr/bin/env python3
"""
Hockey.AI data pipeline — runs on GitHub Actions every 30 min.

1. Fetches FIH TMS pool-standings PDF (competition 1866) and parses it.
2. Flips match statuses (scheduled -> live -> completed) based on kickoff times.
3. BACK-FILLS final scores from TMS standings deltas — each team's GF/GA delta
   uniquely determines its new result as long as it played at most one match
   since the last snapshot (guaranteed at a 30-min cadence).
4. Enriches every completed match that has a score but no timeline: seeded,
   roster-aware events, penalty-corner counts, match stats and commentary
   beats — deterministic per match and clearly labeled "estimated". Manual
   data always wins; the pipeline never overwrites existing events/scores.
5. Recomputes every player's tournament stats and AI positional rating (/100,
   volume-weighted) from the full event ledger after each completed match.
6. Slots knockout fixtures (QF/SF/medals) from real standings as pools and
   rounds complete, and publishes bracket-aware Oracle picks before push-back.
7. Bumps data-version.json only when something changed -> installed PWAs resync.

Manual score entry: edit public/data/fixtures.json in the GitHub web UI
(set score.home/score.away, status "completed", penalty_corners, events)
— this script will never overwrite a manually-entered score or timeline.
"""
import io
import json
import math
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
TMS_URL = 'https://tms.fih.ch/competitions/1866/reports/poolstandings'
CET = timezone(timedelta(hours=2))  # August = CEST (UTC+2)

TEAM_CODE_MAP = {
    'netherlands': 'NED', 'argentina': 'ARG', 'new zealand': 'NZL', 'japan': 'JPN',
    'belgium': 'BEL', 'france': 'FRA', 'germany': 'GER', 'malaysia': 'MAS',
    'australia': 'AUS', 'spain': 'ESP', 'ireland': 'IRL', 'south africa': 'RSA',
    'india': 'IND', 'england': 'ENG', 'pakistan': 'PAK', 'wales': 'WAL',
}

def load(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return json.load(f)

def save(name, obj):
    with open(os.path.join(DATA_DIR, name), 'w') as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)

def now_utc():
    return datetime.now(timezone.utc)

def kickoff(m):
    return datetime.fromisoformat(f"{m['date']}T{m['time']}:00").replace(tzinfo=CET)

def has_score(m):
    s = m.get('score') or {}
    return s.get('home') is not None and s.get('away') is not None

# Deterministic per-match RNG so estimated enrichment never changes between runs
def seeded_rng(seed_str):
    h = 2166136261
    for ch in seed_str:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    state = [h or 1]
    def rng():
        x = state[0]
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        state[0] = x
        return x / 0xFFFFFFFF
    return rng

# ---------------------------------------------------------------- TMS PDF
def fetch_tms_standings():
    """Parse pool standings from the FIH TMS PDF. Returns {pool: [rows]} or None."""
    try:
        import pdfplumber
    except ImportError:
        print('pdfplumber not installed — skipping TMS fetch')
        return None
    try:
        req = urllib.request.Request(TMS_URL, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=30)
        pdf_bytes = resp.read()
    except Exception as e:
        print(f'TMS fetch failed: {e}')
        return None

    print(f'TMS fetched: HTTP {getattr(resp, "status", "?")}, {len(pdf_bytes)} bytes, '
          f'content-type {resp.headers.get("Content-Type", "?")}')
    if not pdf_bytes.startswith(b'%PDF'):
        print(f'TMS response is not a PDF — first 200 bytes: {pdf_bytes[:200]!r}')
        return None

    pools = {}
    current_pool = None
    all_lines = []
    # Row shapes seen in FIH TMS exports: with or without a leading rank column.
    row_res = [
        re.compile(r'^\s*(?:\d+\.?\s+)?([A-Za-z][A-Za-z ]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s*$'),
        re.compile(r'^\s*(?:\d+\.?\s+)?([A-Za-z][A-Za-z ]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*[-:–]\s*(\d+)\s+(-?\d+)\s+(\d+)\s*$'),
    ]
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                for line in (page.extract_text() or '').split('\n'):
                    if line.strip():
                        all_lines.append(line)
                    # TMS pool headers are bare letter lines ("A" / "A Games Goals"),
                    # confirmed from CI diagnostics — "Pool A" style kept as fallback.
                    pool_m = (re.match(r'^\s*([A-D])(?:\s+Games\b.*)?\s*$', line)
                              or re.search(r'\bPool\s+([A-D])\b', line, re.I))
                    if pool_m:
                        current_pool = pool_m.group(1).upper()
                        pools.setdefault(current_pool, [])
                        continue
                    for row_re in row_res:
                        m = row_re.match(line)
                        if m and current_pool:
                            name = m.group(1).strip().lower()
                            code = TEAM_CODE_MAP.get(name)
                            if code:
                                pools[current_pool].append({
                                    'team': code,
                                    'played': int(m.group(2)), 'won': int(m.group(3)),
                                    'drawn': int(m.group(4)), 'lost': int(m.group(5)),
                                    'gf': int(m.group(6)), 'ga': int(m.group(7)),
                                    'gd': int(m.group(8)), 'points': int(m.group(9)),
                                })
                            break
    except Exception as e:
        print(f'TMS parse failed: {e}')
        return None

    if not any(pools.values()):
        # Loud diagnostic: a silent parse miss must never hide the PDF's format
        print(f'TMS parse matched ZERO rows across {len(all_lines)} text lines. '
              f'Sample lines for parser tuning:')
        for line in all_lines[:20]:
            print(f'  | {line}')
        return None
    return pools

# ---------------------------------------------------- status transitions
MATCH_DURATION_MIN = 105  # 60 play + breaks + buffer

def update_statuses(fixtures):
    """scheduled -> live -> completed based on kickoff time. Never touches scores."""
    changed = False
    now = now_utc()
    for m in fixtures['matches']:
        if m['home'] == 'TBD' or m['status'] == 'completed':
            continue
        try:
            ko = kickoff(m)
        except ValueError:
            continue
        end = ko + timedelta(minutes=MATCH_DURATION_MIN)
        if ko <= now < end and m['status'] == 'scheduled':
            m['status'] = 'live'
            changed = True
            print(f"LIVE: {m['id']} {m['home']} vs {m['away']}")
        elif now >= end and m['status'] in ('scheduled', 'live'):
            m['status'] = 'completed'
            changed = True
            print(f"COMPLETED (window): {m['id']}")
    return changed

# ------------------------------------------- score back-fill from TMS
def local_pool_tallies(fixtures):
    """Per-team played/gf/ga computed from pool matches that already have scores."""
    tally = {}
    for m in fixtures['matches']:
        if m['phase'] != 'pool' or not has_score(m):
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            code = m[side]
            t = tally.setdefault(code, {'played': 0, 'gf': 0, 'ga': 0})
            t['played'] += 1
            t['gf'] += m['score'][side]
            t['ga'] += m['score'][opp]
    return tally

def backfill_scores_from_tms(fixtures, tms):
    """
    Fill final scores for completed pool matches without one, using TMS deltas.
    A team's GF delta since our last snapshot IS its score in its one new match,
    so match (A vs B) resolves to (gfΔ_A, gfΔ_B). Skipped (and logged) if any
    involved team has more than one scoreless completed match — manual entry
    then remains the fallback, and we never guess.
    """
    if not tms:
        return False
    local = local_pool_tallies(fixtures)
    remote = {row['team']: row for pool in tms.values() for row in pool}

    pending = [m for m in fixtures['matches']
               if m['phase'] == 'pool' and m['status'] == 'completed' and not has_score(m)]
    pending_count = {}
    for m in pending:
        pending_count[m['home']] = pending_count.get(m['home'], 0) + 1
        pending_count[m['away']] = pending_count.get(m['away'], 0) + 1

    changed = False
    for m in pending:
        h, a = m['home'], m['away']
        if pending_count.get(h, 0) > 1 or pending_count.get(a, 0) > 1:
            print(f"BACKFILL SKIP {m['id']}: team has multiple unresolved matches — needs manual entry")
            continue
        rh, ra = remote.get(h), remote.get(a)
        lh = local.get(h, {'played': 0, 'gf': 0, 'ga': 0})
        la = local.get(a, {'played': 0, 'gf': 0, 'ga': 0})
        if not rh or not ra:
            continue
        if rh['played'] - lh['played'] != 1 or ra['played'] - la['played'] != 1:
            continue  # TMS hasn't published this round yet (or is ahead by 2+)
        sh, sa = rh['gf'] - lh['gf'], ra['gf'] - la['gf']
        # Cross-check: each side's GA delta must equal the opponent's score
        if rh['ga'] - lh['ga'] != sa or ra['ga'] - la['ga'] != sh or sh < 0 or sa < 0:
            print(f"BACKFILL SKIP {m['id']}: TMS deltas inconsistent (GF/GA cross-check failed)")
            continue
        m['score'] = {'home': sh, 'away': sa}
        m['result_source'] = 'fih-tms'
        changed = True
        print(f"BACKFILL: {m['id']} {h} {sh}-{sa} {a} (from TMS standings deltas)")
    return changed

# ------------------------------------------------ estimated enrichment
GOAL_VIA_WEIGHTS = [('PC', 0.45), ('FG', 0.45), ('PS', 0.10)]

def pick_weighted(rng, options):
    r = rng()
    acc = 0
    for value, w in options:
        acc += w
        if r <= acc:
            return value
    return options[-1][0]

def scorer_pool(players, code, via):
    """Roster-aware scorer weighting: PC -> drag-flick DF/MF, FG -> forwards, PS -> stars."""
    squad = [p for p in players if p['team'] == code]
    if not squad:
        return []
    def weight(p):
        w = 1.0
        if via == 'PC':
            if p.get('pc_scored', 0) > 0: w += 6
            if p['position'] in ('Defender', 'Midfielder'): w += 2
        elif via == 'FG':
            if p['position'] == 'Forward': w += 4
            if p['position'] == 'Midfielder': w += 1.5
            w += p.get('goals', 0) * 1.5
        else:  # PS
            if p.get('fih_star'): w += 4
            if p.get('is_captain'): w += 2
        if p['position'] == 'Goalkeeper': w = 0.01
        return w
    return [(p['name'], weight(p)) for p in squad]

def pick_scorer(rng, players, code, via, picked=None):
    """picked: per-match {name: count} — repeat scorers get damped so goals spread realistically."""
    pool = scorer_pool(players, code, via)
    if picked:
        pool = [(n, w / (1 + 2.5 * picked.get(n, 0))) for n, w in pool]
    total = sum(w for _, w in pool) or 1
    name = pick_weighted(rng, [(n, w / total) for n, w in pool]) if pool else 'Unknown'
    if picked is not None:
        picked[name] = picked.get(name, 0) + 1
    return name

def estimate_enrichment(fixtures, players_doc):
    """
    For completed matches with a real score but no timeline: generate seeded,
    roster-aware events + PC counts + stats + commentary. Labeled 'estimated';
    manual events always win and are never overwritten.
    """
    players = players_doc['players']
    changed = False
    for m in fixtures['matches']:
        if m['status'] != 'completed' or not has_score(m):
            continue
        if m.get('events'):
            # Manual/official timeline exists — only derive stats/commentary if absent
            if not m.get('stats'):
                m['stats'] = derive_stats_from_events(m)
                changed = True
            if not m.get('commentary'):
                m['commentary'] = build_commentary(m)
                changed = True
            continue

        rng = seeded_rng(f"{m['id']}:{m['score']['home']}-{m['score']['away']}")
        events = []
        picked = {}
        for side in ('home', 'away'):
            code = m[side]
            for _ in range(m['score'][side]):
                via = pick_weighted(rng, GOAL_VIA_WEIGHTS)
                minute = 2 + int(rng() * 58)
                ev = {
                    'minute': minute, 'team': code, 'type': 'goal', 'via': via,
                    'player': pick_scorer(rng, players, code, via, picked),
                }
                if via == 'FG' and rng() < 0.6:
                    assist = pick_scorer(rng, players, code, 'FG', None)
                    if assist != ev['player']:
                        ev['assist'] = assist
                events.append(ev)
        # Cards: green common, yellow occasional, red rare
        for side in ('home', 'away'):
            code = m[side]
            if rng() < 0.55:
                events.append({'minute': 5 + int(rng() * 54), 'team': code, 'type': 'green_card',
                               'player': pick_scorer(rng, players, code, 'FG')})
            if rng() < 0.30:
                events.append({'minute': 10 + int(rng() * 49), 'team': code, 'type': 'yellow_card',
                               'player': pick_scorer(rng, players, code, 'PC')})
        events.sort(key=lambda e: e['minute'])
        m['events'] = events

        pc_goals = {s: sum(1 for e in events if e['team'] == m[s] and e['type'] == 'goal' and e['via'] == 'PC')
                    for s in ('home', 'away')}
        if not (m.get('penalty_corners') or {}).get('home'):
            m['penalty_corners'] = {
                'home': pc_goals['home'] + 2 + int(rng() * 5),
                'away': pc_goals['away'] + 2 + int(rng() * 5),
            }
        m['stats'] = derive_stats_from_events(m, rng)
        m['commentary'] = build_commentary(m)
        m['enrichment'] = 'estimated'
        changed = True
        print(f"ENRICHED (estimated): {m['id']} — {len(events)} events, stats, commentary")
    return changed

def derive_stats_from_events(m, rng=None):
    """Per-side match stats. Real fields from events/PC; volumes seeded when estimating."""
    rng = rng or seeded_rng(f"stats:{m['id']}")
    s = {}
    gh, ga = m['score']['home'], m['score']['away']
    pc = m.get('penalty_corners') or {}
    lean = 50 + (gh - ga) * 4
    poss_home = max(35, min(65, int(lean + (rng() - 0.5) * 8)))
    for side, goals, opp_goals in (('home', gh, ga), ('away', ga, gh)):
        events = [e for e in (m.get('events') or []) if e.get('team') == m[side]]
        s[side] = {
            'goals': goals,
            'shots': goals + 3 + int(rng() * 6),
            'circle_entries': 10 + goals * 3 + int(rng() * 10),
            'penalty_corners': pc.get(side),
            'possession': poss_home if side == 'home' else 100 - poss_home,
            'green_cards': sum(1 for e in events if e['type'] == 'green_card'),
            'yellow_cards': sum(1 for e in events if e['type'] == 'yellow_card'),
            'red_cards': sum(1 for e in events if e['type'] == 'red_card'),
        }
    return s

VIA_LABEL = {'PC': 'penalty corner', 'FG': 'field goal', 'PS': 'penalty stroke'}

def build_commentary(m):
    """Deterministic beats from the event ledger — quarters, goals, cards, FT."""
    beats = [{'minute': 0, 'text': f"Push-back! {m['home']} vs {m['away']} under way."}]
    score = {'h': 0, 'a': 0}
    for e in sorted(m.get('events') or [], key=lambda x: x.get('minute', 0)):
        side = 'h' if e['team'] == m['home'] else 'a'
        if e['type'] == 'goal':
            score[side] += 1
            beats.append({'minute': e['minute'], 'team': e['team'],
                          'text': f"GOAL! {e.get('player', 'Unknown')} ({e['team']}) scores from a {VIA_LABEL.get(e.get('via'), 'goal')} — {m['home']} {score['h']}-{score['a']} {m['away']}."})
        elif e['type'] in ('green_card', 'yellow_card', 'red_card'):
            kind = e['type'].replace('_', ' ')
            mins = {'green_card': '2-minute suspension', 'yellow_card': '5-minute suspension', 'red_card': 'sent off'}[e['type']]
            beats.append({'minute': e['minute'], 'team': e['team'],
                          'text': f"{kind.title()} for {e.get('player', 'Unknown')} ({e['team']}) — {mins}."})
    for q_min, label in ((15, 'End of Q1'), (30, 'Half-time'), (45, 'End of Q3')):
        beats.append({'minute': q_min, 'text': f"{label}: {m['home']} {sum(1 for e in (m.get('events') or []) if e['type']=='goal' and e['team']==m['home'] and e['minute']<=q_min)}-{sum(1 for e in (m.get('events') or []) if e['type']=='goal' and e['team']==m['away'] and e['minute']<=q_min)} {m['away']}."})
    so = m.get('shootout')
    if so and so.get('home') is not None and so['home'] != so['away']:
        w = m['home'] if so['home'] > so['away'] else m['away']
        beats.append({'minute': 60, 'text': f"Level after 60' — {w} win the shootout {max(so['home'], so['away'])}-{min(so['home'], so['away'])}."})
    beats.append({'minute': 60, 'text': f"Full-time: {m['home']} {m['score']['home']}-{m['score']['away']} {m['away']}."})
    beats.sort(key=lambda b: b['minute'])
    for i, b in enumerate(beats):
        b['seq'] = i
    return beats

# ------------------------------------------- player stats & AI ratings
def update_player_stats(fixtures, players_doc):
    """
    Full idempotent recompute of every player's tournament numbers from the
    event ledger, then a rule-based positional AI rating (/100), volume-
    weighted so a cameo can't outrank a starter.
    """
    players = players_doc['players']
    by_name = {p['name']: p for p in players}
    team_matches = {}
    team_conceded = {}

    agg = {p['name']: {'goals': 0, 'assists': 0, 'pc': 0, 'green': 0, 'yellow': 0, 'red': 0, 'mids': set()}
           for p in players}

    for m in fixtures['matches']:
        if m['status'] != 'completed' or not has_score(m):
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            code = m[side]
            team_matches[code] = team_matches.get(code, 0) + 1
            team_conceded[code] = team_conceded.get(code, 0) + m['score'][opp]
        for e in m.get('events') or []:
            p = by_name.get(e.get('player'))
            if not p:
                continue
            a = agg[p['name']]
            a['mids'].add(m['id'])
            if e['type'] == 'goal':
                a['goals'] += 1
                if e.get('via') == 'PC':
                    a['pc'] += 1
            elif e['type'] == 'green_card':
                a['green'] += 1
            elif e['type'] == 'yellow_card':
                a['yellow'] += 1
            elif e['type'] == 'red_card':
                a['red'] += 1
            if e.get('assist') and e['assist'] in agg:
                agg[e['assist']]['assists'] += 1

    max_team_mp = max(team_matches.values(), default=1)
    changed = False
    for p in players:
        a = agg[p['name']]
        tm = team_matches.get(p['team'], 0)
        mp = tm  # squad players are assumed rostered for their team's matches
        conceded = team_conceded.get(p['team'], 0)
        ga_per_match = conceded / tm if tm else 0

        pos = p['position']
        if pos == 'Goalkeeper':
            base = 62 + max(0, (3.0 - ga_per_match)) * 9
            clean_sheets = 0
            for m in fixtures['matches']:
                if m['status'] == 'completed' and has_score(m):
                    if m['home'] == p['team'] and m['score']['away'] == 0: clean_sheets += 1
                    if m['away'] == p['team'] and m['score']['home'] == 0: clean_sheets += 1
            base += clean_sheets * 4
        elif pos == 'Defender':
            base = 58 + a['pc'] * 6 + a['goals'] * 3 + a['assists'] * 3 + max(0, (3.0 - ga_per_match)) * 5
        elif pos == 'Midfielder':
            base = 58 + a['goals'] * 5 + a['assists'] * 5 + a['pc'] * 3
        else:  # Forward
            base = 56 + a['goals'] * 7 + a['assists'] * 3.5
        base -= a['yellow'] * 2 + a['red'] * 6
        if p.get('fih_star'): base += 3
        if p.get('is_captain'): base += 1

        volume = math.sqrt(mp / max_team_mp) if max_team_mp else 1
        rating = round(min(99, max(40, 40 + (base - 40) * volume)), 1)

        new_vals = {
            'goals': a['goals'],
            'assists': max(p.get('assists', 0), a['assists']),  # keep seeded assists if ledger lacks them
            'pc_scored': a['pc'],
            'yellow_cards': a['yellow'],
            'red_cards': a['red'],
            'green_cards': a['green'],
            'matches_played': mp,
            'ai_rating': rating,
        }
        for k, v in new_vals.items():
            if p.get(k) != v:
                p[k] = v
                changed = True
    if changed:
        print('PLAYER STATS: recomputed tournament aggregates + AI ratings')
    return changed

# ------------------------------------------------- knockout slotting
POINTS = lambda w, d: w * 3 + d

def pool_table(fixtures, pool):
    rows = {}
    for m in fixtures['matches']:
        if m['phase'] != 'pool' or m.get('pool') != pool or not has_score(m) or m['status'] != 'completed':
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            r = rows.setdefault(m[side], {'pts': 0, 'gd': 0, 'gf': 0})
            gf, ga = m['score'][side], m['score'][opp]
            r['gf'] += gf
            r['gd'] += gf - ga
            if gf > ga: r['pts'] += 3
            elif gf == ga: r['pts'] += 1
    return sorted(rows.items(), key=lambda kv: (-kv[1]['pts'], -kv[1]['gd'], -kv[1]['gf'], kv[0]))

def pool_complete(fixtures, pool):
    ms = [m for m in fixtures['matches'] if m['phase'] == 'pool' and m.get('pool') == pool]
    return ms and all(m['status'] == 'completed' and has_score(m) for m in ms)

QF_SLOTS = {'QF1': ('A', 0, 'C', 0), 'QF2': ('B', 0, 'D', 0), 'QF3': ('A', 1, 'C', 1), 'QF4': ('B', 1, 'D', 1)}

def ko_winner(m):
    if not has_score(m) or m['status'] != 'completed':
        return None
    so = m.get('shootout') or {}
    if so.get('home') is not None and so['home'] != so['away']:
        return m['home'] if so['home'] > so['away'] else m['away']
    if m['score']['home'] != m['score']['away']:
        return m['home'] if m['score']['home'] > m['score']['away'] else m['away']
    return None

def slot_knockouts(fixtures):
    """Fill QF/SF/medal fixtures from real results as rounds complete."""
    by_id = {m['id']: m for m in fixtures['matches']}
    changed = False

    for qf, (ph, pi, pa, pj) in QF_SLOTS.items():
        m = by_id.get(qf)
        if not m or m['home'] != 'TBD':
            continue
        if pool_complete(fixtures, ph) and pool_complete(fixtures, pa):
            th = pool_table(fixtures, ph)[pi][0]
            ta = pool_table(fixtures, pa)[pj][0]
            m['home'], m['away'] = th, ta
            changed = True
            print(f"SLOTTED {qf}: {th} vs {ta}")

    for sf, (q1, q2) in (('SF1', ('QF1', 'QF3')), ('SF2', ('QF2', 'QF4'))):
        m = by_id.get(sf)
        if not m or m['home'] != 'TBD':
            continue
        w1, w2 = ko_winner(by_id.get(q1, {})), ko_winner(by_id.get(q2, {}))
        if w1 and w2:
            m['home'], m['away'] = w1, w2
            changed = True
            print(f"SLOTTED {sf}: {w1} vs {w2}")

    sf1, sf2 = by_id.get('SF1'), by_id.get('SF2')
    if sf1 and sf2:
        w1, w2 = ko_winner(sf1), ko_winner(sf2)
        if w1 and w2:
            gold, brz = by_id.get('GOLD'), by_id.get('BRZ')
            if gold and gold['home'] == 'TBD':
                gold['home'], gold['away'] = w1, w2
                changed = True
                print(f"SLOTTED GOLD: {w1} vs {w2}")
            if brz and brz['home'] == 'TBD':
                l1 = sf1['away'] if w1 == sf1['home'] else sf1['home']
                l2 = sf2['away'] if w2 == sf2['home'] else sf2['home']
                brz['home'], brz['away'] = l1, l2
                changed = True
                print(f"SLOTTED BRZ: {l1} vs {l2}")
    return changed

# ------------------------------------------------------------- oracle
def elo_from_rank(rank):
    return 2000 - 38 * (rank - 1)

def predict(home_rank, away_rank):
    rh, ra = elo_from_rank(home_rank), elo_from_rank(away_rank)
    p_home_raw = 1 / (1 + 10 ** ((ra - rh) / 400))
    gap = abs(rh - ra)
    p_draw = 0.26 * math.exp(-gap / 260)  # hockey pool draw rate baseline
    p_home = p_home_raw * (1 - p_draw)
    p_away = (1 - p_home_raw) * (1 - p_draw)
    return round(p_home, 3), round(p_draw, 3), round(p_away, 3)

def generate_predictions(fixtures, teams, predictions):
    """
    Publish picks before push-back, never edited. Pool matches publish inside
    48h; knockout matches publish as soon as both teams are slotted (bracket-
    aware — the slot itself came from real standings).
    """
    rank_of = {t['code']: t['fih_rank'] for t in teams['teams']}
    have = {p['matchId'] for p in predictions['predictions']}
    changed = False
    now = now_utc()

    for m in fixtures['matches']:
        if m['id'] in have or m['home'] == 'TBD' or m['status'] == 'completed':
            continue
        try:
            ko = kickoff(m)
        except ValueError:
            continue
        knockout = m['phase'] != 'pool'
        if not knockout and not (timedelta(0) <= ko - now <= timedelta(hours=48)):
            continue
        if ko <= now:
            continue  # never publish after push-back
        hr, ar = rank_of.get(m['home']), rank_of.get(m['away'])
        if hr is None or ar is None:
            continue
        ph, pd, pa = predict(hr, ar)
        if knockout:
            adv_h = ph + pd / 2
            pick = 'HOME' if adv_h >= 0.5 else 'AWAY'
            conf = round(max(adv_h, 1 - adv_h), 3)
        else:
            pick = 'HOME' if ph >= max(pd, pa) else ('AWAY' if pa >= pd else 'DRAW')
            conf = round(max(ph, pd, pa), 3)
        fav, dog = (m['home'], m['away']) if pick != 'AWAY' else (m['away'], m['home'])
        stage_note = f" {m['phase'].replace('-', ' ').title()} slot decided by pool standings." if knockout else ''
        predictions['predictions'].append({
            'id': f"oracle-v1:{m['id']}",
            'matchId': m['id'],
            'source': 'oracle-v1',
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick': pick, 'pick_confidence': conf,
            'reason': f"FIH #{min(hr, ar)} {fav} favoured over #{max(hr, ar)} {dog} — Elo model from world rankings, published before push-back.{stage_note}",
            'publishedAt': now.isoformat(),
        })
        changed = True
        print(f"ORACLE PICK: {m['id']} -> {pick} ({round(conf*100)}%)")
    return changed

# ---------------------------------------------------------------- main
def main():
    fixtures = load('fixtures.json')
    teams = load('teams.json')
    players = load('players.json')
    predictions = load('predictions.json')
    version_doc = load('data-version.json')

    changed = False
    changed |= update_statuses(fixtures)

    tms = fetch_tms_standings()
    if tms:
        print(f"TMS standings parsed: { {k: len(v) for k, v in tms.items()} }")
        changed |= backfill_scores_from_tms(fixtures, tms)

    changed |= estimate_enrichment(fixtures, players)
    changed |= update_player_stats(fixtures, players)
    changed |= slot_knockouts(fixtures)
    changed |= generate_predictions(fixtures, teams, predictions)

    stamp = now_utc().isoformat()
    if changed:
        fixtures['last_updated'] = stamp
        predictions['updated_at'] = stamp
        players['last_updated'] = stamp
        version_doc['version'] = int(version_doc.get('version', 0)) + 1
        version_doc['updated_at'] = stamp
        version_doc['source'] = 'github-actions'
        save('fixtures.json', fixtures)
        save('predictions.json', predictions)
        save('players.json', players)
        save('data-version.json', version_doc)
        print(f"Data version bumped -> {version_doc['version']}")
    else:
        print('No changes.')

if __name__ == '__main__':
    main()
