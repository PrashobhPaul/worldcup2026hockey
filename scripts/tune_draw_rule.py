#!/usr/bin/env python3
"""Does recalibrating the draw rule actually predict better, or only fit better?

The parity-convergence rule says: two sides within `parity_gap` ranking points
of each other, whose gap has closed by at least `convergence_points` since the
baseline table, will draw. The idea is sound — a gap that is *closing* says
something a merely small gap does not — but the published thresholds never fire
on this tournament's points scale, so the rule sits inert.

The tempting move is to widen the threshold until it catches the draws we
missed, then report the improved total. That number would be worthless: it
would have been chosen by looking at the results it is scored against, which is
exactly how the fitted mode reaches 94% and then goes 1-for-3 on matches it has
not seen.

So this measures it the only way that means anything. Walking forward through
the tournament in order, at each match the thresholds are re-chosen using ONLY
the matches already played, and then applied, unseen, to the next one. Every
prediction it scores was made by a rule fitted without knowledge of it. If the
recalibrated rule is genuinely better, the walk-forward number rises. If it only
memorises, the walk-forward number does not move — and the in-sample number
that does move is the lie.

    python3 scripts/tune_draw_rule.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import backtest_model as bt  # noqa: E402
import model_non_knockout as nkm  # noqa: E402

GAPS = list(range(50, 651, 25))
CONVS = list(range(0, 401, 25))
MIN_HISTORY = 12          # too few and the "best" pair is noise


def features():
    """Every completed non-knockout match, in order, with its as-of-then inputs."""
    fixtures = bt.load('fixtures.json')['matches']
    teams = {t['code']: t for t in bt.load('teams.json')['teams']}
    pairs = bt.load('h2h.json')['pairs']
    ranks = bt.Rankings(bt.load('rankings-history.json'))
    done = sorted([m for m in fixtures
                   if m['status'] == 'completed' and m['score']['home'] is not None
                   and m['phase'] in bt.NON_KNOCKOUT_PHASES],
                  key=lambda m: (m['date'], m['time']))
    out = []
    for i, m in enumerate(done):
        when = bt.kickoff_utc(m)
        live = ranks.at(when)
        home, away = m['home'], m['away']
        eff = {}
        for code, opp in ((home, away), (away, home)):
            key = '-'.join(sorted((code, opp)))
            f = {'played': 0, 'wins': 0, 'draws': 0, 'losses': 0, 'gf': 0, 'ga': 0}
            for prev in done[:i]:
                if code not in (prev['home'], prev['away']):
                    continue
                s = 'home' if prev['home'] == code else 'away'
                o = 'away' if s == 'home' else 'home'
                gf, ga = prev['score'][s], prev['score'][o]
                f['played'] += 1; f['gf'] += gf; f['ga'] += ga
                f['wins'] += gf > ga; f['losses'] += gf < ga; f['draws'] += gf == ga
            base = live.get(code, teams[code]['fih_points'])
            eff[code] = base + bt.form_delta(f) + bt.h2h_delta(pairs.get(key), code, opp)
        probs = bt.predict(eff[home], eff[away])
        lh, la = live.get(home), live.get(away)
        fh, fa = ranks.baseline(home, when), ranks.baseline(away, when)
        gap = abs(lh - la) if lh is not None and la is not None else None
        conv = (-(gap - abs(fh - fa)) if gap is not None and fh is not None and fa is not None
                else None)
        h, a = m['score']['home'], m['score']['away']
        out.append({'id': m['id'], 'probs': probs, 'gap': gap, 'conv': conv,
                    'base': nkm.base_pick({'pH': probs[0], 'pD': probs[1], 'pA': probs[2]}),
                    'actual': 'HOME' if h > a else 'AWAY' if a > h else 'DRAW'})
    return out


def pick(row, gap_max, conv_min):
    if (gap_max is not None and row['gap'] is not None and row['conv'] is not None
            and row['gap'] <= gap_max and row['conv'] >= conv_min):
        return 'DRAW'
    return row['base']


def score(rows, gap_max, conv_min):
    return sum(pick(r, gap_max, conv_min) == r['actual'] for r in rows)


def best_on(history):
    """The thresholds that would have scored best on matches already played."""
    best, best_hits = (None, None), score(history, None, None)
    for g in GAPS:
        for c in CONVS:
            h = score(history, g, c)
            if h > best_hits:                 # strictly better, so ties keep "no rule"
                best, best_hits = (g, c), h
    return best


def main():
    rows = features()
    n = len(rows)
    print(f'{n} completed non-knockout matches, in order\n')

    base = score(rows, None, None)
    published = score(rows, nkm.NK['parity_gap'], nkm.NK['convergence_points'])
    print('Scored over the whole tournament (in-sample — every match visible):')
    print(f'  ranking-points base, no draw rule      {base}/{n} = {base / n:.0%}')
    print(f"  published thresholds "
          f"({nkm.NK['parity_gap']}/{nkm.NK['convergence_points']})            {published}/{n} = {published / n:.0%}")
    fitted, fitted_hits = None, base
    for g in GAPS:
        for c in CONVS:
            h = score(rows, g, c)
            if h > fitted_hits:
                fitted, fitted_hits = (g, c), h
    print(f'  best thresholds chosen ON these results {fitted_hits}/{n} = {fitted_hits / n:.0%}  '
          f'<- {fitted} (this is the number that means nothing)')

    print('\nWalk-forward (each match predicted by thresholds fitted only on earlier matches):')
    wf = wf_base = 0
    graded = 0
    chosen = []
    for i in range(MIN_HISTORY, n):
        g, c = best_on(rows[:i])
        chosen.append((g, c))
        wf += pick(rows[i], g, c) == rows[i]['actual']
        wf_base += rows[i]['base'] == rows[i]['actual']
        graded += 1
    print(f'  ranking-points base, no draw rule      {wf_base}/{graded} = {wf_base / graded:.0%}')
    print(f'  thresholds refitted each match         {wf}/{graded} = {wf / graded:.0%}')
    settled = [x for x in chosen if x != (None, None)]
    print(f'  a rule was worth using in {len(settled)} of {graded} rounds'
          + (f'; last choice {chosen[-1]}' if settled else ''))
    verdict = ('the recalibrated rule genuinely predicts better'
               if wf > wf_base else
               'recalibrating the rule does NOT predict better out of sample')
    print(f'\n  -> {verdict}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
