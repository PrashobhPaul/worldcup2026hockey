#!/usr/bin/env python3
"""
Hockey.AI — the marks this World Cup set, computed from the record.

Every figure here is derived from public/data/fixtures.json and players.json
and nothing else. There is no editorial list: the script asks the record the
question and the record answers, so a record cannot drift from the match cards
that produced it, and scripts/test_records.py fails the build if the committed
file stops matching a fresh computation.

On the words "world record". It would be easy to print one and wrong to. A
claim that a mark is the best in World Cup history needs the other fifteen
tournaments to compare against, and this repository does not hold them — the
FIH's own historical statistics are the authority and nothing here has read
them. So these are stated for what they can be stated as: the records OF this
tournament, the 2026 edition's own marks. If an FIH historical baseline is
ever added to public/data, the all-time comparison becomes a second column
here rather than a rewrite.

Ties are kept, never broken. Two nations that both won by seven goals both
hold the mark; picking one by alphabet would be inventing a ranking the sport
does not have.

Run: python3 scripts/tournament_records.py [--write]
"""
import argparse
import json
import os
import sys

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')
OUT = os.path.join(DATA, 'records.json')

NOTE = ("Records of the 2026 tournament, computed from the published match record. "
        "They are this edition's marks, not all-time World Cup records: the FIH's "
        "historical statistics are the authority on those and are not held here.")


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def played(matches):
    return [m for m in matches
            if m['status'] == 'completed' and (m.get('score') or {}).get('home') is not None]


def fixture(m):
    return {'matchId': m['id'], 'label': m.get('label') or m['phase'], 'date': m['date'],
            'line': f"{m['home']} {m['score']['home']}-{m['score']['away']} {m['away']}"}


def best(items, key, want='max'):
    """Every item tied at the extreme value, with that value. Ties are kept."""
    scored = [(key(i), i) for i in items]
    scored = [(v, i) for v, i in scored if v is not None]
    if not scored:
        return None, []
    pick = max(v for v, _ in scored) if want == 'max' else min(v for v, _ in scored)
    return pick, [i for v, i in scored if v == pick]


def record(key, title, value, holders, detail):
    return {'key': key, 'title': title, 'value': value, 'holders': holders, 'detail': detail}


def team_rows(matches, teams):
    """One row per nation: what it did across the tournament."""
    rows = {t['code']: dict(code=t['code'], name=t['name'], played=0, w=0, d=0, l=0,
                            gf=0, ga=0, clean=0, best_win=0) for t in teams}
    for m in matches:
        for side, opp in (('home', 'away'), ('away', 'home')):
            code = m[side]
            if code not in rows:
                continue
            r = rows[code]
            gf, ga = m['score'][side], m['score'][opp]
            r['played'] += 1; r['gf'] += gf; r['ga'] += ga
            r['w'] += gf > ga; r['l'] += gf < ga; r['d'] += gf == ga
            r['clean'] += ga == 0
            r['best_win'] = max(r['best_win'], gf - ga)
    return [r for r in rows.values() if r['played']]


def build():
    fixtures, teams_doc = load('fixtures.json'), load('teams.json')
    players = load('players.json')['players']
    teams = teams_doc['teams']
    name_of = {t['code']: t['name'] for t in teams}
    ms = played(fixtures['matches'])
    goals = [e for m in ms for e in (m.get('events') or []) if e['type'] == 'goal']
    rows = team_rows(ms, teams)

    out = []

    # --- Matches -----------------------------------------------------------
    v, holders = best(ms, lambda m: abs(m['score']['home'] - m['score']['away']))
    out.append(record('biggest_win', 'Biggest winning margin', f'{v} goals',
                      [fixture(m) for m in holders],
                      'The widest gap between the two scorelines in any match.'))

    v, holders = best(ms, lambda m: m['score']['home'] + m['score']['away'])
    out.append(record('highest_scoring', 'Highest-scoring match', f'{v} goals',
                      [fixture(m) for m in holders],
                      'Both sides counted together.'))

    v, holders = best(ms, lambda m: max(m['score']['home'], m['score']['away']))
    out.append(record('most_by_a_team', 'Most goals by one team in a match', str(v),
                      [fixture(m) for m in holders], None))

    # A goalless draw is the one match with no scorer at all.
    blanks = [m for m in ms if m['score']['home'] + m['score']['away'] == 0]
    if blanks:
        out.append(record('goalless', 'Goalless matches', str(len(blanks)),
                          [fixture(m) for m in blanks], 'Ninety minutes, no goal at either end.'))

    shootouts = [m for m in ms if (m.get('shootout') or {}).get('home') is not None]
    if shootouts:
        out.append(record('shootouts', 'Matches decided by a shoot-out', str(len(shootouts)),
                          [dict(fixture(m),
                                line=f"{m['home']} {m['score']['home']}-{m['score']['away']} "
                                     f"{m['away']} ({m['shootout']['home']}-{m['shootout']['away']} SO)")
                           for m in shootouts], None))

    # --- Goals -------------------------------------------------------------
    if goals:
        v, holders = best(goals, lambda e: e['minute'], want='min')
        out.append(record('earliest_goal', 'Earliest goal', f"minute {v}",
                          [{'player': e['player'], 'team': e['team'],
                            'teamName': name_of.get(e['team'], e['team']),
                            'minute': e['minute']} for e in holders], None))

        v, holders = best(goals, lambda e: e['minute'])
        out.append(record('latest_goal', 'Latest goal', f"minute {v}",
                          [{'player': e['player'], 'team': e['team'],
                            'teamName': name_of.get(e['team'], e['team']),
                            'minute': e['minute']} for e in holders], None))

        # Most goals by one player in one match, off the event ledger.
        tally = {}
        for m in ms:
            for e in (m.get('events') or []):
                if e['type'] != 'goal':
                    continue
                tally.setdefault((m['id'], e['player'], e['team']), 0)
                tally[(m['id'], e['player'], e['team'])] += 1
        by_id = {m['id']: m for m in ms}
        items = [{'matchId': mid, 'player': pl, 'team': tm, 'n': n}
                 for (mid, pl, tm), n in tally.items()]
        v, holders = best(items, lambda i: i['n'])
        out.append(record('most_in_a_match', 'Most goals by a player in one match', str(v),
                          [dict(fixture(by_id[h['matchId']]), player=h['player'], team=h['team'],
                                teamName=name_of.get(h['team'], h['team'])) for h in holders],
                          None))

    # --- Players -----------------------------------------------------------
    scorers = [p for p in players if (p.get('goals') or 0) > 0]
    if scorers:
        v, holders = best(scorers, lambda p: p['goals'])
        out.append(record('top_scorer', 'Most goals', str(v),
                          [{'player': p['name'], 'team': p['team'],
                            'teamName': name_of.get(p['team'], p['team']),
                            'goals': p['goals']} for p in holders], None))

        v, holders = best(scorers, lambda p: p.get('pc_scored') or 0)
        if v:
            out.append(record('top_pc', 'Most penalty-corner goals', str(v),
                              [{'player': p['name'], 'team': p['team'],
                                'teamName': name_of.get(p['team'], p['team'])} for p in holders],
                              'The FIH publishes corner GOALS, never corners won, so this is '
                              'goals from penalty corners and not a conversion rate.'))

        v, holders = best(scorers, lambda p: p.get('fg_scored') or 0)
        if v:
            out.append(record('top_fg', 'Most field goals', str(v),
                              [{'player': p['name'], 'team': p['team'],
                                'teamName': name_of.get(p['team'], p['team'])} for p in holders],
                              None))

    assisters = [p for p in players if (p.get('assists') or 0) > 0]
    if assisters:
        v, holders = best(assisters, lambda p: p['assists'])
        out.append(record('top_assists', 'Most assists', str(v),
                          [{'player': p['name'], 'team': p['team'],
                            'teamName': name_of.get(p['team'], p['team'])} for p in holders], None))

    # --- Nations -----------------------------------------------------------
    v, holders = best(rows, lambda r: r['gf'])
    out.append(record('most_goals_team', 'Most goals scored by a nation', str(v),
                      [{'team': r['code'], 'teamName': r['name'],
                        'detail': f"in {r['played']} matches"} for r in holders], None))

    v, holders = best(rows, lambda r: r['ga'], want='min')
    out.append(record('best_defence', 'Fewest goals conceded', str(v),
                      [{'team': r['code'], 'teamName': r['name'],
                        'detail': f"in {r['played']} matches"} for r in holders],
                      'Counted across every match played, so a nation that went further '
                      'conceded over more hockey.'))

    v, holders = best(rows, lambda r: r['clean'])
    if v:
        out.append(record('clean_sheets', 'Most clean sheets', str(v),
                          [{'team': r['code'], 'teamName': r['name']} for r in holders], None))

    v, holders = best(rows, lambda r: r['w'])
    out.append(record('most_wins', 'Most wins', str(v),
                      [{'team': r['code'], 'teamName': r['name'],
                        'detail': f"from {r['played']} matches"} for r in holders], None))

    return {
        'source': 'scripts/tournament_records.py',
        'scope': 'this tournament',
        'note': NOTE,
        'matches': len(ms),
        'records': out,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help=f'write {os.path.relpath(OUT)}')
    args = ap.parse_args()
    doc = build()
    if args.write:
        with open(OUT, 'w') as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        print(f"wrote {os.path.relpath(OUT)} — {len(doc['records'])} records")
    else:
        for r in doc['records']:
            who = ', '.join(h.get('player') or h.get('teamName') or h.get('line', '')
                            for h in r['holders'])
            print(f"  {r['title']:<38} {r['value']:<10} {who}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
