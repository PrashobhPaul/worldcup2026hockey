#!/usr/bin/env python3
"""
The records page must be the record, not a copy of it that was true once.

public/data/records.json is generated. Nothing about a generated file stops
someone editing it by hand, and a hand-edited record is indistinguishable from
a computed one by looking at it — which is the whole problem, because a record
is a factual claim about the tournament and the app publishes it as one.

So this recomputes every record from fixtures.json and players.json and fails
if the committed file differs, exactly as the evaluation table is checked. A
result correction that moves a record therefore fails the build until the file
is regenerated, rather than leaving a stale mark on the page.

Two claims are also checked against the record directly rather than against
the generator, so a bug shared by both would still be caught:

  * every holder of a match record names a fixture that exists and whose
    scoreline is the one quoted;
  * every player named as a record holder is in players.json, on the team the
    record says, with the figure the record states.

Run: python3 scripts/test_records.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tournament_records as tr  # noqa: E402

failures = []


def check(name, cond, detail=''):
    if cond:
        print('  ok  ', name)
    else:
        failures.append(name)
        print('  FAIL', name, '—', detail)


def main():
    if not os.path.exists(tr.OUT):
        print('No records committed — run: python3 scripts/tournament_records.py --write')
        return 1

    committed = json.load(open(tr.OUT))
    fresh = tr.build()
    check('the committed records match a fresh computation', committed == fresh,
          'run python3 scripts/tournament_records.py --write')

    fixtures = tr.load('fixtures.json')['matches']
    players = tr.load('players.json')['players']
    by_id = {m['id']: m for m in fixtures}
    by_name = {}
    for p in players:
        by_name.setdefault(p['name'], []).append(p)

    for rec in committed.get('records', []):
        check(f"{rec['key']} names at least one holder", bool(rec['holders']), rec['title'])
        for h in rec['holders']:
            if 'matchId' in h:
                m = by_id.get(h['matchId'])
                check(f"{rec['key']} cites a real fixture ({h['matchId']})", m is not None)
                if m and 'SO' not in h['line']:
                    want = f"{m['home']} {m['score']['home']}-{m['score']['away']} {m['away']}"
                    check(f"{rec['key']} quotes {h['matchId']} correctly",
                          h['line'] == want, f"{h['line']!r} vs {want!r}")
            if 'player' in h and rec['key'] not in ('most_in_a_match',):
                rows = by_name.get(h['player']) or []
                check(f"{rec['key']} names a player on the team list ({h['player']})",
                      any(r['team'] == h['team'] for r in rows),
                      f"{h['player']} / {h['team']}")
            if 'goals' in h:
                rows = [r for r in by_name.get(h['player'], []) if r['team'] == h['team']]
                check(f"{rec['key']} states {h['player']}'s goals as published",
                      bool(rows) and rows[0].get('goals') == h['goals'],
                      f"record {h['goals']}, players.json {rows[0].get('goals') if rows else None}")

    # The page says these are this tournament's marks. It must not quietly
    # start claiming they are all-time World Cup records: nothing in this
    # repository holds the other fifteen tournaments to compare against.
    check('the records declare their scope as this tournament',
          committed.get('scope') == 'this tournament', str(committed.get('scope')))

    print()
    if failures:
        print(f'{len(failures)} record check(s) FAILED: {", ".join(failures[:5])}')
        return 1
    print(f"All record checks passed — {len(committed['records'])} records.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
