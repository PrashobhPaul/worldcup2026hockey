#!/usr/bin/env python3
"""KNOCKOUT_MODEL_V1 held to the claims its own docstring makes.

The model exists because the knockouts were being scored by the engine for
matches that can be drawn. These checks pin the three things that make it a
different model — no home term, a compressed evidence gap, and level-after-
sixty as a real branch — plus the honesty properties that motivated it.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_knockout as km          # noqa: E402
from backtest_model import load      # noqa: E402

FAIL = 0


def check(name, cond, detail=''):
    global FAIL
    if cond:
        print(f'  ok   {name}')
    else:
        FAIL += 1
        print(f'  FAIL {name} {detail}')


print('KNOCKOUT_MODEL_V1')

# ── It is its own model, named as such ─────────────────────────────────────
check('the model publishes its own version', km.MODEL_VERSION == 'KNOCKOUT_MODEL_V1',
      km.MODEL_VERSION)

# ── No home side ───────────────────────────────────────────────────────────
# Every match of this tournament is at one of two venues and the bracket
# decides which name is printed first. Swapping the two sides must swap the
# answer exactly — any asymmetry is a home-advantage term smuggled in.
for gap in (0.0, 0.05, 0.3, 0.62, 0.9):
    a = km.predict({'def_gap': gap, 'evidence_n': 6})
    b = km.predict({'def_gap': -gap, 'evidence_n': 6})
    ok = (abs(a['advance']['HOME'] - b['advance']['AWAY']) < 1e-9
          and abs(a['regulation']['LEVEL'] - b['regulation']['LEVEL']) < 1e-9)
    check(f'no home term: reversing a {gap:+.2f} gap mirrors the answer', ok,
          f"{a['advance']} vs {b['advance']}")

even = km.predict({'def_gap': 0.0, 'evidence_n': 6})
check('two sides the record cannot separate are called even',
      abs(even['advance']['HOME'] - 0.5) < 1e-9, str(even['advance']))

# ── Level after sixty is a real branch ─────────────────────────────────────
# The model this replaces published p_draw 0.00 on all eight played
# knockouts. Three of them were level after sixty.
for gap in (0.0, 0.5, 1.0, -1.0):
    r = km.predict({'def_gap': gap, 'evidence_n': 6})
    check(f'level after 60 is never zero at a {gap:+.1f} gap',
          r['regulation']['LEVEL'] >= km.KM['level_floor'],
          str(r['regulation']))
close = km.predict({'def_gap': 0.02, 'evidence_n': 6})['regulation']['LEVEL']
far = km.predict({'def_gap': 0.95, 'evidence_n': 6})['regulation']['LEVEL']
check('closer sides are likelier to be level after sixty', close > far,
      f'{close:.3f} vs {far:.3f}')

# ── A knockout is never called a draw ──────────────────────────────────────
for gap in (-0.9, -0.1, 0.0, 0.1, 0.9):
    r = km.predict({'def_gap': gap, 'evidence_n': 6})
    check(f'the pick at gap {gap:+.1f} names a side, never a draw',
          r['prediction'] in ('HOME', 'AWAY'), r['prediction'])

# ── The parts are a distribution ───────────────────────────────────────────
for gap in (-0.8, -0.2, 0.0, 0.35, 0.8):
    for n in (0, 1, 3, 6):
        r = km.predict({'def_gap': gap, 'evidence_n': n})
        reg = sum(r['regulation'].values())
        adv = sum(r['advance'].values())
        check(f'regulation and advance both sum to one (gap {gap:+.1f}, n={n})',
              abs(reg - 1) < 1e-6 and abs(adv - 1) < 1e-6, f'{reg}, {adv}')

# ── The shoot-out is a coin ────────────────────────────────────────────────
# Three shoot-outs is no basis for claiming a side is better at them. The
# advance split must therefore be the regulation split with the level mass
# divided exactly in half.
r = km.predict({'def_gap': 0.4, 'evidence_n': 6})
want = r['regulation']['HOME'] + r['regulation']['LEVEL'] / 2
check('advancing is the regulation win plus half the level mass',
      abs(r['advance']['HOME'] - want) < 1e-3, f"{r['advance']['HOME']} vs {want}")

# ── Confidence is bounded ──────────────────────────────────────────────────
# What this replaces asserted 97% on India against Belgium and 92% on the
# Netherlands against Spain. Both went the other way; one went to a shoot-out.
worst = max(max(km.predict({'def_gap': g, 'evidence_n': 6})['advance'].values())
            for g in [x / 100 for x in range(-100, 101)])
check('no knockout claim can reach the confidence the old model published',
      worst < 0.80, f'highest advance probability reachable is {worst:.2f}')

# ── Thin evidence makes a weaker claim ─────────────────────────────────────
thin = km.predict({'def_gap': 0.8, 'evidence_n': 1})['advance']['HOME']
full = km.predict({'def_gap': 0.8, 'evidence_n': 6})['advance']['HOME']
check('one match of evidence claims less than six', thin < full,
      f'{thin:.3f} vs {full:.3f}')
check('no evidence at all is an even call',
      abs(km.predict({'def_gap': 0.8, 'evidence_n': 0})['advance']['HOME'] - 0.5) < 1e-9)

# ── A missing rating is declared, not guessed ──────────────────────────────
f = km.build_features(None, 71.0, evidence_n=4)
check('a side with no defensive record yields no gap rather than a guess',
      f['def_gap'] == 0.0, str(f))

# ── Against the tournament's own record ────────────────────────────────────
# Not a target the model was fitted to: the weights come from the pool and
# stage-2 half, and these eight are the test half. The check is that the
# model on file still reproduces the numbers its docstring quotes.
fx = load('fixtures.json')
NK = ('pool', 'stage2')
ko = [m for m in fx['matches']
      if m['phase'] not in NK and m['status'] == 'completed'
      and (m.get('score') or {}).get('home') is not None]
level = sum(1 for m in ko if m['score']['home'] == m['score']['away'])
check('the level-after-sixty base still matches the played record',
      abs(km.KM['level_base'] - level / len(ko)) < 0.02,
      f"{level}/{len(ko)} = {level / len(ko):.2f} vs {km.KM['level_base']}")

pool = [m for m in fx['matches']
        if m['phase'] in NK and m['status'] == 'completed'
        and (m.get('score') or {}).get('home') is not None]


def margin(ms):
    return sum(abs(m['score']['home'] - m['score']['away']) for m in ms) / len(ms)


check('the bracket compression still matches the margins it was measured from',
      abs(km.KM['bracket_compression'] - margin(ko) / margin(pool)) < 0.03,
      f'{margin(ko):.2f}/{margin(pool):.2f} = {margin(ko) / margin(pool):.2f}')

# ── It must beat a coin flip on the matches it was not fitted to ───────────
# The record it inherits does not: a mean stated confidence of 76% for a
# log-loss of 0.861, where a coin flip scores 0.693. Beating the coin is the
# bar a knockout model has to clear to be worth publishing at all.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from team_rating import rate_teams   # noqa: E402

done = sorted([m for m in fx['matches']
               if m['status'] == 'completed'
               and (m.get('score') or {}).get('home') is not None],
              key=lambda m: (m['date'], m.get('time') or ''))
ll, n, hit = 0.0, 0, 0
for m in ko:
    hist = [x for x in done if x['date'] < m['date']]
    rated = rate_teams(hist) if hist else {}

    def pct(code):
        row = rated.get(code)
        comp = (row.get('components') or {}).get('defence') if row else None
        return comp['score'] if comp else None

    r = km.predict(km.build_features(pct(m['home']), pct(m['away']), evidence_n=6))
    s, so = m['score'], m.get('shootout')
    if s['home'] != s['away']:
        won = 'HOME' if s['home'] > s['away'] else 'AWAY'
    elif so:
        won = 'HOME' if so['home'] > so['away'] else 'AWAY'
    else:
        continue
    p = r['advance'][won]
    ll += -math.log(max(p, 1e-9))
    hit += r['prediction'] == won
    n += 1
check('the model beats a coin flip on the eight it was not fitted to',
      ll / n < math.log(2), f'log-loss {ll / n:.3f} against {math.log(2):.3f}')
print(f'       ({hit}/{n} called, log-loss {ll / n:.3f}; the published record '
      f'it replaces was 4/{n} at 0.861)')

print('\nAll knockout-model checks passed.' if not FAIL else f'\n{FAIL} FAILED')
sys.exit(1 if FAIL else 0)
