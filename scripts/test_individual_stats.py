"""
Hockey.AI — the FIH's individual statistics, and what this app says instead.

Two things are checked here, and they are different things.

The parsers: the competition scorers and cards reports are read from their own
text, and a report that does not reconcile against its own Totals row must be
refused rather than half-read. The cards report is the harder of the two — an
empty cell leaves no trace in extracted text, so "KEENAN Nicolas 1" carries no
statement of colour, and the column has to come from where the digit sits.

The record: every player figure this app publishes has to add up. A goal is a
field goal, a penalty corner or a stroke, and nothing else, so the three must
sum to the total for every player — the split is what several surfaces read to
say "three field goals", and one that does not add up makes them all wrong.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import individual_stats as stats                                  # noqa: E402

FIX = os.path.join(HERE, 'fixtures')
DATA = os.path.join(os.path.dirname(HERE), 'public', 'data')

failed = 0


def check(name, ok, detail=''):
    global failed
    if ok:
        print('  ok  ', name)
    else:
        failed += 1
        print('  FAIL', name, detail)


def lines(name):
    with open(os.path.join(FIX, name), encoding='utf-8') as fh:
        return fh.read().split('\n')


# ── The scorers report ────────────────────────────────────────────────────
print('Competition scorers report')
rows = stats.parse_scorers(lines('scorers.txt'))
check('the report reads', rows is not None)
if rows:
    check('every scorer is read', len(rows) == 104, f'{len(rows)} rows')
    check('the split adds up for every scorer',
          all(r['fg'] + r['pc'] + r['ps'] == r['goals'] for r in rows))
    check('a one-word name is read whole',
          any(r['name'] == 'Sanjay' and r['pc'] == 1 for r in rows))
    check('a lowercase particle is read whole',
          any(r['name'] == 'van DOREN Arthur (C)' for r in rows))
    check('the captain marker does not become a name',
          all('(C)' not in r['name'].replace('(C)', '') for r in rows))

# A report whose rows do not reconcile with its own totals is refused whole.
broken = [l.replace('Totals 114 76 11 201', 'Totals 114 76 11 200') for l in lines('scorers.txt')]
check('a report that disagrees with its own totals is refused',
      stats.parse_scorers(broken) is None)
check('a report with no totals row is refused',
      stats.parse_scorers([l for l in lines('scorers.txt') if not l.startswith('Totals')]) is None)


# ── The cards report ──────────────────────────────────────────────────────
# Laid out as the report lays it out: three narrow columns at fixed x, and an
# empty cell that leaves nothing behind. The point of the test is that a lone
# digit is coloured by where it sits and not by what it is.
print('Competition cards report')


def row(text, xs):
    return [(t, x, x + 6 * len(t)) for t, x in zip(text.split('|'), xs)]


table = [
    row('Team|Shirt #|Name|Red|Yellow|Green', [40, 80, 140, 400, 440, 490]),
    row('ARG|7|KEENAN Nicolas|1', [40, 80, 140, 492]),        # green only
    row('WAL|3|KYRIAKIDES Daniel|1|1', [40, 80, 140, 442, 492]),  # yellow + green
    row('PAK|5|KHAN Sufyan|1|2', [40, 80, 140, 442, 492]),
    row('AUS|19|MARAIS Craig|2', [40, 80, 140, 442]),         # yellow only
    row('Totals|0|4|4', [40, 402, 442, 492]),
]
read = stats.parse_cards(table)
check('the report reads', read is not None)
if read:
    by = {(r['team'], r['number']): r for r in read}
    check('a lone digit under Green is a green card',
          by[('ARG', 7)] == {'team': 'ARG', 'number': 7, 'name': 'KEENAN Nicolas',
                             'red': 0, 'yellow': 0, 'green': 1}, by[('ARG', 7)])
    check('a lone digit under Yellow is a yellow card',
          (by[('AUS', 19)]['yellow'], by[('AUS', 19)]['green']) == (2, 0),
          by[('AUS', 19)])
    check('two digits fill the two columns they sit under',
          (by[('PAK', 5)]['yellow'], by[('PAK', 5)]['green']) == (1, 2), by[('PAK', 5)])
    check('the shirt number never lands in a card column',
          all(r['red'] + r['yellow'] + r['green'] <= 3 for r in read))

wrong = [r for r in table]
wrong[-1] = row('Totals|0|9|4', [40, 402, 442, 492])
check('a card report that disagrees with its own totals is refused',
      stats.parse_cards(wrong) is None)
check('a card report with no colour header is refused',
      stats.parse_cards(table[1:]) is None)


# ── The published record ──────────────────────────────────────────────────
print('Published player figures')
with open(os.path.join(DATA, 'players.json'), encoding='utf-8') as fh:
    players = json.load(fh)['players']

split = [p for p in players if p.get('fg_scored') is not None]
check('every player carries the goal split', len(split) == len(players),
      f'{len(players) - len(split)} without one')
bad = [p['name'] for p in split
       if (p['fg_scored'] + (p.get('pc_scored') or 0) + (p.get('ps_scored') or 0)
           != (p.get('goals') or 0))]
check('field + corner + stroke is the goal total for every player',
      not bad, ', '.join(bad[:5]))
check('no split figure is negative',
      all(min(p['fg_scored'], p.get('pc_scored') or 0, p.get('ps_scored') or 0) >= 0
          for p in split))

# The event ledger is where the split comes from, so the two must agree.
with open(os.path.join(DATA, 'fixtures.json'), encoding='utf-8') as fh:
    matches = json.load(fh)['matches']
ledger = {'FG': 0, 'PC': 0, 'PS': 0}
for m in matches:
    for e in m.get('events') or []:
        if e.get('type') == 'goal' and e.get('via') in ledger:
            ledger[e['via']] += 1
published = (sum(p['fg_scored'] for p in split),
             sum(p.get('pc_scored') or 0 for p in split),
             sum(p.get('ps_scored') or 0 for p in split))
check('the published split is the ledger it was built from',
      published == (ledger['FG'], ledger['PC'], ledger['PS']),
      f"published {published}, ledger {tuple(ledger.values())}")

# Appearances are counted from the official team sheets, and everything the
# rating does with a per-match rate depends on them. They were published a
# whole run behind the sheets they come from — the pipeline derived them
# before it fetched them — and nothing noticed, because a figure that is too
# low still looks like a figure. This recounts them from the sheets.
sheets = {}
for m in matches:
    lineups = m.get('lineups') or {}
    if lineups.get('source') != 'official':
        continue
    for side in ('home', 'away'):
        block = lineups.get(side) or {}
        for row in block.get('startingXI', []):
            r = sheets.setdefault((m[side], row['name']), [0, 0])
            r[0] += 1
            r[1] += 1
        for row in block.get('substitutes', []):
            if row.get('on_minute') is not None:
                sheets.setdefault((m[side], row['name']), [0, 0])[1] += 1

lagging = []
for p in players:
    counted = sheets.get((p['team'], p['name']))
    if counted is None:
        continue
    if (p.get('starts'), p.get('appearances')) != tuple(counted):
        lagging.append(f"{p['name']}: published {p.get('starts')}/{p.get('appearances')}, "
                       f'sheets say {counted[0]}/{counted[1]}')
check('published starts and appearances are the ones on the official sheets',
      not lagging, '; '.join(lagging[:4]))
check('nobody starts a match he did not appear in',
      all((p.get('starts') or 0) <= (p.get('appearances') or 0) for p in players))

# The pipeline records its own reconciliation against the FIH tables. It is
# allowed to be absent — the reports are fetched in CI, not here — but it is
# not allowed to be present and unhappy.
with open(os.path.join(DATA, 'players.json'), encoding='utf-8') as fh:
    doc = json.load(fh)
audit = doc.get('official_figures_check')
if audit:
    check('the last check against the FIH tables found no disagreement',
          not audit.get('disagreements'),
          '; '.join(audit.get('disagreements', [])[:3]))
    print(f"  ..   {audit.get('players_checked')} figures checked "
          f"{audit.get('checked_at', '')[:10]} against {', '.join(audit.get('reports', []))}")
else:
    print('  ..   no reconciliation recorded yet — the reports are read in CI.')

print('FAILED' if failed else 'All individual-statistics checks passed.')
sys.exit(1 if failed else 0)
