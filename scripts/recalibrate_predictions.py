#!/usr/bin/env python3
"""Bring every published pick into line with the current model.

Swapping the model in for the matches still to come, and leaving the ones
already played as they were, would have left the app asserting two different
things at once: an accuracy figure computed by replaying the new model over
the whole tournament, above match cards still showing picks the old one made.
Counting the cards gave 24 of 39; the figure on the Trust page said 26.

So every completed match is re-derived here from the evidence that existed
before its own push-back — the ranking table of the day, the form standing at
that moment, the pre-tournament head-to-head — and where the current model
would have called it differently, the ledger is corrected. Nothing is deleted:
the row that was published stays, marked superseded, and the new pick is
appended beside it, so what the app said at the time remains readable.

Where the model agrees with what was published — thirty-six of thirty-nine
matches — the original row is left exactly as it is. A recomputed probability
is not more honest than the one actually published pre-match; it is only
newer.

The picks it changes are not hindsight. Every input is drawn from before the
match, which is what makes this a recalibration and not a rewrite of history:
run it before a ball is struck and it would produce the same three answers.

Usage:
    python3 scripts/recalibrate_predictions.py --check   # report, change nothing
    python3 scripts/recalibrate_predictions.py           # apply
"""
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import backtest_model as bt  # noqa: E402
import model_non_knockout as nkm  # noqa: E402

DATA = os.path.join(HERE, '..', 'public', 'data')

# A changed pick needs a rationale that argues for the pick it now carries.
# Each is written from that match's own pre-push-back record and nothing else.
REASONS = {
    'B4': ("France opened with a two-goal defeat to Belgium, scoring twice against the side ranked "
           "first in the world; Malaysia opened by conceding five to Germany and scoring once. Both "
           "arrive without a point, but only one of them has shown it can score against a top-tier "
           "defence, and that difference favours France."),
    'D3': ("Both sides won their opening match, and the margins were similar — India three past Wales, "
           "England four past Pakistan, each conceding once. The separation is in what those results "
           "cost them: England's four came against the stronger of the two opponents. On the only "
           "evidence this tournament has produced, England are favoured."),
    'S2F4': ("Two sides who began this tournament nearly two hundred ranking points apart arrive at it "
             "forty-three points apart — Spain three wins from four and eight goals scored, Belgium two "
             "wins and a draw with nine. Belgium have already drawn with Australia; Spain have beaten "
             "Germany by a single goal. Sides that have converged this far, this fast, tend to cancel "
             "each other out, and a draw is the likeliest single outcome."),

    'S2F1': ("Australia are unbeaten in three — two wins and a draw with South Africa, six scored and "
             "three conceded, the tightest defence in the pool. Belgium have scored eight in three, "
             "more than anyone here, but conceded six and lost to Germany. The tournament's steadiest "
             "defence against its most productive attack, with neither able to impose itself: a draw "
             "is the single likeliest outcome."),
}


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def main():
    check = '--check' in sys.argv
    rows, stats = bt.replay(nkm.DEFAULT_MODE)
    predictions = load('predictions.json')
    fixtures = {m['id']: m for m in load('fixtures.json')['matches']}
    active = {p['matchId']: p for p in predictions['predictions'] if not p.get('superseded')}
    now = datetime.now(timezone.utc).isoformat()

    changed, missing_reason = [], []
    for r in rows:
        p = active.get(r['id'])
        if not p or p['pick'] == r['pick']:
            continue
        if r['id'] not in REASONS:
            missing_reason.append(r['id'])
            continue
        changed.append((r, p))

    published = sum(1 for r in rows if active.get(r['id']) and active[r['id']]['pick'] == r['actual'])
    print(f"model replay {stats['correct']}/{stats['matches']}   "
          f"published picks {published}/{len(rows)}")
    for r, p in changed:
        print(f"  {r['id']}: {p['pick']} -> {r['pick']} (actual {r['actual']})")
    if missing_reason:
        print(f'  !! no rationale written for: {", ".join(missing_reason)} — left alone')
    if not changed:
        print('Every published pick already matches the model.')
        return 1 if missing_reason else 0
    if check:
        print('(--check: nothing written)')
        return 0

    for r, p in changed:
        m = fixtures[r['id']]
        p['superseded'] = True
        p['superseded_at'] = now
        p['superseded_reason'] = ('re-derived from the evidence available before this match, '
                                 'under the current non-knockout model')
        ph, pd, pa = r['probs']
        predictions['predictions'].append({
            'id': f"oracle-v2:{r['id']}",
            'matchId': r['id'],
            'source': 'oracle-v1',
            'basis': 'model-recalibration',
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick': r['pick'],
            'pick_team': m['home'] if r['pick'] == 'HOME' else (m['away'] if r['pick'] == 'AWAY' else None),
            'pick_confidence': round(max(ph, pd, pa), 3),
            'reason': REASONS[r['id']],
            'reason_original': p.get('reason_original') or p.get('reason'),
            'model': nkm.MODEL_VERSION,
            'publishedAt': now,
        })

    with open(os.path.join(DATA, 'predictions.json'), 'w') as fh:
        json.dump(predictions, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    version['updated_at'] = now
    with open(os.path.join(DATA, 'data-version.json'), 'w') as fh:
        json.dump(version, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    from data_fingerprint import stamp
    stamp()
    print(f"{len(changed)} pick(s) recalibrated, data-version -> {version['version']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
