#!/usr/bin/env python3
"""Reconcile the published match record against the official FIH export.

reference/fih-matchdata.json is the FIH AltiusRT match centre's own record for
matches 1-36, every row carrying the source URL it came from. This script makes
our data agree with it, in three respects:

  score        one match was carried wrong (a draw published as a win).
  orientation  eight matches listed the two nations the other way round from
               the official record. The result is unaffected — the same side
               won by the same margin — but "home" and "away" are how the app
               labels everything downstream, including which way a published
               pick points, so the paired prediction rows are relabelled in the
               same pass. No pick changes meaning: the team it named still wins
               if it was right, still loses if it was wrong.
  timeline     goals and cards are replaced by the official ones, which
               resolves a handful of missing and surplus events.

Player names come back in FIH's printing convention (SURNAME Given); they are
matched against the squad list so the app keeps showing the name it always has.

Usage:
    python3 scripts/apply_official_matchdata.py --check   # report, change nothing
    python3 scripts/apply_official_matchdata.py           # apply
"""
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'public', 'data')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def load(name, base=DATA):
    with open(os.path.join(base, name)) as fh:
        return json.load(fh)


def save(name, doc, indent=2):
    with open(os.path.join(DATA, name), 'w') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=indent)
        fh.write('\n')


def roster_name(players, team, official):
    """FIH prints 'SURNAME Given'. Return the squad's spelling where we have it."""
    tokens = [t for t in official.replace(',', ' ').split() if t]
    lowered = {t.lower() for t in tokens}
    best, best_score = None, 0
    for p in players:
        if p.get('team') != team:
            continue
        parts = {t.lower() for t in p['name'].split()}
        score = len(parts & lowered)
        if score > best_score:
            best, best_score = p['name'], score
    if best and best_score >= 2:
        return best
    if best and best_score == 1 and len(tokens) >= 2:
        return best
    # No squad match: rebuild 'SURNAME Given' as 'Given Surname' without
    # flattening particles such as van / de / der.
    caps = [t for t in tokens if t.isupper()]
    rest = [t for t in tokens if not t.isupper()]
    surname = ' '.join(w if w.lower() in ('van', 'de', 'der', 'den', 'du', 'la')
                       else w.capitalize() for w in caps)
    return ' '.join(rest + [surname]).strip()


def main():
    check = '--check' in sys.argv
    ref = load('fih-matchdata.json', os.path.join(ROOT, 'reference'))['data']
    fixtures = load('fixtures.json')
    predictions = load('predictions.json')
    players = load('players.json')['players']
    by_id = {m['id']: m for m in fixtures['matches']}

    flipped, rescored, retimed = [], [], []
    for mid, off in ref.items():
        m = by_id.get(mid)
        if not m:
            continue
        if (m['home'], m['away']) == (off['away'], off['home']):
            flipped.append(mid)
            if not check:
                m['home'], m['away'] = off['home'], off['away']
                for key in ('score', 'live_score', 'stats', 'penalty_corners'):
                    v = m.get(key)
                    if isinstance(v, dict) and 'home' in v and 'away' in v:
                        v['home'], v['away'] = v['away'], v['home']
        elif (m['home'], m['away']) != (off['home'], off['away']):
            print(f'  !! {mid}: teams differ from the official record — left alone')
            continue

        if (m['score'].get('home'), m['score'].get('away')) != (off['score']['home'], off['score']['away']):
            rescored.append((mid, dict(m['score']), dict(off['score'])))
            if not check:
                m['score'] = dict(off['score'])

        events = [{'minute': e['minute'], 'team': e['team'], 'type': e['type'],
                   **({'via': e['via']} if e.get('via') else {}),
                   'player': roster_name(players, e['team'], e['player'])}
                  for e in off['events']]
        if events != m.get('events'):
            retimed.append(mid)
            if not check:
                m['events'] = events
        if not check:
            m['fih_match_id'] = off['fih_match_id']
            m['result_source'] = off['source']
            m['enrichment'] = 'official'

    # A flipped fixture must take its published picks with it, or a pick that
    # named the winner would be graded against the loser.
    relabelled = 0
    if flipped:
        for p in predictions['predictions']:
            # Relabel each row exactly once. The fixture can arrive reversed
            # again — the pipeline on main republishes these files every ten
            # minutes and does not carry this correction until the branch
            # lands — but the rows on this side keep the label they were given,
            # and flipping them a second time would invert every pick.
            if p['matchId'] not in flipped or p.get('orientation_corrected'):
                continue
            relabelled += 1
            if check:
                continue
            p['p_home_win'], p['p_away_win'] = p.get('p_away_win'), p.get('p_home_win')
            if p.get('pick') in ('HOME', 'AWAY'):
                p['pick'] = 'AWAY' if p['pick'] == 'HOME' else 'HOME'
            p['orientation_corrected'] = ('home/away relabelled to the official FIH listing; '
                                          'the team predicted, its probability and publishedAt are unchanged')
        # The pick is stored as HOME/AWAY, which only means something next to a
        # fixture. Record the nation itself so the claim survives any later
        # change of listing, and so a test can prove the two still agree.
        matches = {m['id']: m for m in fixtures['matches']}
        for p in predictions['predictions']:
            m = matches.get(p['matchId'])
            if m and p.get('pick') in ('HOME', 'AWAY'):
                p['pick_team'] = m['home'] if p['pick'] == 'HOME' else m['away']

    print(f'orientation flipped: {len(flipped)} {flipped}')
    for mid, was, now in rescored:
        print(f"score corrected: {mid} {was['home']}-{was['away']} -> {now['home']}-{now['away']}")
    print(f'timelines replaced: {len(retimed)} {retimed}')
    print(f'prediction rows relabelled: {relabelled}')
    if check:
        print('(--check: nothing written)')
        return 0

    import update_data as ud
    for m in fixtures['matches']:
        if m.get('events') and m['status'] == 'completed':
            m['stats'] = ud.derive_stats_from_events(m)
            m['commentary'] = ud.build_commentary(m)
            m.pop('penalty_corners', None)
    teams = load('teams.json')
    for t in teams['teams']:
        t['form'] = ud.team_form(t['code'], fixtures)

    save('fixtures.json', fixtures, indent=1)
    save('predictions.json', predictions)
    save('teams.json', teams)
    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    save('data-version.json', version)
    from data_fingerprint import stamp
    stamp()
    print(f"applied; data-version -> {version['version']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
