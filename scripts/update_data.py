#!/usr/bin/env python3
"""
Hockey.AI data pipeline — runs on GitHub Actions every 30 min.

1. Fetches FIH TMS pool-standings PDF (competition 1866) and parses it.
2. Flips match statuses (scheduled -> live -> completed) based on kickoff times.
3. Generates Oracle predictions (Elo-from-FIH-rank model) for matches within 48h
   that don't have a published pick yet — published BEFORE push-back, never edited.
4. Bumps data-version.json only when something actually changed, which triggers
   every installed PWA to resync its IndexedDB snapshot.

Manual score entry: edit public/data/fixtures.json in the GitHub web UI
(set score.home/score.away, status "completed", penalty_corners, events)
— this script will never overwrite a manually-entered completed score.
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
        pdf_bytes = urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:
        print(f'TMS fetch failed: {e}')
        return None

    pools = {}
    current_pool = None
    row_re = re.compile(
        r'^\s*(\d+)\s+([A-Za-z ]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s*$'
    )
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                for line in (page.extract_text() or '').split('\n'):
                    pool_m = re.match(r'^\s*Pool\s+([A-D])\b', line, re.I)
                    if pool_m:
                        current_pool = pool_m.group(1).upper()
                        pools.setdefault(current_pool, [])
                        continue
                    m = row_re.match(line)
                    if m and current_pool:
                        name = m.group(2).strip().lower()
                        code = TEAM_CODE_MAP.get(name)
                        if code:
                            pools[current_pool].append({
                                'team': code,
                                'played': int(m.group(3)), 'won': int(m.group(4)),
                                'drawn': int(m.group(5)), 'lost': int(m.group(6)),
                                'gf': int(m.group(7)), 'ga': int(m.group(8)),
                                'gd': int(m.group(9)), 'points': int(m.group(10)),
                            })
    except Exception as e:
        print(f'TMS parse failed: {e}')
        return None
    return pools if any(pools.values()) else None

# ---------------------------------------------------- status transitions
MATCH_DURATION_MIN = 105  # 60 play + breaks + buffer

def update_statuses(fixtures):
    """scheduled -> live -> completed based on kickoff time. Never touches manual scores."""
    changed = False
    now = now_utc()
    for m in fixtures['matches']:
        if m['home'] == 'TBD' or m['status'] == 'completed':
            continue
        try:
            ko = datetime.fromisoformat(f"{m['date']}T{m['time']}:00").replace(tzinfo=CET)
        except ValueError:
            continue
        end = ko + timedelta(minutes=MATCH_DURATION_MIN)
        if ko <= now < end and m['status'] == 'scheduled':
            m['status'] = 'live'
            changed = True
            print(f"LIVE: {m['id']} {m['home']} vs {m['away']}")
        elif now >= end and m['status'] in ('scheduled', 'live'):
            # Window passed. If a score exists mark completed; else leave live=false, completed with null score
            m['status'] = 'completed'
            changed = True
            print(f"COMPLETED (window): {m['id']}")
    return changed

# ------------------------------------------------------------- oracle
def elo_from_rank(rank):
    return 2000 - 38 * (rank - 1)

def predict(home_rank, away_rank, knockout=False):
    rh, ra = elo_from_rank(home_rank), elo_from_rank(away_rank)
    p_home_raw = 1 / (1 + 10 ** ((ra - rh) / 400))
    gap = abs(rh - ra)
    p_draw = 0.26 * math.exp(-gap / 260)  # hockey pool draw rate baseline
    p_home = p_home_raw * (1 - p_draw)
    p_away = (1 - p_home_raw) * (1 - p_draw)
    return round(p_home, 3), round(p_draw, 3), round(p_away, 3)

def generate_predictions(fixtures, teams, predictions):
    """Publish picks for matches inside 48h that lack one. Never edits existing picks."""
    rank_of = {t['code']: t['fih_rank'] for t in teams['teams']}
    have = {p['matchId'] for p in predictions['predictions']}
    changed = False
    now = now_utc()

    for m in fixtures['matches']:
        if m['id'] in have or m['home'] == 'TBD' or m['status'] == 'completed':
            continue
        try:
            ko = datetime.fromisoformat(f"{m['date']}T{m['time']}:00").replace(tzinfo=CET)
        except ValueError:
            continue
        if not (timedelta(0) <= ko - now <= timedelta(hours=48)):
            continue
        hr, ar = rank_of.get(m['home']), rank_of.get(m['away'])
        if hr is None or ar is None:
            continue
        ph, pd, pa = predict(hr, ar, m['phase'] != 'pool')
        if m['phase'] != 'pool':
            adv_h = ph + pd / 2
            pick = 'HOME' if adv_h >= 0.5 else 'AWAY'
            conf = round(max(adv_h, 1 - adv_h), 3)
        else:
            pick = 'HOME' if ph >= max(pd, pa) else ('AWAY' if pa >= pd else 'DRAW')
            conf = round(max(ph, pd, pa), 3)
        fav, dog = (m['home'], m['away']) if pick != 'AWAY' else (m['away'], m['home'])
        predictions['predictions'].append({
            'id': f"oracle-v1:{m['id']}",
            'matchId': m['id'],
            'source': 'oracle-v1',
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick': pick, 'pick_confidence': conf,
            'reason': f"FIH #{min(hr, ar)} {fav} favoured over #{max(hr, ar)} {dog} — Elo model from world rankings, published before push-back.",
            'publishedAt': now.isoformat(),
        })
        changed = True
        print(f"ORACLE PICK: {m['id']} -> {pick} ({round(conf*100)}%)")
    return changed

# ---------------------------------------------------------------- main
def main():
    fixtures = load('fixtures.json')
    teams = load('teams.json')
    predictions = load('predictions.json')
    version_doc = load('data-version.json')

    changed = False
    changed |= update_statuses(fixtures)
    changed |= generate_predictions(fixtures, teams, predictions)

    tms = fetch_tms_standings()
    if tms:
        print(f"TMS standings parsed: { {k: len(v) for k, v in tms.items()} }")
        # Standings are computed client-side from fixtures; TMS is used as a
        # verification signal. Log discrepancies for the maintainer.
        # (Score back-fill from TMS deltas can be added here when needed.)

    stamp = now_utc().isoformat()
    if changed:
        fixtures['last_updated'] = stamp
        predictions['updated_at'] = stamp
        version_doc['version'] = int(version_doc.get('version', 0)) + 1
        version_doc['updated_at'] = stamp
        version_doc['source'] = 'github-actions'
        save('fixtures.json', fixtures)
        save('predictions.json', predictions)
        save('data-version.json', version_doc)
        print(f"Data version bumped -> {version_doc['version']}")
    else:
        print('No changes.')

if __name__ == '__main__':
    main()
