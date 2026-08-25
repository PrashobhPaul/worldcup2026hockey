#!/usr/bin/env python3
"""
Rebuild reference/match-features.json from the model author's feature table.

NON_KNOCKOUT_MODEL_V2 takes its inputs as a dict of pre-kickoff features —
the Live-FIH probabilities, the live ranking-points gap, how far that gap has
converged since the baseline, the favourite's points movement, the underdog's
goal difference and the pre-tournament head-to-head. The author computed all
of those per match and shipped them as router_input_36.json.

The pipeline derives its own versions of the same quantities, but not
identically: the published ranking table is sampled once a day while the FIH
live table moves after every match, and the probabilities come from this
repository's own rating model rather than the author's. Feeding the model
inputs it was not built on makes it a different model wearing the same name.

So the author's table is the source of truth wherever it covers a match, and
this script converts it into the per-id form the replay reads. Matches the
table does not cover keep the pipeline's own derivation.

Rows are stored in the author's orientation with a `flip` flag, because two of
the tournament switches name a side outright and cannot be mirrored by negating
their inputs.

    python3 scripts/build_match_features.py            # write
    python3 scripts/build_match_features.py --check    # report only
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'public', 'data')
REF = os.path.join(HERE, '..', 'reference')
TABLE = os.path.join(REF, 'model_v3', 'router_input_36.json')
OUT = os.path.join(REF, 'match-features.json')

NOTE = (
    "The author's own pre-kickoff inputs, one row per match, converted from "
    "reference/model_v3/router_input_36.json. Every value predates its match: the "
    "Live-FIH distribution, the live ranking-points gap, the convergence of that "
    "gap since the baseline, the favourite's points movement, the underdog's goal "
    "difference to that point and the pre-tournament head-to-head. The replay "
    "prefers these over its own derivation because the model was built and "
    "validated on them — the pipeline samples the ranking table once a day, while "
    "the parity-convergence rule keys off movement after every match."
)


def main():
    check = '--check' in sys.argv
    with open(TABLE) as fh:
        rows = json.load(fh)
    with open(os.path.join(DATA, 'fixtures.json')) as fh:
        fixtures = json.load(fh)['matches']

    # Keyed on the pair of nations, not the match number: the author numbers
    # Stage 2 in a different order from this schedule (their 27 is ESP-GER,
    # ours is AUS-BEL), and only the Stage 2 fixtures carry a number at all.
    # Every pair meets exactly once across the 40 non-knockout fixtures, in
    # both the schedule and the table, so the pair is unambiguous — and the
    # check below fails loudly rather than mis-keying if that ever stops
    # being true.
    non_knockout = [m for m in fixtures if m['phase'] in ('pool', 'stage2')]
    by_pair = {}
    for m in non_knockout:
        by_pair.setdefault(frozenset((m['home'], m['away'])), []).append(m)
    clashes = {tuple(sorted(k)) for k, v in by_pair.items() if len(v) > 1}
    if clashes:
        print('AMBIGUOUS — these nations meet more than once: '
              + ', '.join('-'.join(c) for c in sorted(clashes)))
        return 1

    out, unmatched = {}, []
    for r in rows:
        found = by_pair.get(frozenset((r['home'], r['away'])))
        if not found:
            unmatched.append(f"{r['num']} {r['home']}-{r['away']}")
            continue
        m = found[0]
        # Stored in the AUTHOR'S orientation, with a flag saying whether this
        # schedule lists the fixture the other way round. Two of the
        # tournament rules name a side outright ("-> HOME"), so cannot be made
        # orientation-neutral by negating their inputs: reversing h2h_margin
        # still leaves the rule forcing whichever team this repository happens
        # to call home. The replay therefore evaluates the model exactly as the
        # author framed the match and translates the pick afterwards.
        fav_is_home = r['live_H'] >= r['live_A']
        out[m['id']] = {
            'authorRow': r['num'],
            'flip': m['home'] != r['home'],
            'home': r['home'], 'away': r['away'],
            'pH': r['live_H'], 'pD': r['live_D'], 'pA': r['live_A'],
            'gap': r['lv_pts_gap'],
            'conv': r['conv'],
            'fav_mov': r['mov_h'] if fav_is_home else r['mov_a'],
            'und_gd': r['a_gd'] if fav_is_home else r['h_gd'],
            'h2h_margin': r['h2h_margin'],
            'fav_side': 'HOME' if fav_is_home else 'AWAY',
            'live_pred': r['live'],
        }

    if unmatched:
        print('MISMATCH — table rows with no matching fixture: ' + ', '.join(unmatched))
        return 1
    doc = {'source': 'reference/model_v3/router_input_36.json', 'note': NOTE, 'matches': out}
    if check:
        print(f'{len(out)} match(es) would be written.')
        return 0
    with open(OUT, 'w') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f'reference/match-features.json — {len(out)} matches from the author table')
    return 0


if __name__ == '__main__':
    sys.exit(main())
