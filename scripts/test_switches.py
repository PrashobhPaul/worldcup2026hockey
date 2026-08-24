#!/usr/bin/env python3
"""Does any of the five fitted switches actually generalise?

The tournament mode reaches its high score by applying five rules on top of
the base. They were derived from the outcomes of the matches they are scored
against, so their in-sample record proves nothing. But "fitted as a set" does
not mean "all five are worthless" — one of them might be catching a real
effect that happens to have been discovered by fitting. Dismissing them
wholesale without testing would be as lazy as accepting them wholesale.

So each switch is tested on its own, two ways:

  when it fires    how often the pick it forces beats the pick it replaced.
                   Still in-sample, but it shows whether a switch even helps
                   on the data it was built from, or only breaks even.

  walk-forward     the honest one. Going through the tournament in order, a
                   switch is enabled for the next match only if it has helped
                   on the matches already played. Every prediction it scores
                   was made by a rule that had not seen it.

A switch that earns its place shows a walk-forward gain. One that does not is
memorising, whatever its in-sample record says.

    python3 scripts/test_switches.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import backtest_model as bt  # noqa: E402
import model_non_knockout as nkm  # noqa: E402

MIN_HISTORY = 12


def switches():
    t = nkm.NK['tournament_mode']
    lo, hi = t['gap_band']
    return {
        'favourite-surge -> draw':
            lambda f: 'DRAW' if f.get('fav_mov') is not None and f['fav_mov'] > t['favourite_surge_points'] else None,
        'base=draw & diverged -> favourite':
            lambda f: f['fav_side'] if f['base'] == 'DRAW' and f.get('conv') is not None and f['conv'] < 0 else None,
        'head-to-head <= -2 -> home':
            lambda f: 'HOME' if f.get('h2h_margin') is not None and f['h2h_margin'] <= t['h2h_margin_max'] else None,
        f'gap {lo}-{hi} -> underdog':
            lambda f: ('AWAY' if f['fav_side'] == 'HOME' else 'HOME') if f.get('gap') is not None and lo <= f['gap'] <= hi else None,
        'underdog goal diff <= -9 -> draw':
            lambda f: 'DRAW' if f.get('und_gd') is not None and f['und_gd'] <= t['underdog_gd_max'] else None,
    }


def dataset():
    rows, _ = bt.replay('validated')
    mf = json.load(open(os.path.join(HERE, '..', 'reference', 'match-features.json')))['matches']
    out = []
    for r in rows:
        f = mf.get(r['id'])
        if not f:
            continue
        out.append({**f, 'id': r['id'], 'base': r['pick'], 'actual': r['actual']})
    return out


def main():
    data = dataset()
    print(f'{len(data)} matches with the full feature set\n')
    base_hits = sum(d['base'] == d['actual'] for d in data)
    print(f'base (your validated model): {base_hits}/{len(data)}\n')

    print(f"{'switch':36} {'fires':>6} {'base ok':>8} {'switched ok':>12} {'in-sample':>10} {'walk-fwd':>9}")
    for name, fn in switches().items():
        fires = [d for d in data if fn(d) is not None]
        b = sum(d['base'] == d['actual'] for d in fires)
        s = sum(fn(d) == d['actual'] for d in fires)

        wf_on = wf_off = 0
        for i in range(MIN_HISTORY, len(data)):
            hist = [d for d in data[:i] if fn(d) is not None]
            helped = sum(fn(d) == d['actual'] for d in hist) > sum(d['base'] == d['actual'] for d in hist)
            d = data[i]
            forced = fn(d)
            pick = forced if (helped and forced) else d['base']
            wf_on += pick == d['actual']
            wf_off += d['base'] == d['actual']
        graded = len(data) - MIN_HISTORY
        print(f'{name:36} {len(fires):>6} {b:>8} {s:>12} {s - b:>+10} {wf_on - wf_off:>+9}')

    print(f'\n(in-sample and walk-forward columns are the change in correct picks; '
          f'walk-forward is over the last {len(data) - MIN_HISTORY} matches)')

    # All five together, walk-forward, each enabled independently on its record.
    fns = switches()
    wf_on = wf_off = 0
    for i in range(MIN_HISTORY, len(data)):
        d = data[i]
        pick = d['base']
        for name, fn in fns.items():
            hist = [x for x in data[:i] if fn(x) is not None]
            helped = hist and sum(fn(x) == x['actual'] for x in hist) > sum(x['base'] == x['actual'] for x in hist)
            forced = fn(d)
            if helped and forced:
                pick = forced
        wf_on += pick == d['actual']
        wf_off += d['base'] == d['actual']
    print(f'\nall five, walk-forward: {wf_on}/{len(data) - MIN_HISTORY} '
          f'vs base {wf_off}/{len(data) - MIN_HISTORY}  ({wf_on - wf_off:+d})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
