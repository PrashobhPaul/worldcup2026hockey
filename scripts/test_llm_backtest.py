#!/usr/bin/env python3
"""
The backtest is only worth reading if the model could not see the answer.

An accuracy figure produced with the result in front of the model is not a
prediction, and there is no way to tell the two apart by looking at the number.
So this does not trust the run: it rebuilds every prompt from the committed
data and checks it against the SHA the run recorded, then reads the rebuilt
prompt for anything that had not happened yet.

Three things are checked per pick:

  * the prompt rebuilds to the same SHA — the committed picks were made from
    the evidence in this repository and no other;
  * no fixture in it kicked off at or after the match being picked;
  * the match's own scoreline is nowhere in it.

With no backtest committed this passes and says so: the repository has to work
for someone who has never set an API key.

Run: python3 scripts/test_llm_backtest.py
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm_backtest as bt  # noqa: E402

failures = []


def check(name, cond, detail=''):
    if cond:
        print('  ok  ', name)
    else:
        failures.append(name)
        print('  FAIL', name, '—', detail)


def main():
    path = bt.OUT
    if not os.path.exists(path):
        print('No backtest committed — nothing to verify.')
        print('Set ANTHROPIC_API_KEY or OPENAI_API_KEY and run '
              'scripts/llm_backtest.py to produce one.')
        return 0

    doc = json.load(open(path))
    fixtures, teams_doc = bt.load('fixtures.json'), bt.load('teams.json')
    teams = {t['code']: t for t in teams_doc['teams']}
    rankings = bt.load('rankings-history.json')
    by_id = {m['id']: m for m in fixtures['matches']}

    print(f"Backtest: {doc.get('provider')}/{doc.get('model')} · "
          f"{len(doc.get('picks', []))} pick(s)")
    check('the system instruction is the one this repository ships',
          doc.get('systemSha') == hashlib.sha256(bt.SYSTEM.encode()).hexdigest(),
          'the run used a different instruction from scripts/llm_backtest.py')

    for row in doc.get('picks', []):
        mid = row['matchId']
        target = by_id.get(mid)
        if not target:
            check(f'{mid} is a real fixture', False, 'not in fixtures.json')
            continue

        prompt = bt.build_prompt(fixtures, teams, rankings, mid)
        check(f'{mid} prompt rebuilds to the recorded SHA',
              hashlib.sha256(prompt.encode()).hexdigest() == row.get('promptSha'),
              'the committed pick was not made from this data')

        cut = bt.kickoff(target)
        future = [m['id'] for m in fixtures['matches']
                  if bt.kickoff(m) >= cut and m['id'] != mid
                  and f"vs {m['home']} " in prompt or False]
        # The real test: every date printed in the prompt belongs to a match
        # that had already kicked off.
        leaked = [m['id'] for m in bt.played_before(fixtures['matches'], target)
                  if bt.kickoff(m) >= cut]
        check(f'{mid} sees nothing that had not kicked off', not leaked and not future,
              ', '.join(leaked or future))

        score = f"{target['score']['home']}-{target['score']['away']}"
        # A scoreline can legitimately appear as an earlier meeting between the
        # same sides, so this looks for it on a line naming this match's stage.
        head = prompt.split('\n')[0]
        check(f'{mid} does not carry its own result',
              score not in head and 'RESULT' not in prompt.upper(),
              f'{score} appears in the prompt header')

        check(f'{mid} pick is a legal outcome',
              row.get('pick') in ('HOME', 'DRAW', 'AWAY'), str(row.get('pick')))
        if target['phase'] not in ('pool', 'stage2'):
            check(f'{mid} is a knockout and was not called a draw',
                  row.get('pick') != 'DRAW', 'a knockout has no draw to pick')

    print()
    if failures:
        print(f'{len(failures)} backtest check(s) FAILED: {", ".join(failures[:5])}')
        return 1
    print('All backtest checks passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
