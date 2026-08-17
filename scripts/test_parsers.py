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
    parse_rankings_text, parse_squad_lines, parse_player_rows, normalize_fih_name,
    compose_lineup, seeded_rng, TMS_LINEUP_LINK,
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
check('captain flag read', any(p['is_captain'] and p['name'] == 'Thierry Brinkman'
                              for p in squads.get('NED', [])))
check('goalkeeper flag read', any(p['goalkeeper'] and p['name'] == 'Maurits Visser'
                                 for p in squads.get('NED', [])))
check('shirt numbers read', {p['number'] for p in squads.get('NZL', [])} == {10, 1})
check('rows with no nation heading are dropped', parse_squad_lines(['8 BRINKMAN Thierry']) == {})

print('\nFIH entry list (the real /reports/teams PDF)')

# Verbatim from the live run's dump, including the surrounding page furniture
# that must not be mistaken for players.
entry_pdf = [
    'FIH Hockey World Cup Belgium & Netherlands 2026 (M)',
    '15 - 30 Aug 2026',
    'Amstelveen (NED)',
    'Team Details Australia',
    'Shirt No. Player Date of Birth Age* Caps',
    '1 SHARP Lachlan 2 Jul 1997 29 124',
    '2 CRAIG Tom 3 Sep 1995 30 169',
    '12 SNOWDEN Jed (GK) 15 Aug 2001 25 25',
    '13 GOVERS Blake 6 Jul 1996 30 180',
    'NB: Team lists are subject to change following the tournament briefing meeting * As of 2026-08-15',
    'Team Staff',
    'Role Name',
    'Head Coach REY Lucas',
    'Team Colours',
    'Shorts Light blue | Black',
    'Page 1 of 16',
    'Team Details New Zealand',
    'Shirt No. Player Date of Birth Age* Caps',
    '10 LANE Sam 4 Feb 1996 30 141',
]
squads = parse_squad_lines(entry_pdf)
check('"Team Details <Nation>" is read as a heading', set(squads) == {'AUS', 'NZL'})
check('every listed player is read', len(squads.get('AUS', [])) == 4)
check('page furniture is not read as players',
      not any(p['name'].lower().startswith(('page', 'role', 'shorts', 'head coach'))
              for p in squads.get('AUS', [])), f"got {[p['name'] for p in squads.get('AUS', [])]}")
check('a two-word nation heading is read', len(squads.get('NZL', [])) == 1)
aus = {p['number']: p for p in squads['AUS']}
check('caps are captured', aus[13]['caps'] == 180 and aus[1]['caps'] == 124)
check('date of birth is captured', aus[2]['dob'] == '3 Sep 1995')
check('goalkeeper flag survives the extra columns', aus[12]['goalkeeper'])
check('a date is never mistaken for a shirt number', set(aus) == {1, 2, 12, 13})

check('a heading run together with the column titles still names the nation',
      set(parse_squad_lines([
          'Team Details England Shirt No. Player Date of Birth Age* Caps',
          '4 WARD Sam 1 Jan 1990 36 200',
      ])) == {'ENG'})

print('\nFIH name order')
# FIH writes surname-first in capitals; the app and the pitch renderer both take
# the surname from the end, so leaving them as-is puts a given name on the shirt.
for raw, want in [
    ('SHARP Lachlan', 'Lachlan Sharp'),
    ('VAN DER WEERDEN Mink', 'Mink van der Weerden'),
    ('DE KERPEL Antoine', 'Antoine de Kerpel'),
    ("O'BRIEN Sean", "Sean O'Brien"),
    ('VAN ASS Seve', 'Seve van Ass'),
    ('SINGH Harmanpreet', 'Harmanpreet Singh'),
    # Real rows from the live entry list that the first attempt left untouched,
    # because the surname is not uniformly capitalised.
    ('McKEE John', 'John McKee'),
    ('della TORRE Nicolas', 'Nicolas della Torre'),
    ('MCNELLIS Mark', 'Mark McNellis'),
    ('MCALLISTER Adam', 'Adam McAllister'),
]:
    check(f'{raw} -> {want}', normalize_fih_name(raw) == want, f'got {normalize_fih_name(raw)}')
check('an already-normal name is left alone', normalize_fih_name('Thierry Brinkman') == 'Thierry Brinkman')
check('a single token is left alone', normalize_fih_name('Ronaldinho') == 'Ronaldinho')

print('\nMatch line-up row reader')

# A PDF team sheet keeps number and name on one line...
inline = parse_player_rows(['8 BRINKMAN Thierry (C)', '23 VISSER Maurits GK', '51 TELGENKAMP Duco'])
check('inline rows read', [p['number'] for p in inline] == [8, 23, 51])
check('inline captain flag', inline[0]['is_captain'] and not inline[0]['goalkeeper'])
check('inline goalkeeper flag', inline[1]['goalkeeper'] and inline[1]['name'] == 'Maurits Visser')

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

print('\nTeam sheet composition')

def player(pid, name, position=None, **kw):
    p = {'id': pid, 'name': name, 'position': position, 'number': int(pid[-2:]),
         'on_team_list': True}
    p.update(kw)
    return p

# A squad shaped like the live data: one keeper, a few players whose position we
# know, and a majority whose position the entry list never stated.
squad = ([player('T_01', 'A Keeper', 'Goalkeeper'),
          player('T_02', 'B Back', 'Defender'),
          player('T_03', 'C Mid', 'Midfielder'),
          player('T_04', 'D Front', 'Forward')]
         + [player(f'T_{i:02d}', f'Squad {i}', 'Squad', caps=100 - i) for i in range(5, 21)])
sheet = compose_lineup('TST', squad, seeded_rng('t'))
xi = sheet['startingXI']
check('a full XI is picked', len(xi) == 11)
# The live run produced "32 Vivek Sagar Prasad" twice, because the leftover pool
# held the unstated-position players a second time.
check('no player appears twice in the XI', len({p['playerId'] for p in xi}) == 11)
check('no player is both starter and substitute',
      not ({p['playerId'] for p in xi} & {p['playerId'] for p in sheet['substitutes']}))
# The live run drew a goalkeeper as a defender.
check('exactly one goalkeeper, and it is the keeper',
      [p['name'] for p in xi if p['goalkeeper']] == ['A Keeper'])
check('the keeper is first, so the pitch draws him in goal', xi[0]['name'] == 'A Keeper')
check('lines are 1-4-3-3',
      [sum(1 for p in xi if p['line'] == l) for l in ('Goalkeeper', 'Defender', 'Midfielder', 'Forward')]
      == [1, 4, 3, 3])
check('a known defender is drawn in defence', next(p for p in xi if p['name'] == 'B Back')['line'] == 'Defender')
check('a known forward is drawn in attack', next(p for p in xi if p['name'] == 'D Front')['line'] == 'Forward')
# The drawn line is a layout decision; it must not be recorded as a claim about
# a player whose position nobody stated.
check('an unstated position stays unstated',
      all(p['position'] is None for p in xi if p['name'].startswith('Squad')))
check('a stated position is preserved',
      next(p for p in xi if p['name'] == 'C Mid')['position'] == 'Midfielder')
check('the sheet is deterministic',
      compose_lineup('TST', squad, seeded_rng('t')) == sheet)

# A player seeded before the tournament who did not make the squad must not play,
# however highly he is rated.
dropped = player('T_99', 'Z Legend', 'Forward', ai_rating=99, on_team_list=False)
with_dropped = compose_lineup('TST', squad + [dropped], seeded_rng('t'))
check('a player left out of the squad never appears',
      'Z Legend' not in [p['name'] for p in with_dropped['startingXI']]
      + [p['name'] for p in with_dropped['substitutes']])

check('a squad with no keeper yields no sheet',
      compose_lineup('TST', [p for p in squad if p['position'] != 'Goalkeeper'], seeded_rng('t')) is None)
check('too small a squad yields no sheet', compose_lineup('TST', squad[:6], seeded_rng('t')) is None)

print()
if failures:
    print(f'{len(failures)} parser check(s) FAILED: {", ".join(failures)}')
    sys.exit(1)
print('All parser checks passed.')
