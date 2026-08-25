#!/usr/bin/env python3
"""
Make every published pick agree with its own numbers.

A prediction row says three things: which outcome it picks, how likely it
thinks each outcome is, and how confident it is in the pick. Those have to be
the same claim. Ten of the forty-eight active rows were not:

    S2E3  pick "India to win"   ·  ARG 70%  Draw 17%  IND 13%  ·  ring: 70%

Two causes, both fixed at source. `_aligned` in model_non_knockout.py moved
the distribution to follow the pick only when the pick was DRAW, because the
draw rule was once the only rule that overrode the base; the tournament rules
override to HOME and AWAY as well. And `pick_confidence` was written as the
largest probability in the row rather than the probability of the pick, which
are the same number only when the pick already leads.

This repairs what was published under the old behaviour. The ledger is
append-only, so nothing is rewritten: each incoherent row is superseded and a
corrected row appended beside it, carrying the SAME pick and the SAME
rationale — the pick was never the thing in doubt, only the numbers printed
next to it.

Idempotent: a second run finds nothing to do.

    python3 scripts/repair_pick_coherence.py            # apply
    python3 scripts/repair_pick_coherence.py --check    # report, change nothing
"""
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'public', 'data')
sys.path.insert(0, HERE)
import model_non_knockout as nkm            # noqa: E402

ORDER = ('HOME', 'DRAW', 'AWAY')
FIELDS = {'HOME': 'p_home_win', 'DRAW': 'p_draw', 'AWAY': 'p_away_win'}
TOL = 0.0015


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def probs_of(row):
    return tuple(row.get(FIELDS[k]) for k in ORDER)


def incoherent(row):
    """(leads, confidence) — which of the two promises this row breaks."""
    p = probs_of(row)
    if any(v is None for v in p):
        return None
    top = ORDER[p.index(max(p))]
    conf = row.get('pick_confidence')
    pick_p = p[ORDER.index(row['pick'])] if row['pick'] in ORDER else None
    return (row['pick'] != top,
            conf is not None and pick_p is not None and abs(conf - pick_p) > TOL)


def main():
    check = '--check' in sys.argv
    preds = load('predictions.json')
    fixtures = {m['id']: m for m in load('fixtures.json')['matches']}
    now = datetime.now(timezone.utc).isoformat()

    broken = []
    for row in preds['predictions']:
        if row.get('superseded'):
            continue
        flags = incoherent(row)
        if flags and any(flags):
            broken.append((row, flags))

    if not broken:
        print('Every published pick already agrees with its own numbers.')
        return 0

    print(f'{len(broken)} row(s) to repair:')
    for row, (lead, conf) in broken:
        p = probs_of(row)
        why = ', '.join(w for w, on in (('pick does not lead', lead),
                                        ('confidence is not the pick', conf)) if on)
        print(f"  {row['matchId']:6s} pick={row['pick']:5s} "
              f"H{p[0]} D{p[1]} A{p[2]} conf={row.get('pick_confidence')}  ({why})")
    if check:
        print('(--check: nothing written)')
        return 0

    for row, _ in broken:
        m = fixtures.get(row['matchId']) or {}
        pick = row['pick']
        ph, pd, pa = nkm._aligned(probs_of(row), pick)
        row['superseded'] = True
        row['superseded_at'] = now
        row['superseded_reason'] = (
            'the distribution printed beside this pick did not support it; '
            'reissued with the same pick and the same rationale')
        new = dict(row)
        for k in ('superseded', 'superseded_at', 'superseded_reason'):
            new.pop(k, None)
        new.update({
            'id': f"coherent:{row['id']}",
            'revises': row['id'],
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick_confidence': round({'HOME': ph, 'DRAW': pd, 'AWAY': pa}[pick], 3),
            'pick_team': (m.get('home') if pick == 'HOME' else
                          m.get('away') if pick == 'AWAY' else None),
            'publishedAt': row.get('publishedAt'),   # the pick's own time stands
            'reissued_at': now,
        })
        if m.get('home') in (None, 'TBD'):
            new.pop('pick_team', None)
        preds['predictions'].append(new)

    with open(os.path.join(DATA, 'predictions.json'), 'w') as fh:
        json.dump(preds, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    version['updated_at'] = now
    with open(os.path.join(DATA, 'data-version.json'), 'w') as fh:
        json.dump(version, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    from data_fingerprint import stamp
    stamp()
    print(f"{len(broken)} row(s) reissued, data-version -> {version['version']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
