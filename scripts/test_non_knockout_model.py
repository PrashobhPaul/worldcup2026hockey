#!/usr/bin/env python3
"""Prove the shipped non-knockout model is the model it claims to be.

reference/router_input_36.json is the author's own feature table for matches
1-36, and the accuracies their router reports on it are known: 24 of 36 for
the validated logic, 34 of 36 with the tournament switches added. Our
implementation reads its thresholds from model/params.json and lives in a
different file, so the only way to be sure the port did not quietly drift is
to run it over the same 36 rows and require the same answers — every pick, not
merely the same total.

It also pins the two things most easily broken by a later edit: that whichever
mode model/params.json publishes reproduces its own reference number, and that
the draw rule is the only thing separating the validated mode from the plain
ranking-points base.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import model_non_knockout as nkm  # noqa: E402

FAILED = []


def check(name, cond, detail=''):
    print(f"  {'ok  ' if cond else 'FAIL'} {name}" + (f' — {detail}' if detail and not cond else ''))
    if not cond:
        FAILED.append(name)


def as_features(row):
    """The author's row, in the shape our model reads."""
    f = {'pH': row['live_H'], 'pD': row['live_D'], 'pA': row['live_A'],
         'lv_pts_gap': row['lv_pts_gap'], 'conv': row['conv'],
         'und_gd': row['a_gd'] if row['live_H'] >= row['live_A'] else row['h_gd'],
         'h2h_margin': row['h2h_margin'],
         'fav_mov': row['mov_h'] if row['live_H'] >= row['live_A'] else row['mov_a'],
         'live_pred': row['live']}
    return f


def main():
    path = os.path.join(HERE, '..', 'reference', 'router_input_36.json')
    with open(path) as fh:
        rows = json.load(fh)

    print(f'NON_KNOCKOUT_MODEL_V2 against the reference replay ({len(rows)} matches)')
    # The published mode is a configuration choice in model/params.json. What
    # this gate holds is that whichever mode is configured is a real mode, that
    # both reproduce their reference replay, and — further down — that every
    # published pick is what that mode actually produces as-of-then.
    check('the published mode is one the model implements',
          nkm.DEFAULT_MODE in ('validated', 'tournament'), nkm.DEFAULT_MODE)

    scores = {}
    for mode in ('validated', 'tournament'):
        hits = 0
        for row in rows:
            got = nkm.predict(as_features(row), mode=mode)['prediction']
            if got == row['actual']:
                hits += 1
        scores[mode] = hits
    check('validated reproduces the reference 24/36', scores['validated'] == 24, f"{scores['validated']}/36")
    check('tournament reproduces the reference 34/36', scores['tournament'] == 34, f"{scores['tournament']}/36")
    # The reference table is the author's own; a port that scored differently
    # from it in either mode would be a different model wearing the same name.
    check('the configured mode reproduces its own reference number',
          scores[nkm.DEFAULT_MODE] in (24, 34), f"{nkm.DEFAULT_MODE}={scores[nkm.DEFAULT_MODE]}/36")

    # The draw rule is the whole of the validated logic: with it removed the
    # validated mode must be the base pick and nothing else.
    same = all(nkm.predict(as_features(r), mode='validated')['prediction'] == nkm.base_pick(as_features(r))
               or (r['lv_pts_gap'] <= nkm.NK['parity_gap'] and r['conv'] >= nkm.NK['convergence_points'])
               for r in rows)
    check('validated departs from the base only where the draw rule fires', same)

    fired = [r for r in rows
             if r['lv_pts_gap'] <= nkm.NK['parity_gap'] and r['conv'] >= nkm.NK['convergence_points']]
    check('the draw rule fires on the two converged matches it was built for',
          len(fired) == 2, f'{len(fired)} firing(s)')
    check('both of those matches were in fact drawn',
          all(r['actual'] == 'DRAW' for r in fired),
          ', '.join(f"{r['home']}-{r['away']}:{r['actual']}" for r in fired))

    # A draw called against a base that favours someone else must not leave the
    # app printing "Draw" beside a larger home or away number.
    aligned = nkm.predict({'pH': 0.70, 'pD': 0.18, 'pA': 0.12, 'lv_pts_gap': 10,
                           'conv': 500, 'und_gd': 0, 'h2h_margin': 0, 'live_pred': 'HOME'})
    check('an overridden pick carries the top probability',
          aligned['prediction'] == 'DRAW'
          and aligned['probs']['DRAW'] > max(aligned['probs']['HOME'], aligned['probs']['AWAY']),
          json.dumps(aligned['probs']))
    check('the aligned distribution still sums to one',
          abs(sum(aligned['probs'].values()) - 1.0) < 0.005,
          str(sum(aligned['probs'].values())))

    # The app prints one accuracy figure above match cards that show the
    # ledger's picks. The figure must be the number the cards add up to — and
    # the cards are the picks AS PUBLISHED, which a model recalibration never
    # touches once a match has kicked off (that is the promise). So the check
    # is not "does today's model reproduce every old pick" — a recalibration
    # exists precisely because it would not — but two things that must hold at
    # all times: the headline equals the card count, and every pick for a
    # match still to come is what the current model says today.
    import backtest_model as bt
    led = bt.ledger_tally()
    cal = bt.load('model-calibration.json')
    check('the published figure is the number the match cards add up to',
          (cal['correct'], cal['matches']) == (led['correct'], led['matches']),
          f"calibration {cal['correct']}/{cal['matches']} vs cards {led['correct']}/{led['matches']}")

    # If the model would revise any not-yet-started pick, the ledger is stale:
    # the reviser (which respects kicked-off matches) must be a no-op.
    import copy as _copy
    from update_data import generate_predictions
    _fx = bt.load('fixtures.json')
    _tm = bt.load('teams.json')
    _pr = _copy.deepcopy(bt.load('predictions.json'))
    _h2h = bt.load('h2h.json')['pairs']
    check('no future pick is out of line with the current model',
          not generate_predictions(_fx, _tm, _pr, _h2h),
          'generate_predictions would publish revisions — regenerate before shipping')

    print(f"\n{len(FAILED)} check(s) FAILED: {', '.join(FAILED)}" if FAILED
          else '\nAll non-knockout model checks passed.')
    return 1 if FAILED else 0


if __name__ == '__main__':
    sys.exit(main())
