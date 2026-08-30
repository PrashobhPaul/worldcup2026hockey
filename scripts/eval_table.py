#!/usr/bin/env python3
"""
Hockey.AI — the evaluation table: the model, a language model, and what happened.

Three columns for the same fifty questions. The app's picks come from the
statistical model; the language-model column comes from scripts/llm_backtest.py,
which is asked the same question from the same pre-match evidence; the third is
the record.

Everything here is recomputed from the committed data on every run, so a reader
who clones the repository regenerates the table rather than trusting it — with
a key of their own, or with none, in which case the language-model column reads
"not run" and the rest still stands.

Accuracy alone flatters a forecaster: a pick at 97% and one at 51% both count
once. The Brier score is printed beside it because it does not.

Run: python3 scripts/eval_table.py [--write]
"""
import argparse
import json
import os
import sys

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')
DOC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'docs', 'EVALUATION.md')
STAGES = (('stage1', 'Stage 1'), ('stage2', 'Stage 2'), ('knockout', 'Knockouts'))


def load(name, default=None):
    p = os.path.join(DATA, name)
    if not os.path.exists(p):
        return default
    with open(p) as fh:
        return json.load(fh)


def stage_of(phase):
    return 'stage1' if phase == 'pool' else 'stage2' if phase == 'stage2' else 'knockout'


def actual(m):
    """Who won. A drawn knockout is settled by its shoot-out, never left a draw."""
    h, a = m['score']['home'], m['score']['away']
    if h != a:
        return 'HOME' if h > a else 'AWAY'
    if stage_of(m['phase']) != 'knockout':
        return 'DRAW'
    so = m.get('shootout') or {}
    if so.get('home') is None or so['home'] == so.get('away'):
        return None
    return 'HOME' if so['home'] > so['away'] else 'AWAY'


def model_pick(row, m):
    """The published pick, folded the way the app folds it."""
    if row.get('p_home_win') is None:
        return None, None
    h, d, a = row['p_home_win'], row.get('p_draw') or 0, row['p_away_win']
    if stage_of(m['phase']) == 'knockout':
        adv = h + d / 2
        return ('HOME', adv) if adv >= 0.5 else ('AWAY', 1 - adv)
    pick = row.get('pick') or max((('HOME', h), ('DRAW', d), ('AWAY', a)), key=lambda kv: kv[1])[0]
    return pick, {'HOME': h, 'DRAW': d, 'AWAY': a}.get(pick)


def score(rows):
    """(called, graded, accuracy, Brier-on-the-pick).

    This is the BINARY Brier: the squared error of the confidence attached to
    the one outcome named, against whether that outcome happened. It is not the
    figure the app publishes on its calibration — that one is the three-way
    Brier over (home, draw, away), and the two are different measures of
    different things. A language model returns a pick and a confidence, not a
    distribution over three outcomes, so the binary form is the only one both
    columns can be scored on. Both are named wherever they appear.
    """
    graded = [r for r in rows if r['truth'] and r['pick']]
    hit = [r for r in graded if r['pick'] == r['truth']]
    brier = None
    conf = [r for r in graded if r.get('confidence') is not None]
    if conf:
        brier = sum((r['confidence'] - (1 if r['pick'] == r['truth'] else 0)) ** 2
                    for r in conf) / len(conf)
    return len(hit), len(graded), (len(hit) / len(graded) if graded else None), brier


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='write docs/EVALUATION.md')
    args = ap.parse_args()

    fixtures = load('fixtures.json')['matches']
    preds = [p for p in load('predictions.json')['predictions'] if not p.get('superseded')]
    by_pred = {p['matchId']: p for p in preds}
    llm = load('llm-backtest.json')
    by_llm = {r['matchId']: r for r in (llm or {}).get('picks', [])}

    done = sorted((m for m in fixtures
                   if m['status'] == 'completed' and (m.get('score') or {}).get('home') is not None),
                  key=lambda m: (m['date'], m['time']))

    rows = []
    for m in done:
        truth = actual(m)
        mp, mc = model_pick(by_pred.get(m['id'], {}), m)
        lr = by_llm.get(m['id'])
        rows.append({
            'id': m['id'], 'stage': stage_of(m['phase']),
            'fixture': f"{m['home']} {m['score']['home']}-{m['score']['away']} {m['away']}",
            'truth': truth,
            'model': {'pick': mp, 'confidence': mc, 'truth': truth},
            'llm': {'pick': (lr or {}).get('pick'), 'confidence': (lr or {}).get('confidence'),
                    'truth': truth},
        })

    out = []
    w = out.append
    w('# Evaluation\n')
    w('The same fifty questions, answered three ways.\n')
    w('| | Called | Accuracy | Brier (on the pick) |')
    w('|---|---|---|---|')
    for label, key in (('Statistical model (published)', 'model'),
                       ('Language model (replay)', 'llm')):
        hit, graded, acc, brier = score([r[key] for r in rows])
        if not graded:
            w(f'| {label} | not run | — | — |')
            continue
        w(f'| {label} | {hit}/{graded} | {acc * 100:.0f}% | '
          f'{brier:.3f} |' if brier is not None else
          f'| {label} | {hit}/{graded} | {acc * 100:.0f}% | — |')
    w(f'| Actual results | {len(done)}/{len(done)} | — | — |')
    w('')
    w('Accuracy counts a pick at 51% and one at 97% the same. The Brier score does not — '
      'lower is better, and it is the figure to read when comparing two forecasters.\n')
    w('**Brier (on the pick)** is the squared error of the confidence given to the outcome '
      'named, against whether it happened. It is deliberately not the Brier the app publishes '
      'on its calibration, which is the three-way score over home/draw/away: a language model '
      'returns one pick and one confidence, not a distribution, so the binary form is the only '
      'one both columns can be scored on. Two different measures, two different names.\n')

    w('## By stage\n')
    w('| Stage | Statistical model | Language model |')
    w('|---|---|---|')
    for key, label in STAGES:
        sub = [r for r in rows if r['stage'] == key]
        mh, mg, _, _ = score([r['model'] for r in sub])
        lh, lg, _, _ = score([r['llm'] for r in sub])
        w(f'| {label} | {mh}/{mg} | ' + (f'{lh}/{lg} |' if lg else 'not run |'))
    w('')

    if llm:
        w(f"Language-model column: `{llm.get('provider')}` / `{llm.get('model')}`, "
          f"run {llm.get('ranAt', '')[:10]}. ")
        w('An LLM is not deterministic — a second run may differ, and that spread is itself '
          'worth reporting. Re-run it and commit your own column.\n')
    else:
        w('No language-model run is committed. Set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` '
          '(optionally `AI_MODEL`) and run:\n')
        w('```\npython3 scripts/llm_backtest.py\npython3 scripts/test_llm_backtest.py\n'
          'python3 scripts/eval_table.py --write\n```\n')
        w('The key is needed for that one run and nothing else; the committed result stands '
          'afterwards without it.\n')

    w('## Every match\n')
    w('| # | Match | Result | Model | LLM |')
    w('|---|---|---|---|---|')
    mark = lambda p, t: '' if not p else (' ✓' if p == t else ' ✗')  # noqa: E731
    for i, r in enumerate(rows, 1):
        mp, lp = r['model']['pick'], r['llm']['pick']
        w(f"| {i} | {r['id']} | {r['fixture']} — {r['truth'] or 'unresolved'} "
          f"| {mp or '—'}{mark(mp, r['truth'])} | {lp or '—'}{mark(lp, r['truth'])} |")
    w('')
    w('Reproduce this table with `python3 scripts/eval_table.py --write`. Every figure is '
      'recomputed from `public/data/`; nothing here is stored.\n')

    text = '\n'.join(out)
    if args.write:
        os.makedirs(os.path.dirname(DOC), exist_ok=True)
        with open(DOC, 'w') as fh:
            fh.write(text)
        print(f'wrote {os.path.relpath(DOC)}')
    else:
        print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
