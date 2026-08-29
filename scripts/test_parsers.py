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
from datetime import datetime, timezone  # noqa: E402
from update_data import (  # noqa: E402
    parse_rankings_text, parse_squad_lines, parse_player_rows, normalize_fih_name,
    compose_lineup, seeded_rng, reconcile_team_lists, parse_team_staff,
    parse_tms_results, update_statuses, backfill_scores_from_tms,
    backfill_stage_scores, update_live_scores,
    revise_stale_predictions, fix_venues, predict, points_from_rank,
    parse_match_page, apply_player_rankings, parse_match_report_goals,
    slot_knockouts, stage1_placements, normalize_captaincy, parse_h2h,
    resolve_fixture_for_page, page_score_for, attach_missing_shootouts,
    team_form, form_delta, h2h_delta, effective_points, FORM_CAP, H2H_CAP, TMS_LINEUP_LINK,
    non_knockout_pick,
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

# England's players hold both England and Great Britain caps, so their rows —
# and only theirs — carry a breakdown after the total. Requiring the row to end
# at the caps figure read two England players out of eighteen, and the nation
# was dropped as a misread.
england = parse_squad_lines([
    'Team Details England',
    'Shirt No. Player Date of Birth Age* Caps',
    '2 PARK Nicholas 8 Apr 1999 27 79 (ENG 56, GBR 23)',
    '7 WALLACE Zachary (C) 29 Sep 1999 26 160 (ENG 84, GBR 76)',
    '16 MAZARELO James (GK) 4 Feb 2001 25 68 (ENG 47, GBR 21)',
    '33 HOOPER Samuel 7 Aug 1998 28 30',
])['ENG']
check('a caps breakdown after the total does not break the row', len(england) == 4)
by_no = {p['number']: p for p in england}
check('the caps total is read, not the breakdown', by_no[2]['caps'] == 79)
check('captain still read behind a caps breakdown', by_no[7]['is_captain'])
check('goalkeeper still read behind a caps breakdown', by_no[16]['goalkeeper'])
check('a row without a breakdown still reads', by_no[33]['caps'] == 30)

# Each nation's page carries a Team Staff block. The app was showing a stale
# England coach while the entry list named the real one.
staff = parse_team_staff([
    'Team Details England', 'Team Staff', 'Role Name',
    'Team Manager GANNON Paul', 'Head Coach JONES Zak', 'Assistant Coach HICKMAN Mark',
    'Team Details Argentina', 'Head Coach REY Lucas',
])
check('the head coach is read, in the app’s name order', staff == {'ENG': 'Zak Jones', 'ARG': 'Lucas Rey'})
check('an assistant coach is not read as the head coach',
      'Mark Hickman' not in staff.values() and 'Paul Gannon' not in staff.values())

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
    ('GROßE Johannes', 'Johannes Große'),
    ('von MONTGELAS Hugo', 'Hugo von Montgelas'),
    # A hyphenated given name carries two capitals without being a surname —
    # counting capitals across the whole token read these as surnames, left the
    # given-name half empty, and shipped the name backwards.
    ('KAUFMANN Paul-Philipp', 'Paul-Philipp Kaufmann'),
    ('DANNEBERG Jean-Paul', 'Jean-Paul Danneberg'),
    # Mononyms, and a row already the right way round with the surname shouted.
    ('WAQAR', 'Waqar'),
    ('Abdul MANAN', 'Abdul Manan'),
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

print('\nReconciling against the official list')

doc = {'players': [
    {'team': 'PAK', 'name': 'WAQAR', 'source': 'fih-team-list', 'goals': 3},
    {'team': 'PAK', 'name': 'Ali Raza', 'source': 'fih-team-list'},
    {'team': 'PAK', 'name': 'Misread Name', 'source': 'fih-team-list'},
    {'team': 'PAK', 'name': 'Seeded Veteran', 'source': None, 'goals': 5},
    {'team': 'NED', 'name': 'Untouched', 'source': 'fih-team-list'},
]}
reconcile_team_lists(doc, {'PAK': [{'name': 'Waqar'}, {'name': 'Ali Raza'}]})
names = [p['name'] for p in doc['players']]
# Matching ignores case so a re-read finds the same player — which meant a row
# added before the name reader was fixed kept its old spelling for good.
check('the official spelling replaces an old machine-added one', 'Waqar' in names)
check('respelling keeps the player, and his record',
      next(p for p in doc['players'] if p['name'] == 'Waqar').get('goals') == 3)
check('a name the list no longer carries is removed', 'Misread Name' not in names)
check('a hand-seeded player is never removed', 'Seeded Veteran' in names)
check('a hand-seeded player left out of the squad is marked, not deleted',
      next(p for p in doc['players'] if p['name'] == 'Seeded Veteran')['on_team_list'] is False)
check('a nation the list did not cover is left alone', 'Untouched' in names)
check('listed players are marked',
      all(p['on_team_list'] for p in doc['players'] if p['name'] in ('Waqar', 'Ali Raza')))

# Calnan sat on seeded #7 while FIH lists him at #31 — which blocked the real
# #7, Wallace, from ever being added. The list is the authority on identity.
doc2 = {'players': [{'team': 'ENG', 'name': 'Will Calnan', 'number': 7,
                     'position': 'Midfielder', 'goals': 2}]}
reconcile_team_lists(doc2, {'ENG': [
    {'name': 'Will Calnan', 'number': 31, 'is_captain': False, 'goalkeeper': False},
]})
p = doc2['players'][0]
check('a stale seeded shirt number is corrected to the official one', p['number'] == 31)
check('identity correction never touches statistics', p['goals'] == 2)

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
# The pitch draws rows in list order, so an interleaved XI stood a midfielder
# in the back line — visible on the England sheet.
check('the XI is ordered by line, so the pitch draws it correctly',
      [p['line'] for p in xi] == ['Goalkeeper'] + ['Defender'] * 4 + ['Midfielder'] * 3 + ['Forward'] * 3)
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

print('\nTMS matches-page results')

# Verbatim from the live run's dump: pair, then a final score or a relative
# time for upcoming matches, then the pool letter.
page = [
    'FIH Hockey World Cup Belgium &amp; Netherlands 2026 (M)', '15 - 30 Aug 2026',
    'Local Time 2026-08-17 17:50:54',
    '&nbsp;', 'IND - WAL', '&nbsp;', '3 - 1', 'D',
    '&nbsp;', 'PAK - WAL', '&nbsp;', '3 - 3', 'D',
    '&nbsp;', 'FRA - MAS', '&nbsp;', '3 - 3', 'B',
    '&nbsp;', 'IND - ENG', '&nbsp;', '2 - 4', 'D',
    '&nbsp;', 'GER - BEL', '&nbsp;', '2 hours from now', 'B',
    '&nbsp;', 'NZL - JPN', '&nbsp;', '15 hours from now', 'A',
]
results = parse_tms_results(page)
check('finished matches are read with their scores',
      results.get(('PAK', 'WAL')) == (3, 3) and results.get(('IND', 'ENG')) == (2, 4))
check('an upcoming match yields no result', ('GER', 'BEL') not in results)
check('"15 hours from now" is not a score', ('NZL', 'JPN') not in results)
check('the tournament banner "15 - 30" is not a pair or score',
      all(k[0] in ('IND', 'PAK', 'FRA') for k in results))
# The medal round is a genuine re-match weekend — bronze repeats a pool
# pairing, gold a stage-2 one — so one ambiguous pairing must drop THAT PAIR,
# never the page: returning None here is how finals day would have gone dark.
_dup = parse_tms_results(['IND - WAL', '3 - 1', 'IND - WAL', '2 - 1', 'PAK - RSA', '4 - 4'])
check('a pair repeated with different scores drops the pair, not the page',
      _dup is not None and ('IND', 'WAL') not in _dup and _dup.get(('PAK', 'RSA')) == (4, 4))
check('an empty page yields no results', parse_tms_results([]) == {})

# Knockout rows carry the shoot-out — inline after the score or on its own
# line. This is what left WAL v MAS and PAK v RSA "live" for a day: an
# annotation no pattern recognised meant no score was read at all.
_so = {}
_r = parse_tms_results(['WAL - MAS', '&nbsp;', '2 - 2 (2 - 1) SO', 'D',
                        'PAK - RSA', '&nbsp;', '4 - 4', 'SO (4 - 3)', 'G',
                        'IND - ENG', '&nbsp;', '2 - 4', 'D'], shootouts_out=_so)
check('an inline shoot-out yields the regulation score',
      _r.get(('WAL', 'MAS')) == (2, 2) and _so.get(('WAL', 'MAS')) == (2, 1))
check('a shoot-out on its own line is attached to its match',
      _r.get(('PAK', 'RSA')) == (4, 4) and _so.get(('PAK', 'RSA')) == (4, 3))
check('a decisive score gains no phantom shoot-out',
      _r.get(('IND', 'ENG')) == (2, 4) and ('IND', 'ENG') not in _so)

# The live page's actual classification rows, verbatim from a branch probe of
# 29 Aug: the SO tag sits INSIDE the parens — "2 - 2 (2 - 1 SO)" — a one-token
# placement no earlier pattern read, which is what left the 15/16th and
# 11/12th places unscored while the listing carried them all along.
_so_in = {}
_r_in = parse_tms_results(['WAL - MAS', '&nbsp;', '2 - 2 (2 - 1 SO)', '15/16',
                           'PAK - RSA', '&nbsp;', '4 - 4 (4 - 3 SO)', '11/12',
                           'IND - BEL', '&nbsp;', '3 - 3 (3 - 4 SO)', '7/8'],
                          shootouts_out=_so_in)
check('the SO tag inside the parens still yields regulation score + shoot-out',
      _r_in == {('WAL', 'MAS'): (2, 2), ('PAK', 'RSA'): (4, 4), ('IND', 'BEL'): (3, 3)}
      and _so_in == {('WAL', 'MAS'): (2, 1), ('PAK', 'RSA'): (4, 3), ('IND', 'BEL'): (3, 4)})

# A completed drawn knockout with no shoot-out on file cannot say who
# advanced; the listing still shows it, so any later run may attach it.
_fk = {'matches': [{'id': 'POS7', 'home': 'IND', 'away': 'BEL', 'phase': 'classification',
                    'status': 'completed', 'score': {'home': 3, 'away': 3}}]}
attach_missing_shootouts(_fk, {('IND', 'BEL'): (3, 4)})
check('a drawn knockout picks up its missing shoot-out late',
      _fk['matches'][0].get('shootout') == {'home': 3, 'away': 4})

print('\nRe-match weekend: pages must find the right namesake')

# The corruption of 29 Aug in miniature: the bronze final repeats a pool
# pairing. The pool page must resolve to the pool match, the medal page to
# the medal match, and neither may re-target a finished fixture.
_refx = {'matches': [
    {'id': 'A3', 'home': 'ARG', 'away': 'NED', 'date': '2026-08-18', 'status': 'completed'},
    {'id': 'BRZ', 'home': 'NED', 'away': 'ARG', 'date': '2026-08-30', 'status': 'scheduled'},
    {'id': 'B1', 'home': 'BEL', 'away': 'GER', 'date': '2026-08-17', 'status': 'completed'},
]}
_r1 = resolve_fixture_for_page(_refx, {'pair': ('NED', 'ARG'), 'date': '2026-08-30'})
_r2 = resolve_fixture_for_page(_refx, {'pair': ('ARG', 'NED'), 'date': '2026-08-18'})
_r3 = resolve_fixture_for_page(_refx, {'pair': ('BEL', 'GER'), 'date': '2026-08-30'})
check('a medal page resolves to the medal match, not the pool re-match',
      _r1 is not None and _r1['id'] == 'BRZ')
check('the pool page still resolves to the pool match', _r2 is not None and _r2['id'] == 'A3')
check('a page from another day never re-targets a finished fixture', _r3 is None)

# And the listing consumer: on a re-match pair, the reversed-orientation
# fallback read the EARLIER match's row as this one's — the exact mechanism
# that "witnessed" a twelve-day-old pool score into the bronze final.
_page = {('ARG', 'NED'): (1, 3)}
_brz = _refx['matches'][1]
check('a re-match never reads the earlier meeting through the reversed lookup',
      page_score_for(_brz, _page, _refx) is None)
_b1 = _refx['matches'][2]
check('a single meeting still accepts the reversed orientation',
      page_score_for(_b1, {('GER', 'BEL'): (2, 1)}, _refx) == (1, 2))

print('\nMatch status honesty')

def fx(status, date='2026-08-17', time='20:30', score=None):
    return {'matches': [{'id': 'B3', 'home': 'BEL', 'away': 'GER', 'phase': 'pool',
                         'pool': 'B', 'date': date, 'time': time, 'status': status,
                         'score': score, 'venue': 'BRU'}]}

# 15:00 UTC = 17:00 CEST: BEL v GER (20:30) has not kicked off.
afternoon = datetime(2026, 8, 17, 15, 0, tzinfo=timezone.utc)
night = datetime(2026, 8, 17, 22, 0, tzinfo=timezone.utc)

f = fx('scheduled')
update_statuses(f, now=afternoon)
check('a future match stays scheduled', f['matches'][0]['status'] == 'scheduled')

# The exact reported bug: completed with no score, hours before kickoff.
f = fx('completed')
update_statuses(f, now=afternoon)
check('a clock-completed match with no score is walked back',
      f['matches'][0]['status'] == 'scheduled')

# A match left 'live' under a wrong time, whose corrected kickoff is later.
f = fx('live')
update_statuses(f, now=afternoon)
check('a live match before its corrected kickoff walks back to scheduled',
      f['matches'][0]['status'] == 'scheduled')

f = fx('live')
update_statuses(f, now=night)
check('past the window with no score stays live, never completed',
      f['matches'][0]['status'] == 'live')

f = fx('live', score={'home': 2, 'away': 2})
update_statuses(f, now=night)
check('past the window with a score completes', f['matches'][0]['status'] == 'completed')

f = fx('completed', score={'home': 2, 'away': 2})
update_statuses(f, now=afternoon)
check('a completed match with a real score is never walked back',
      f['matches'][0]['status'] == 'completed')

# Backfill: the standings row is the witness. PAK and WAL each played one new
# match and their deltas cross-check as 3-3 — that resolves. GER's row has not
# moved, so GER v BEL yields nothing rather than a phantom 0-0.
def rows(**kw):
    base = {'PAK': (2, 7, 4), 'WAL': (2, 3, 8), 'GER': (2, 5, 2), 'BEL': (2, 6, 3)}
    base.update(kw)
    return {'X': [{'team': t, 'played': p, 'gf': gf, 'ga': ga}
                  for t, (p, gf, ga) in base.items()]}

fixtures = {'matches': [
    {'id': 'D2', 'home': 'ENG', 'away': 'PAK', 'phase': 'pool', 'pool': 'D',
     'date': '2026-08-15', 'time': '17:00', 'status': 'completed', 'score': {'home': 4, 'away': 1}},
    {'id': 'D0', 'home': 'WAL', 'away': 'IND', 'phase': 'pool', 'pool': 'D',
     'date': '2026-08-15', 'time': '13:30', 'status': 'completed', 'score': {'home': 0, 'away': 5}},
    {'id': 'D4', 'home': 'PAK', 'away': 'WAL', 'phase': 'pool', 'pool': 'D',
     'date': '2026-08-17', 'time': '09:30', 'status': 'live', 'score': None},
    {'id': 'B3', 'home': 'BEL', 'away': 'GER', 'phase': 'pool', 'pool': 'B',
     'date': '2026-08-17', 'time': '20:30', 'status': 'scheduled', 'score': None},
]}
tms = rows(PAK=(2, 4, 7), WAL=(2, 3, 8), GER=(1, 2, 1), BEL=(1, 3, 2))
# local: PAK played 1 (1 GF, 4 GA), WAL played 1 (0 GF, 5 GA)
backfill_scores_from_tms(fixtures, tms, now=afternoon)
d4 = fixtures['matches'][2]
check('a live match past its window is backfilled from standings deltas',
      d4['score'] == {'home': 3, 'away': 3})
check('the backfilled match is closed on the spot', d4['status'] == 'completed')
b3 = fixtures['matches'][3]
check('an unplayed match never becomes a phantom 0-0',
      b3['score'] is None and b3['status'] == 'scheduled')

# The matches page as primary source: the score is applied pair-direct (with
# orientation), and a page score whose match the standings have not yet
# absorbed is treated as possibly live and left alone.
fixtures['matches'][2].update(status='live', score=None)
fixtures['matches'][2].pop('result_source', None)
tms_stale = rows(PAK=(1, 1, 4), WAL=(1, 0, 5), GER=(1, 2, 1), BEL=(1, 3, 2))
backfill_scores_from_tms(fixtures, {'X': tms_stale['X']},
                         page_results={('WAL', 'PAK'): (2, 1)}, now=afternoon)
check('a page score is not applied while standings have not absorbed the match',
      fixtures['matches'][2]['score'] is None)
backfill_scores_from_tms(fixtures, tms, page_results={('WAL', 'PAK'): (3, 3)}, now=afternoon)
d4 = fixtures['matches'][2]
check('a page score is applied once standings confirm, oriented to our fixture',
      d4['score'] == {'home': 3, 'away': 3} and d4['result_source'] == 'fih-tms-matches'
      and d4['status'] == 'completed')

print('\nStage 2 / knockout score backfill (no pool table to witness)')

# The reported failure: FRA v RSA (S2H1) and IRL v MAS (S2H2) finished hours
# earlier but sat live and scoreless, because the only score-writing path
# filtered phase == 'pool'.
def stage_fx(**over):
    base = {'id': 'S2H1', 'matchNo': 25, 'home': 'FRA', 'away': 'RSA',
            'phase': 'stage2', 'pool': 'H', 'date': '2026-08-21', 'time': '11:00',
            'status': 'live', 'score': None, 'tms_id': 4025}
    base.update(over)
    return {'matches': [base]}

# 11:00 CEST kickoff: window (105') closes 12:45 CEST = 10:45 UTC.
in_window = datetime(2026, 8, 21, 10, 0, tzinfo=timezone.utc)     # 12:00 CEST, Q4-ish
past_window = datetime(2026, 8, 21, 11, 30, tzinfo=timezone.utc)  # 13:30 CEST
next_run = datetime(2026, 8, 21, 12, 0, tzinfo=timezone.utc)
page = {('FRA', 'RSA'): (1, 3)}
no_report = lambda m: None

f = stage_fx()
backfill_stage_scores(f, page, now=in_window, report_tally=no_report)
check('a page score inside the match window is never written (could be live)',
      f['matches'][0]['score'] is None and 'score_seen' not in f['matches'][0])

f = stage_fx()
backfill_stage_scores(f, page, now=past_window, report_tally=lambda m: (1, 3))
s = f['matches'][0]
check('report tally matching the page score confirms on the first run',
      s['score'] == {'home': 1, 'away': 3} and s['status'] == 'completed'
      and s['result_source'] == 'fih-tms-matches')
check('the pending sighting is cleared once written', 'score_seen' not in s)

f = stage_fx()
backfill_stage_scores(f, page, now=past_window, report_tally=no_report)
s = f['matches'][0]
check('no report yet: the sighting is recorded, no score written',
      s['score'] is None and s['score_seen']['home'] == 1 and s['score_seen']['away'] == 3)
backfill_stage_scores(f, page, now=past_window, report_tally=no_report)
check('the same run window does not confirm its own sighting', s['score'] is None)
backfill_stage_scores(f, page, now=next_run, report_tally=no_report)
check('a second run with the same score 30 min later confirms it',
      s['score'] == {'home': 1, 'away': 3} and s['status'] == 'completed')

f = stage_fx()
backfill_stage_scores(f, page, now=past_window, report_tally=no_report)
backfill_stage_scores(f, {('FRA', 'RSA'): (2, 3)}, now=next_run, report_tally=no_report)
s = f['matches'][0]
check('a score that moved between runs restarts the wait — it was live',
      s['score'] is None and s['score_seen']['home'] == 2)

f = stage_fx()
backfill_stage_scores(f, {('RSA', 'FRA'): (3, 1)}, now=past_window, report_tally=lambda m: (1, 3))
check('a reversed page pair is oriented to our fixture',
      f['matches'][0]['score'] == {'home': 1, 'away': 3})

# The live-run finding: IRL 7-4 MAS on the page, but the report parser only
# tallied 3-2 of eleven goals. Stage 2 has no shootouts, so a report mismatch
# there is a parse shortfall — it must not veto the stability witness.
f = stage_fx(id='S2H2', home='IRL', away='MAS')
page74 = {('IRL', 'MAS'): (7, 4)}
backfill_stage_scores(f, page74, now=past_window, report_tally=lambda m: (3, 2))
s = f['matches'][0]
check('stage2: an under-read report falls back to the sighting, no fast-track',
      s['score'] is None and s['score_seen']['home'] == 7)
backfill_stage_scores(f, page74, now=next_run, report_tally=lambda m: (3, 2))
check('stage2: page stability then lands the score despite the short report',
      s['score'] == {'home': 7, 'away': 4} and s['status'] == 'completed')

# In the knockout rounds a shootout CAN be folded into a page score, so a
# disagreeing report blocks the write outright there.
f = stage_fx(id='POS5', phase='classification', pool=None)
backfill_stage_scores(f, page, now=past_window, report_tally=lambda m: (1, 2))
s = f['matches'][0]
check('knockouts: a report disagreeing with the page blocks the write entirely',
      s['score'] is None and 'score_seen' not in s)
backfill_stage_scores(f, page, now=past_window, report_tally=lambda m: (1, 3))
check('knockouts: a report agreeing with the page confirms first run',
      s['score'] == {'home': 1, 'away': 3})

f = stage_fx()
backfill_stage_scores(f, {('FRA', 'RSA'): (0, 0)}, now=past_window, report_tally=lambda m: (0, 0))
s = f['matches'][0]
check('an empty report tally never fast-tracks a 0-0 (parse-failure lookalike)',
      s['score'] is None and s.get('score_seen', {}).get('home') == 0)
backfill_stage_scores(f, {('FRA', 'RSA'): (0, 0)}, now=next_run, report_tally=lambda m: (0, 0))
check('a stable 0-0 still lands via the two-run path',
      s['score'] == {'home': 0, 'away': 0})

f = stage_fx(phase='pool', pool='B')
backfill_stage_scores(f, page, now=past_window, report_tally=lambda m: (1, 3))
check('pool matches stay with the standings-witness path',
      f['matches'][0]['score'] is None)

f = stage_fx(home='TBD', away='TBD')
backfill_stage_scores(f, page, now=past_window, report_tally=no_report)
check('an unslotted fixture is untouched', f['matches'][0]['score'] is None)

# The stability window is two adjacent runs of the 10-minute match-hours
# cron: one 10-minute gap is not yet a confirmation, twelve minutes is.
f = stage_fx()
backfill_stage_scores(f, page, now=past_window, report_tally=no_report)
backfill_stage_scores(f, page, now=datetime(2026, 8, 21, 11, 40, tzinfo=timezone.utc),
                      report_tally=no_report)
check('ten minutes of stability is not yet a confirmation', f['matches'][0]['score'] is None)
backfill_stage_scores(f, page, now=datetime(2026, 8, 21, 11, 42, tzinfo=timezone.utc),
                      report_tally=no_report)
check('twelve minutes of stability confirms (two 10-minute runs apart)',
      f['matches'][0]['score'] == {'home': 1, 'away': 3})

f = stage_fx(score={'home': 4, 'away': 2}, status='completed')
backfill_stage_scores(f, page, now=past_window, report_tally=lambda m: (1, 3))
check('an existing (e.g. manual) score is never overwritten',
      f['matches'][0]['score'] == {'home': 4, 'away': 2})

print('\nLive scores mid-match (display-only, never a final)')

# 11:00 CEST kickoff again: in-window at 12:00 CEST, window closes 12:45 CEST.
f = stage_fx()
update_live_scores(f, {('FRA', 'RSA'): (0, 2)}, now=in_window)
s = f['matches'][0]
check('an in-window page score lands as live_score',
      s.get('live_score', {}).get('home') == 0 and s['live_score']['away'] == 2)
check('the final score field is untouched', s['score'] is None and s['status'] == 'live')
update_live_scores(f, {('FRA', 'RSA'): (0, 2)}, now=in_window)
check('an unchanged sighting writes nothing new', s['live_score']['away'] == 2)
update_live_scores(f, {('RSA', 'FRA'): (3, 1)}, now=in_window)
check('a reversed pair updates, oriented to our fixture',
      s['live_score'] == dict(s['live_score'], home=1, away=3))

# Past the window the last in-play score STAYS on the board through the
# score-wait — the reader keeps "last updated 1-3" instead of a blank card
# while the final is double-witnessed. No new value is taken (the witnessed
# backfill owns the final), and completion clears the field.
update_live_scores(f, {('FRA', 'RSA'): (2, 4)}, now=past_window)
check('past the window the last live score is retained, not replaced',
      s.get('live_score', {}).get('home') == 1 and s['live_score']['away'] == 3)

f = stage_fx(date='2026-08-21', time='14:00')
update_live_scores(f, {('FRA', 'RSA'): (1, 0)}, now=in_window)
check('before push-back nothing is written', 'live_score' not in f['matches'][0])
f['matches'][0]['live_score'] = {'home': 1, 'away': 0, 'at': '2026-08-21T09:30:00+00:00'}
update_live_scores(f, {}, now=in_window)
check('a live score on a not-yet-started fixture (moved schedule) is dropped',
      'live_score' not in f['matches'][0])

f = stage_fx()
f['matches'][0]['live_score'] = {'home': 1, 'away': 1, 'at': '2026-08-21T09:30:00+00:00'}
backfill_stage_scores(f, page, now=past_window, report_tally=lambda m: (1, 3))
check('completion clears the live score alongside writing the final',
      f['matches'][0]['score'] == {'home': 1, 'away': 3} and 'live_score' not in f['matches'][0])

print('\nOracle pick revision (erratum, never rewrite)')

# The reported case: FRA v MAS picked "MAS favoured" off seeded ranks that had
# MAS #10 / FRA #13, when fih.hockey has FRA #9 / MAS #14.
future = {'matches': [
    {'id': 'B4', 'home': 'FRA', 'away': 'MAS', 'phase': 'pool', 'pool': 'B',
     'date': '2026-08-18', 'time': '17:00', 'status': 'scheduled', 'score': None},
    {'id': 'B9', 'home': 'FRA', 'away': 'MAS', 'phase': 'pool', 'pool': 'B',
     'date': '2026-08-16', 'time': '17:00', 'status': 'live', 'score': None},
]}
stale = lambda mid: {
    'id': f'oracle-v1:{mid}', 'matchId': mid, 'source': 'oracle-v1', 'basis': 'pre-match',
    'p_home_win': 0.28, 'p_draw': 0.17, 'p_away_win': 0.55,
    'pick': 'AWAY', 'pick_confidence': 0.55,
    'reason': 'FIH #10 MAS favoured over #13 FRA — Elo model from world rankings.',
}
preds = {'predictions': [stale('B4'), stale('B9')]}
ranks = {'FRA': 9, 'MAS': 14}
points = {c: points_from_rank(r) for c, r in ranks.items()}
revise_stale_predictions(future, preds, ranks, points, afternoon)
b4 = [p for p in preds['predictions'] if p['matchId'] == 'B4']
b9 = [p for p in preds['predictions'] if p['matchId'] == 'B9']
check('a stale pick on an unstarted match is superseded, not rewritten',
      b4[0]['superseded'] and b4[0]['pick'] == 'AWAY' and len(b4) == 2)
# What the revision must do is re-run the published model on the corrected
# ranking points — not reach a particular verdict. It used to assert HOME and
# the bare two-way distribution, which pinned the test to one configuration of
# model/params.json: with the tournament switches published, a favourite whose
# points have risen more than the surge threshold since the baseline is called
# a draw, and the assertion failed on correct behaviour rather than on a bug.
import model_non_knockout as _nkm_t
_expected = non_knockout_pick(
    future['matches'][0], predict(points['FRA'], points['MAS']),
    points, future, {})
check('the revision re-runs the published model on the corrected points',
      b4[1]['pick'] == _expected['prediction'] and b4[1]['revises'] == 'oracle-v1:B4',
      f"{b4[1]['pick']} vs {_expected['prediction']}")
check('revision probabilities are the ones that support the revised pick',
      (b4[1]['p_home_win'], b4[1]['p_draw'], b4[1]['p_away_win'])
      == (_expected['probs']['HOME'], _expected['probs']['DRAW'], _expected['probs']['AWAY']))
check('the revised pick is one the model can return',
      b4[1]['pick'] in ('HOME', 'DRAW', 'AWAY') and _expected['mode'] == _nkm_t.DEFAULT_MODE)
check('a started match is never touched',
      len(b9) == 1 and not b9[0].get('superseded'))
check('a second pass changes nothing',
      not revise_stale_predictions(future, preds, ranks, points, afternoon))

print('\nTMS match page (kickoff and venue)')

# Shaped like the live dump: the pairing near the top, the head-to-head
# section carrying dates of PAST meetings, then the labeled Details rows.
match_page = [
    'Home', 'FIH Hockey World Cup Belgium &amp; Netherlan...', 'IND v WAL',
    'D', 'India', '3 - 1', 'Official', 'Wales',
    'Lineups', 'Goals', 'Cards', 'Officials', 'Head to Head', 'Details',
    'Senior Mens Outdoor', '19 Jan 2023  19:00', 'IND v WAL (Pool D)',
    'Senior Mens Outdoor', '4 Aug 2022  14:00', 'IND v WAL (Pool B)',
    'Date/Time', '2026-08-15 13:00', 'Title',
    'D', 'Venue', 'Wagener Hockey Stadium, Amstelveen',
]
info = parse_match_page(match_page)
check('the match page parses', info is not None)
check('the pairing is read', info and info['pair'] == ('IND', 'WAL'))
check('the labeled Date/Time row wins, not head-to-head history',
      info and (info['date'], info['time']) == ('2026-08-15', '13:00'))
check('the venue resolves to its code', info and info['venue'] == 'AMV')
check('a Belfius venue resolves too',
      parse_match_page(['GER v BEL', 'Date/Time', '2026-08-17 20:30',
                        'Venue', 'Belfius Hockey Arena, Brussels'])['venue'] == 'BRU')
check('a page with no labeled kickoff yields nothing',
      parse_match_page(['IND v WAL', '19 Jan 2023  19:00']) is None)
check('a date outside the tournament is refused',
      parse_match_page(['IND v WAL', 'Date/Time', '2023-01-19 19:00']) is None)

print('\nPool venues')
vfix = {'matches': [
    {'id': 'D4', 'home': 'PAK', 'away': 'WAL', 'phase': 'pool', 'pool': 'D', 'venue': 'BRU'},
    {'id': 'B4', 'home': 'FRA', 'away': 'MAS', 'phase': 'pool', 'pool': 'B', 'venue': 'AMV'},
    {'id': 'A1', 'home': 'ARG', 'away': 'JPN', 'phase': 'pool', 'pool': 'A', 'venue': 'AMV'},
    {'id': 'QF1', 'home': 'TBD', 'away': 'TBD', 'phase': 'quarter-final', 'venue': 'AMV'},
]}
fix_venues(vfix)
check('pool D plays at the Wagener', vfix['matches'][0]['venue'] == 'AMV')
check('pool B plays at the Belfius', vfix['matches'][1]['venue'] == 'BRU')
check('a correct venue is left alone', vfix['matches'][2]['venue'] == 'AMV')
check('knockout venues are not guessed', vfix['matches'][3]['venue'] == 'AMV')

print('\nMatch report goals (real timeline)')

# Verbatim from the live ENG v IND report's scoring section.
eng_ind = parse_match_report_goals([
    'Team Minute Number Action Score Team Minute Number Action Score',
    'ENG 14 23 FG 0 - 1', 'IND 17 13 PC 1 - 1', 'IND 25 9 FG 2 - 1',
    'ENG 39 17 FG 2 - 2', 'ENG 43 9 FG 2 - 3', 'ENG 55 23 PC 2 - 4',
    'FG - Field Goal, PC - Penalty Corner, PS - Penalty Stroke',
])
check('every goal line is read', len(eng_ind) == 6)
check('team, minute, shirt and method are read',
      eng_ind[0] == {'team': 'ENG', 'minute': 14, 'shirt': 23, 'via': 'FG'})
check('goals count reconstructs the score by explicit team code',
      sum(g['team'] == 'ENG' for g in eng_ind) == 4 and sum(g['team'] == 'IND' for g in eng_ind) == 2)
check('the header and legend rows are not read as goals',
      all(g['team'] in ('ENG', 'IND') for g in eng_ind))
# A penalty stroke, and orientation independence (WAL is the away team here).
pak_wal = parse_match_report_goals([
    'PAK 3 18 FG 1 - 0', 'WAL 25 18 PC 1 - 1', 'WAL 26 15 FG 1 - 2',
    'PAK 49 5 PC 2 - 2', 'PAK 51 9 FG 3 - 2', 'WAL 53 18 PS 3 - 3',
])
check('a penalty stroke is read', any(g['via'] == 'PS' for g in pak_wal))
check('the score orientation in the line is ignored',
      sum(g['team'] == 'PAK' for g in pak_wal) == 3 and sum(g['team'] == 'WAL' for g in pak_wal) == 3)

# Verbatim from the live IRL v MAS report (probe run 22359): eleven goals wrap
# into side-by-side columns, so three lines carry TWO entries each. The old
# anchored per-line match read only the left column and tallied 3-2 of 7-4.
irl_mas = parse_match_report_goals([
    'Team Minute Number Action Score Team Minute Number Action Score Team Minute Number Action Score',
    'IRL 8 25 FG 1 - 0 MAS 41 23 PC 6 - 3',
    'IRL 12 25 PC 2 - 0 IRL 54 24 FG 7 - 3',
    'IRL 19 9 FG 3 - 0 MAS 55 10 FG 7 - 4',
    'IRL 24 25 FG 4 - 0',
    'MAS 29 31 PC 4 - 1',
    'MAS 36 29 PC 4 - 2',
    'IRL 37 8 PC 5 - 2',
    'IRL 39 9 FG 6 - 2',
    'FG - Field Goal, PC - Penalty Corner, PS - Penalty Stroke',
])
check('a two-column scoresheet yields every goal', len(irl_mas) == 11, str(len(irl_mas)))
check('the two-column tally reconstructs 7-4',
      sum(g['team'] == 'IRL' for g in irl_mas) == 7 and sum(g['team'] == 'MAS' for g in irl_mas) == 4)
check('the right-column entries carry their own minutes',
      {(g['minute'], g['team']) for g in irl_mas} >= {(41, 'MAS'), (54, 'IRL'), (55, 'MAS')})
check('two-column header and legend rows still yield nothing',
      all(g['team'] in ('IRL', 'MAS') for g in irl_mas))

print('\nMatch model calibration (v3, points-based, backtested)')

ph, pd, pa = predict(3000, 3000)
check('equal teams sit near thirds with a full draw', pd >= 0.30 and abs(ph - pa) < 0.01)
ph, pd, pa = predict(2550, 2409)   # PAK v WAL — finished 3-3
check('a 141-point gap is a narrow favourite, not 75%', ph < 0.50 and pd > 0.28)
ph, pd, pa = predict(3838, 2397)   # BEL v JPN
check('a 1,400-point gap is still decisive', ph > 0.85 and pd <= 0.06)
ph, pd, pa = predict(2409, 2550)
check('the model is symmetric', (pa, pd) == (predict(2550, 2409)[0], predict(2550, 2409)[1]))
check('probabilities always sum to ~1',
      all(abs(sum(predict(a, b)) - 1) < 0.01
          for a, b in [(3838, 2397), (2550, 2409), (3000, 3000), (2397, 3838)]))
check('the rank fallback spans the real table', 3800 < points_from_rank(1) < 3900
      and 2350 < points_from_rank(16) < 2450)

print('\nFIH player world ranking')

pdoc = {'players': [
    {'team': 'NED', 'name': 'Max de Bie', 'goals': 1},
    {'team': 'PAK', 'name': 'Rehman Abdul'},
    {'team': 'ENG', 'name': 'Christopher Bowen'},
    {'team': 'GER', 'name': 'Luca Alvarez-Kirsch'},
    {'team': 'IND', 'name': 'Harmanpreet Singh'},
]}
sheet = {'players': [
    {'rank': 57, 'name': 'De Bie Max', 'country': 'NED'},
    {'rank': 7, 'name': 'Rehman Abdul', 'country': 'PAK'},
    {'rank': 13, 'name': 'Bowen Christopher', 'country': 'GBR'},
    {'rank': 12, 'name': 'Alvarez-kirsch Luca', 'country': 'GER'},
    {'rank': 1, 'name': 'Zhou Chuanzu', 'country': 'CHN'},
    {'rank': 11, 'name': 'Upton Patrick Althony Ho…', 'country': 'RSA'},
]}
apply_player_rankings(pdoc, sheet)
by = {p['name']: p for p in pdoc['players']}
check('surname-first sheet names match our given-first names',
      by['Max de Bie'].get('world_rank') == 57)
check('an already-matching name order matches too',
      by['Rehman Abdul'].get('world_rank') == 7)
check('a GBR entry finds its England player', by['Christopher Bowen'].get('world_rank') == 13)
check('hyphens and case do not break the match',
      by['Luca Alvarez-Kirsch'].get('world_rank') == 12)
check('a matched player becomes a star', by['Max de Bie'].get('fih_star') is True)
check('a non-tournament nation is ignored',
      not any(p.get('world_rank') == 1 for p in pdoc['players']))
check('a truncated sheet name is skipped, never guessed',
      not any(p.get('world_rank') == 11 for p in pdoc['players']))
check('an unmatched star is never invented',
      by['Harmanpreet Singh'].get('world_rank') is None)
check('a second pass changes nothing', not apply_player_rankings(pdoc, sheet))

# The sheet writes full given names where squads use the everyday form —
# 'Neild Timothy' is our 'Tim Neild'. Exact token equality missed nearly every
# real match; the prefix rule closes it without ever guessing between two
# same-surname teammates.
pdoc2 = {'players': [
    {'team': 'NZL', 'name': 'Tim Neild'},
    {'team': 'NZL', 'name': 'Charlie Morrison'},
    {'team': 'NZL', 'name': 'Joseph Morrison'},
    {'team': 'GER', 'name': 'Hannes Müller'},
]}
apply_player_rankings(pdoc2, {'players': [
    {'rank': 2, 'name': 'Neild Timothy', 'country': 'NZL'},
    {'rank': 78, 'name': 'Morrison Charlie', 'country': 'NZL'},
    {'rank': 90, 'name': 'Mueller Hans', 'country': 'GER'},
]})
by2 = {p['name']: p for p in pdoc2['players']}
check('a diminutive matches its full given name', by2['Tim Neild'].get('world_rank') == 2)
check('two same-surname teammates never cross-match',
      by2['Charlie Morrison'].get('world_rank') == 78
      and by2['Joseph Morrison'].get('world_rank') is None)
check('a near-miss given name is not a match', by2['Hannes Müller'].get('world_rank') is None)

print('\nModel weighting: this tournament first, ranking always, history least')

def _fx(rows):
    return {'matches': [{'id': f'M{i}', 'phase': 'pool', 'status': 'completed',
                         'home': h, 'away': a, 'score': {'home': hg, 'away': ag}}
                        for i, (h, a, hg, ag) in enumerate(rows)]}

# Three wins and a big goal difference must lift a team; three losses must sink one.
_won = _fx([('AAA', 'X1', 4, 0), ('AAA', 'X2', 3, 1), ('AAA', 'X3', 5, 1)])
_lost = _fx([('BBB', 'X1', 0, 4), ('BBB', 'X2', 1, 3), ('BBB', 'X3', 1, 5)])
_fw, _fl = form_delta(team_form('AAA', _won)), form_delta(team_form('BBB', _lost))
check('winning here raises a team', _fw > 100, f'{_fw:.1f}')
check('losing here lowers a team', _fl < -100, f'{_fl:.1f}')
check('form is bounded', abs(_fw) <= FORM_CAP and abs(_fl) <= FORM_CAP)
check('an unplayed team gets no form adjustment', form_delta(team_form('ZZZ', _won)) == 0)

# One match must not speak with the authority of three.
_one = _fx([('AAA', 'X1', 4, 0)])
check('a single match counts for less than a full campaign',
      0 < form_delta(team_form('AAA', _one)) < _fw,
      f"{form_delta(team_form('AAA', _one)):.1f} vs {_fw:.1f}")

# The head-to-head term is real — so citing it as a reason is honest — but it is
# deliberately the smallest input, and always smaller than form.
_meet = [{'home': 'AAA', 'away': 'BBB', 'home_goals': 3, 'away_goals': 1, 'current': False},
         {'home': 'BBB', 'away': 'AAA', 'home_goals': 0, 'away_goals': 2, 'current': False},
         {'home': 'AAA', 'away': 'BBB', 'home_goals': 4, 'away_goals': 2, 'current': False},
         {'home': 'AAA', 'away': 'BBB', 'home_goals': 1, 'away_goals': 0, 'current': False}]
_hd = h2h_delta(_meet, 'AAA', 'BBB')
check('a dominant head-to-head record moves the model', _hd > 0, f'{_hd:.1f}')
check('head-to-head is bounded', abs(_hd) <= H2H_CAP, f'{_hd:.1f}')
check('head-to-head can never outweigh this tournament', abs(_hd) < abs(_fw),
      f'h2h {_hd:.1f} vs form {_fw:.1f}')
check('the fixture being predicted is not counted as its own history',
      h2h_delta([{'home': 'AAA', 'away': 'BBB', 'home_goals': 9, 'away_goals': 0,
                  'current': True}], 'AAA', 'BBB') == 0)
check('no meetings means no adjustment', h2h_delta([], 'AAA', 'BBB') == 0)

# Ranking remains the base: a huge ranking gap is not overturned by either term.
_top, _bottom = 3695.0, 2330.0
_eff_bottom = effective_points('AAA', 'BBB', _bottom, _won, {'AAA-BBB': _meet})
_eff_top = effective_points('BBB', 'AAA', _top, _lost, {'AAA-BBB': _meet})
check('form and history together cannot overturn a 1,365-point ranking gap',
      _eff_top > _eff_bottom, f'{_eff_top:.0f} vs {_eff_bottom:.0f}')
# ...but a modest ranking gap can be overturned by a big swing in current form.
check('current form can overturn a narrow ranking gap',
      effective_points('AAA', 'BBB', 2800.0, _won, None)
      > effective_points('BBB', 'AAA', 2900.0, _lost, None))

print('\nHead-to-head table (TMS match page, verbatim from the live dump)')

_H2H = ['Head to Head Matches', 'Senior Mens Outdoor', 'Competition', 'Details',
        'Date/Time', 'Teams', 'Pitch', 'Status', 'Scoreline',
        'FIH Hockey World Cup Belgium & Netherlands 2026 (M)', 'Senior Mens Outdoor',
        '15 Aug 2026  13:00', 'IND v WAL (D)',
        'WHSA - Pitch 1 - Wagener Hockey Stadium', 'Official', '3 - 1', 'Lineup',
        "FIH Odisha Hockey Men's World Cup 2023 Bhubaneswar - Rourkela", 'Senior Mens Outdoor',
        '19 Jan 2023  19:00', 'IND v WAL (Pool D)',
        'KS - Pitch 1 - Bhubaneswar, India', 'Official', '4 - 2', 'Lineup',
        # 2022 and 2018 rows carry no pitch line — the row must not be read by offset
        'Commonwealth Games 2022 (M)', 'Senior Mens Outdoor', '4 Aug 2022  14:00',
        'IND v WAL (Pool B)', 'Official', '4 - 1', 'Lineup',
        'XXI Commonwealth Games (M)', 'Senior Mens Outdoor', '8 Apr 2018  19:30',
        'IND v WAL (Pool B)', 'Official', '4 - 3', 'Lineup',
        'XX Commonwealth Games 2014 (M)', 'Senior Mens Outdoor', '25 Jul 2014  09:00',
        'IND v WAL (Pool A)', 'Glasgow National Hockey Centre', 'Official', '3 - 1', 'Lineup',
        '*', 'Altius', 'rt',
        "data is accurate for every match from 2013 until today's date. Historic data from 2012 "
        'and earlier is currently in the process of being digitalised by', 'tech@fih.ch',
        # everything past the footnote belongs to other sections
        'Match Details', 'Competition', 'FIH Hockey World Cup Belgium & Netherlands 2026 (M)',
        'Date/Time', '2026-08-15 13:00', 'Venue', 'Wagener Hockey Stadium']
_rows = parse_h2h(_H2H, current_competition='FIH Hockey World Cup Belgium & Netherlands 2026 (M)')
check('every meeting in the table is read', len(_rows) == 5, str(len(_rows)))
check('a row with no pitch line still reads',
      any(r['date'] == '2022-08-04' and (r['home_goals'], r['away_goals']) == (4, 1) for r in _rows))
check('the match the page belongs to is marked as this tournament',
      [r['current'] for r in _rows] == [True, False, False, False, False])
check('dates are normalised', _rows[1]['date'] == '2023-01-19', _rows[1]['date'])
check('the competition is captured',
      _rows[2]['competition'] == 'Commonwealth Games 2022 (M)', str(_rows[2]['competition']))
check('the footnote closes the table — Match Details is not a meeting',
      not any(r['date'] == '2026-08-15' and r['competition'] == 'Venue' for r in _rows))
# TMS vouches for 2013 onward only, so an older row must never be counted.
check('a pre-2013 meeting is dropped, not counted',
      len(parse_h2h(_H2H[:9] + ['Champions Trophy 2009 (M)', 'Senior Mens Outdoor',
                                '1 Jun 2009  12:00', 'IND v WAL (Pool A)', 'Official',
                                '9 - 0', 'Lineup'])) == 0)
# An unplayed fixture in the table has no scoreline and must not become a result.
check('a meeting with no scoreline is not invented',
      len(parse_h2h(_H2H[:9] + ['Some Cup 2025 (M)', 'Senior Mens Outdoor',
                                '1 Jun 2025  12:00', 'IND v WAL (Pool A)', 'Scheduled',
                                'Lineup'])) == 0)
check('a page with no head-to-head table yields nothing', parse_h2h(['Match Details']) == [])

print('\nCaptaincy (exactly one per team, official list wins)')

def _cap_doc(players):
    return {'players': [dict(team=t, name=n, is_captain=c, source=s) for t, n, c, s in players]}

# Argentina's real shape before the fix: a seeded captain the official list does
# not carry, plus the captain the list does mark. Two "C" badges in the line-up.
doc = _cap_doc([
    ('ARG', 'Lucas Martín Rossi', True, None),
    ('ARG', 'Maico Casella', True, 'fih-team-list'),
    ('ARG', 'Matias Rey', False, 'fih-team-list'),
])
squads = {'ARG': [{'name': 'Maico Casella', 'is_captain': True},
                  {'name': 'Matias Rey', 'is_captain': False}]}
normalize_captaincy(doc, squads)
caps = [p['name'] for p in doc['players'] if p['is_captain']]
check('the officially-listed captain is the only captain', caps == ['Maico Casella'], str(caps))

# The list marks no captain but does name a squad. A seeded captain missing from
# that squad is not at the tournament — clear him rather than badge a player who
# cannot take the field. No replacement is invented.
doc = _cap_doc([('AUS', 'Aran Zalewski', True, None), ('AUS', 'Tim Brand', False, 'fih-team-list')])
normalize_captaincy(doc, {'AUS': [{'name': 'Tim Brand', 'is_captain': False}]})
check('a captain absent from the official squad is cleared',
      [p['name'] for p in doc['players'] if p['is_captain']] == [])

# But a captain who IS in the squad keeps the armband when the list marks nobody.
doc = _cap_doc([('NED', 'Thierry Brinkman', True, None)])
normalize_captaincy(doc, {'NED': [{'name': 'Thierry Brinkman', 'is_captain': False}]})
check('a squad captain survives a list that marks no captain',
      [p['name'] for p in doc['players'] if p['is_captain']] == ['Thierry Brinkman'])

# When the list itself marks two, both keep the armband. Hockey has co-captains
# and the FIH entry list marks them — two for Argentina, two for Wales. This
# used to keep only the first listed, so the squad check against the entry list
# reported the dropped second one as a difference, run after run.
doc = _cap_doc([('WAL', 'Benjamin Francis', True, 'fih-team-list'),
                ('WAL', 'Jacob Draper', True, 'fih-team-list')])
normalize_captaincy(doc, {'WAL': [{'name': 'Jacob Draper', 'is_captain': True},
                                  {'name': 'Benjamin Francis', 'is_captain': True}]})
check('two officially-marked captains both keep the armband',
      sorted(p['name'] for p in doc['players'] if p['is_captain'])
      == ['Benjamin Francis', 'Jacob Draper'])

# A co-captain the list does NOT mark is still cleared: two is only allowed when
# the entry list says two.
doc = _cap_doc([('ESP', 'Marc Miralles', True, 'fih-team-list'),
                ('ESP', 'Borja Lacalle', True, 'fih-team-list')])
normalize_captaincy(doc, {'ESP': [{'name': 'Marc Miralles', 'is_captain': True},
                                  {'name': 'Borja Lacalle', 'is_captain': False}]})
check('a captain the list does not mark is cleared even beside one it does',
      [p['name'] for p in doc['players'] if p['is_captain']] == ['Marc Miralles'])

# Backstop: with no official list to read, a team keeps one captain — a second
# there has no source behind it.
doc = _cap_doc([('IRL', 'Conor Harte', True, None), ('IRL', 'Kyle Marshall', True, None)])
normalize_captaincy(doc, {})
check('with no list to read, a team keeps one captain',
      sum(1 for p in doc['players'] if p['is_captain']) == 1)

print('\nTwo-stage bracket (real FIH 2026 format)')
import json as _json
import copy as _copy
_fx = _json.load(open(os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'fixtures.json')))
_m = _fx['matches']
check('fixtures total 50 matches', len(_m) == 50, str(len(_m)))
check('24 Stage-1 pool matches', sum(1 for x in _m if x['phase'] == 'pool') == 24)
check('16 Stage-2 group matches', sum(1 for x in _m if x['phase'] == 'stage2') == 16)
check('6 classification matches', sum(1 for x in _m if x['phase'] == 'classification') == 6)
check('2 semis + 2 medals', sum(1 for x in _m if x['phase'] in ('semi-final', 'bronze-final', 'gold-final')) == 4)
# The official schedule, read off the FIH app match by match. Pinned here so a
# future edit cannot quietly renumber or reschedule the knockout stage: every
# one of these 26 was wrong when the seeded guess was first checked against it.
_OFFICIAL = {
    25: ('H', 'FRA', 'RSA', '2026-08-21', '11:00', 'BRU'),
    26: ('H', 'IRL', 'MAS', '2026-08-21', '14:00', 'BRU'),
    28: ('F', 'GER', 'ESP', '2026-08-21', '17:00', 'BRU'),
    27: ('F', 'AUS', 'BEL', '2026-08-21', '20:30', 'BRU'),
    29: ('G', 'NZL', 'WAL', '2026-08-22', '10:00', 'AMV'),
    30: ('G', 'PAK', 'JPN', '2026-08-22', '13:00', 'AMV'),
    31: ('E', 'NED', 'IND', '2026-08-22', '16:00', 'AMV'),
    32: ('E', 'ENG', 'ARG', '2026-08-22', '19:00', 'AMV'),
    33: ('H', 'MAS', 'RSA', '2026-08-23', '11:30', 'BRU'),
    34: ('H', 'FRA', 'IRL', '2026-08-23', '14:30', 'BRU'),
    35: ('F', 'GER', 'AUS', '2026-08-23', '17:30', 'BRU'),
    36: ('F', 'ESP', 'BEL', '2026-08-23', '20:30', 'BRU'),
    37: ('G', 'JPN', 'WAL', '2026-08-24', '09:30', 'AMV'),
    38: ('G', 'NZL', 'PAK', '2026-08-24', '12:30', 'AMV'),
    39: ('E', 'ARG', 'IND', '2026-08-24', '14:45', 'AMV'),
    40: ('E', 'NED', 'ENG', '2026-08-24', '18:00', 'AMV'),
}
_BY_NO = {x['matchNo']: x for x in _m if x.get('matchNo')}
_off_bad = [no for no, exp in _OFFICIAL.items()
            if (_BY_NO[no]['pool'], _BY_NO[no]['home'], _BY_NO[no]['away'],
                _BY_NO[no]['date'], _BY_NO[no]['time'], _BY_NO[no]['venue']) != exp]
check('every Stage-2 fixture matches the official schedule', not _off_bad, f'wrong: {_off_bad}')

# TMS owns these slots, so this table is a snapshot of it and has to be
# refreshed whenever FIH moves a match. The pipeline says so in its own log
# before it writes anything, e.g.
#
#   SCHEDULE: POS7 IND v BEL time 17:00 -> 18:15 (fih-tms)
#
# which is why 46 reads 18:15. The guard is still worth keeping strict: a
# mis-parse silently rewriting a slot is a different thing from FIH moving a
# match, and only the second one belongs here. When this fires, read that log
# line first — if TMS moved it, this table is what is stale.
_SCHEDULE = {41: ('2026-08-28', '09:30', 'AMV'), 42: ('2026-08-28', '11:00', 'BRU'),
             43: ('2026-08-28', '12:30', 'AMV'), 44: ('2026-08-28', '14:00', 'BRU'),
             45: ('2026-08-28', '15:00', 'AMV'), 46: ('2026-08-28', '18:15', 'BRU'),
             47: ('2026-08-28', '18:00', 'AMV'), 48: ('2026-08-28', '20:30', 'BRU'),
             49: ('2026-08-30', '14:00', 'BRU'), 50: ('2026-08-30', '16:30', 'BRU')}
_sch_bad = [no for no, exp in _SCHEDULE.items()
            if (_BY_NO[no]['date'], _BY_NO[no]['time'], _BY_NO[no]['venue']) != exp]
check('classification, semis and medals sit on the official slots', not _sch_bad, f'wrong: {_sch_bad}')

# The corruption of 29 Aug, stated as invariants. A medal match dated before
# the semi-finals that decide who plays in it is not a data error to shrug at,
# it is a result for a match that has not happened — the app showed a world
# champion two days before the final.
_bid = {x['id']: x for x in _m}
_sf_day = max(_bid['SF1']['date'], _bid['SF2']['date'])
for _mid in ('BRZ', 'GOLD'):
    check(f'{_mid} is dated after the semi-finals that feed it',
          _bid[_mid]['date'] > _sf_day, f"{_bid[_mid]['date']} vs semis {_sf_day}")
check('a medal match is only completed once both semi-finals are',
      all(_bid[x]['status'] == 'completed' for x in ('SF1', 'SF2'))
      or all(_bid[x]['status'] != 'completed' for x in ('BRZ', 'GOLD')))
_tms_ids = [x.get('tms_id') for x in _m if x.get('tms_id')]
check('no two fixtures share a TMS id', len(_tms_ids) == len(set(_tms_ids)))

# Probabilities carried by the active pick of any unplayed match stay inside
# (0, 1): the model must never assert a certainty about hockey that has not
# been played. (Spain stood at 100% to win the cup while the final was two
# days away — that number came from the corrupted record, and this line is
# what refuses to publish its like again.)
with open(os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'predictions.json')) as _fh:
    _preds = _json.load(_fh)['predictions']
_undone = {x['id'] for x in _m if x['status'] != 'completed' and x['home'] != 'TBD'}
_bad_p = [p['id'] for p in _preds
          if p['matchId'] in _undone and not p.get('superseded')
          and not (0.0 < max(p['p_home_win'], p['p_away_win']) < 1.0
                   and 0.0 <= p['p_draw'] < 1.0
                   and abs(p['p_home_win'] + p['p_draw'] + p['p_away_win'] - 1.0) < 0.01)]
check('no active pick asserts certainty about an unplayed match', not _bad_p, f'{_bad_p}')
# Only matches that have NOT kicked off: a pick whose match already ran is
# ledger, however flat its model was — the reviser holds the same line.
_now_utc = datetime.now(timezone.utc)
_ko_future = {x['id'] for x in _m
              if x['status'] != 'completed' and x['home'] != 'TBD'
              and x['phase'] not in ('pool', 'stage2')
              and datetime.fromisoformat(f"{x['date']}T{x['time']}:00+02:00") > _now_utc}
_flat = [p['id'] for p in _preds
         if p['matchId'] in _ko_future and not p.get('superseded') and p['p_draw'] == 0.0]
check('future knockout picks carry the regulation draw mass (shoot-out fold)',
      not _flat, f'{_flat}')

# Match numbers must follow the running order within each day: the tournament is
# read by number, so a fixture drifting to another slot is a visible error.
_days = {}
for x in _m:
    if x.get('matchNo'):
        _days.setdefault(x['date'], []).append(x)
_order_bad = []
for _day, _day_fx in _days.items():
    if sorted(_day_fx, key=lambda x: x['time']) != sorted(_day_fx, key=lambda x: (x['time'], x['matchNo'])):
        _order_bad.append(_day)
check('no two fixtures share a slot out of order', not _order_bad, f'{_order_bad}')

# Nobody meets a side from their own Stage-1 pool in Stage 2 — that result is
# carried forward instead, which is the whole point of the crossover.
_s1 = {}
for x in _m:
    if x['phase'] == 'pool':
        _s1[x['home']] = x['pool']; _s1[x['away']] = x['pool']
_clash = [x['matchNo'] for x in _m if x['phase'] == 'stage2'
          and x['home'] != 'TBD' and _s1.get(x['home']) == _s1.get(x['away'])]
check('no Stage-2 fixture repeats a Stage-1 meeting', not _clash, f'{_clash}')

_nos = [x['matchNo'] for x in _m if x.get('matchNo')]
check('knockout match numbers 25–50 unique', sorted(_nos) == list(range(25, 51)))
# No stage-2 fixture pairs two teams from the same Stage-1 pool (those H2H carry
# forward instead), and every Stage-2 pool has exactly four cross matches.
check('every Stage-2 pool has 4 fixtures',
      all(sum(1 for x in _m if x['phase'] == 'stage2' and x['pool'] == p) == 4 for p in 'EFGH'))

# Full progression: complete every stage in turn and confirm the bracket fills
# to a clean 1–16 with no TBD left and medals coming from the semi winners.
_f = _copy.deepcopy(_fx)
# Drive the bracket from a clean slate: reset every knockout slot to TBD so this
# exercises the slotting logic itself, not however far the real tournament has
# progressed. (Once Stage 1 finished for real, the seeded fixtures arrived
# already slotted and the synthetic pool scores below were silently ignored.)
for x in _f['matches']:
    if x['phase'] == 'pool':
        x['status'] = 'completed'; x['score'] = {'home': 3, 'away': 1}
    else:
        x['home'] = x['away'] = 'TBD'
        x['status'] = 'scheduled'; x['score'] = {'home': None, 'away': None}
slot_knockouts(_f)
check('Stage 1 done ⇒ all Stage-2 fixtures slotted',
      all(x['home'] != 'TBD' for x in _f['matches'] if x['phase'] == 'stage2'))
_p1 = stage1_placements(_f)
check('Stage-1 placements resolve all four pools',
      _p1 is not None and all(len(_p1[p]) == 4 for p in 'ABCD'))
_by = {x['id']: x for x in _f['matches']}
_s2e1 = _by['S2E1']
# Official mapping (#31): 1st Pool A meets 2nd Pool D — a crossover, never two
# teams out of the same Stage-1 pool.
check('S2E1 pairs 1st Pool A vs 2nd Pool D per the official schedule',
      (_s2e1['home'], _s2e1['away']) == (_p1['A'][0], _p1['D'][1]),
      f"got {_s2e1['home']} v {_s2e1['away']}")
for x in _f['matches']:
    if x['phase'] == 'stage2':
        x['status'] = 'completed'; x['score'] = {'home': 2, 'away': 1}
slot_knockouts(_f)
check('Stage 2 done ⇒ semis + classification slotted',
      all(x['home'] != 'TBD' for x in _f['matches'] if x['phase'] in ('semi-final', 'classification')))
for x in _f['matches']:
    if x['phase'] == 'semi-final':
        x['status'] = 'completed'; x['score'] = {'home': 3, 'away': 2}
slot_knockouts(_f)
_gold, _sf1, _sf2 = _by['GOLD'], _by['SF1'], _by['SF2']
check('Gold final = the two semi winners',
      {_gold['home'], _gold['away']} == {_sf1['home'], _sf2['home']})
check('no TBD anywhere once every stage is complete',
      all(x['home'] != 'TBD' for x in _f['matches']))

print('\nBrief copy (a reader wants the match, not the machinery)')
import importlib.util as _ilu
_HERE = os.path.dirname(os.path.abspath(__file__))
_spec = _ilu.spec_from_file_location('_stories', os.path.join(_HERE, 'generate_ai_stories.py'))
_stories_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_stories_mod)

# Anything that describes how the text was produced rather than what happened.
PLUMBING = ['hockey.ai engine', 'ledger', 'pipeline', 'the feed', 'generated by',
            'github actions', 'static json', 'api call', 'engine brief', 'reporter runs']

_teams = {
    'NED': {'name': 'Netherlands', 'fih_rank': 2},
    'ARG': {'name': 'Argentina', 'fih_rank': 7},
}
_match = {
    'id': 'T1', 'home': 'NED', 'away': 'ARG', 'phase': 'pool', 'pool': 'A',
    'date': '2026-08-18', 'venue': 'AMV', 'score': {'home': 3, 'away': 1},
    'penalty_corners': {'home': 1, 'away': 4},
    'events': [
        {'type': 'goal', 'minute': 12, 'player': 'Brinkman', 'team': 'NED', 'via': 'FG'},
        {'type': 'yellow_card', 'minute': 40, 'team': 'ARG'},
    ],
}
_brief = _stories_mod.engine_brief(_match, _teams)
_low = _brief.lower()
for _phrase in PLUMBING:
    check(f'a brief never mentions "{_phrase}"', _phrase not in _low, _brief[-120:])
check('a brief still reports the match', 'Netherlands' in _brief and '3-1' in _brief)
# The corners line is gone on purpose: "penalty corners won" is not a number
# the FIH publishes — the old composer was counting corner GOALS and calling
# them corners, which is exactly the invented-statistic the fact gate bans.
# The singular/plural grammar it exercised is now checked where a count is
# still an honest one: the card line.
check('a lone card is singular', '1 yellow card was shown' in _brief,
      _brief.splitlines()[-1])
check('a brief never counts penalty corners won', 'corners' not in _low or 'corner)' in _low,
      _brief.splitlines()[-1])
check('a goal minute is written as a word the gate can read back',
      '12th minute' in _brief, _brief[:160])
# The synthetic above has one goal on the feed against a 3-1 score — a
# partial feed. The composer once narrated it as a one-goal afternoon; now it
# must SAY the feed is partial and make no whole-match claims from it.
check('a partial goal feed is declared, not papered over',
      'details 1 goal of the 4' in _brief, _brief)
check('no whole-match claim is made from a partial feed',
      'whole of the scoring' not in _brief and 'open play' not in _brief
      and 'at half-time' not in _brief, _brief)
# The published-length rule is asked of a brief with a complete feed.
_full = dict(_match, score={'home': 1, 'away': 0},
             events=[e for e in _match['events']])
_fb = _stories_mod.engine_brief(_full, _teams)
check('a complete-feed brief clears its own fact gate',
      len(_fb.split()) >= 120 and _fb.count('\n\n') == 2,
      f"{len(_fb.split())} words, {_fb.count(chr(10)+chr(10)) + 1} paragraphs")
check("a name ending in s takes a bare apostrophe",
      _stories_mod.possessive('Netherlands') == "Netherlands'" and _stories_mod.possessive('Wales') == "Wales'")
check('other names keep the s', _stories_mod.possessive('Germany') == "Germany's")

_missing = dict(_match, events=[])
check('a brief with no scorer feed says so in plain words',
      'has not been published' in _stories_mod.engine_brief(_missing, _teams))
# A genuine 0-0 is not "missing detail" — there is nothing to publish.
_blank = dict(_match, events=[], score={'home': 0, 'away': 0})
check('a goalless draw is reported as one, not as missing data',
      'has not been published' not in _stories_mod.engine_brief(_blank, _teams))

# And the briefs already published must be clean too — the generator changing
# does not rewrite what is already in the file.
with open(os.path.join(_HERE, '..', 'public', 'data', 'ai-stories.json')) as _fh:
    _published = _json.load(_fh)['stories']
_dirty = [s['matchId'] for s in _published
          if any(w in s['story'].lower() for w in PLUMBING)]
check(f'all {len(_published)} published briefs are free of it', not _dirty, ', '.join(_dirty[:6]))
check('published briefs are not empty', all(s['story'].strip() for s in _published))

print()
if failures:
    print(f'{len(failures)} parser check(s) FAILED: {", ".join(failures)}')
    sys.exit(1)
print('All parser checks passed.')
