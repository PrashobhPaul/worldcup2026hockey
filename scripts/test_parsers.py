#!/usr/bin/env python3
"""
Parser tests for the data pipeline.

These cover the scrapers that read third-party pages, because that is where
silent corruption enters: a page tweak shifts a column, the parse still
"succeeds", and wrong data lands in the app. Every case here is one that has
actually bitten, or one that would.

Run: python scripts/test_parsers.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from update_data import (  # noqa: E402
    parse_rankings_text, parse_squad_lines, parse_player_rows, TMS_LINEUP_LINK,
)

failures = []

def check(name, cond, detail=''):
    if cond:
        print(f'  ok   {name}')
    else:
        failures.append(name)
        print(f'  FAIL {name}{" — " + detail if detail else ""}')

print('FIH rankings parser')

# A clean table: rank, nation, points — the shape the page normally renders.
clean = []
table = [(1, 'Belgium', '3738.21'), (2, 'Netherlands', '3490.86'), (3, 'England', '3265.03'),
         (4, 'Australia', '3007.32'), (15, 'Wales', '1102.40'), (16, 'Japan', '1090.10')]
for rank, nation, pts in table:
    clean += [str(rank), nation, pts]
rows = parse_rankings_text(clean)
check('clean table parses every nation', rows is not None and len(rows) == 6)
check('clean table keeps page order', rows and [r[0] for r in rows] == [1, 2, 3, 4, 15, 16])
check('Wales is 15 and Japan 16', rows and dict((c, r) for r, c, _ in rows).get('WAL') == 15
      and dict((c, r) for r, c, _ in rows).get('JPN') == 16)

# The real defect: a row whose points are a whole number. The old parser read
# "1102" as the *next* row's rank, shifting every pairing after it — which is
# how two runs 36 minutes apart disagreed about Wales and Japan.
shifting = ['1', 'Belgium', '3738.21', '15', 'Wales', '1102', '16', 'Japan', '1090.10']
rows = parse_rankings_text(shifting)
check('integer points do not shift the pairings',
      rows is not None and dict((c, r) for r, c, _ in rows).get('JPN') == 16,
      f'got {rows}')

# Columns that do not line up must be rejected outright, not half-applied.
mismatched = ['1', 'Belgium', '2000.0', '2', 'Netherlands', '3500.0']
check('points rising down the table is rejected', parse_rankings_text(mismatched) is None)

duplicated = ['1', 'Belgium', '3738.0', '2', 'Belgium', '3500.0']
check('a nation appearing twice is rejected', parse_rankings_text(duplicated) is None)

backwards = ['5', 'Belgium', '3738.0', '2', 'Netherlands', '3500.0']
check('ranks going backwards down the page is rejected', parse_rankings_text(backwards) is None)

check('an empty page yields nothing', parse_rankings_text([]) is None)

print('\nTMS team-list parser')
squad_lines = [
    'Netherlands',
    '8 BRINKMAN Thierry (C)',
    '23 VISSER Maurits GK',
    '51 TELGENKAMP Duco',
    'New Zealand',
    '10 LANE Sam (C)',
    '1 READ Brad GK',
]
squads = parse_squad_lines(squad_lines)
check('rows group under their nation', set(squads) == {'NED', 'NZL'})
check('Netherlands squad size', len(squads.get('NED', [])) == 3)
check('captain flag read', any(p['is_captain'] and p['name'].startswith('BRINKMAN')
                              for p in squads.get('NED', [])))
check('goalkeeper flag read', any(p['goalkeeper'] and p['name'].startswith('VISSER')
                                 for p in squads.get('NED', [])))
check('shirt numbers read', {p['number'] for p in squads.get('NZL', [])} == {10, 1})
check('rows with no nation heading are dropped', parse_squad_lines(['8 BRINKMAN Thierry']) == {})

print('\nMatch line-up row reader')

# A PDF team sheet keeps number and name on one line...
inline = parse_player_rows(['8 BRINKMAN Thierry (C)', '23 VISSER Maurits GK', '51 TELGENKAMP Duco'])
check('inline rows read', [p['number'] for p in inline] == [8, 23, 51])
check('inline captain flag', inline[0]['is_captain'] and not inline[0]['goalkeeper'])
check('inline goalkeeper flag', inline[1]['goalkeeper'] and inline[1]['name'] == 'VISSER Maurits')

# ...an HTML table flattens to one cell per line. Same sheet, different shape.
cells = parse_player_rows(['8', 'BRINKMAN Thierry (C)', '23', 'VISSER Maurits GK', '51', 'TELGENKAMP Duco'])
check('cell-per-line rows read', [p['number'] for p in cells] == [8, 23, 51])
check('both shapes agree', [(p['number'], p['name']) for p in cells]
      == [(p['number'], p['name']) for p in inline])
check('cell-per-line captain flag', cells[0]['is_captain'])
check('cell-per-line goalkeeper flag', cells[1]['goalkeeper'])

# A shirt number is worn by one player; a repeat means the page was misread.
dupes = parse_player_rows(['8 BRINKMAN Thierry', '8 SOMEONE Else'])
check('a repeated shirt number is dropped', len(dupes) == 1)

# Stray numbers (scores, minutes, table totals) must not invent players.
check('a number with no name after it invents nobody', parse_player_rows(['3', '2', '1']) == [])
check('running text is not read as a name',
      parse_player_rows(['5', 'match report generated at 14:02']) == [])

check('lineup links are recognised',
      TMS_LINEUP_LINK.findall('href="/matches/22334/lineups/8575" href="/matches/22334/lineups/8586"')
      == [('22334', '8575'), ('22334', '8586')])

print()
if failures:
    print(f'{len(failures)} parser check(s) FAILED: {", ".join(failures)}')
    sys.exit(1)
print('All parser checks passed.')
