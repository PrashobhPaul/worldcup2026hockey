#!/usr/bin/env python3
"""
The backtest is only worth reading if the model could not see the answer.

An accuracy figure produced with the result in front of the model is not a
prediction, and there is no way to tell the two apart by looking at the number.
So this does not trust the run: it rebuilds every prompt from the committed
data and checks it against the SHA the run recorded, then reads the rebuilt
prompt back — line by line, resolving every scoreline it cites to a real
fixture — for anything that had not happened yet.

Three things are checked per pick:

  * the prompt rebuilds to the same SHA — the committed picks were made from
    the evidence in this repository and no other;
  * every result the prompt cites resolves to a fixture that had already
    pushed back when this one started;
  * the match being picked is not among the fixtures it cites.

The citation check is deliberately done on the rendered text rather than on
build_prompt's inputs. Asking the builder which matches it selected only
proves it agrees with itself; parsing what it actually printed is what catches
a leak introduced by a change to the wording.

With no backtest committed this passes and says so: the repository has to work
for someone who has never set an API key.

Run: python3 scripts/test_llm_backtest.py
"""
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import llm_backtest as bt  # noqa: E402

# The two shapes build_prompt prints a scoreline in: a line in a side's own
# run of results, and a line in the head-to-head block.
OWN = re.compile(r'^ {2}(\d{4}-\d{2}-\d{2}) vs ([A-Z]{3}) (\d+)-(\d+)$')
MEETING = re.compile(r'^ {2}([A-Z]{3}) (\d+)-(\d+) ([A-Z]{3}) \(.*, (\d{4}-\d{2}-\d{2})\)$')
SECTION = re.compile(r'^([A-Z]{3}) RESULTS IN ORDER:$')

failures = []


def check(name, cond, detail=''):
    if cond:
        print('  ok  ', name)
    else:
        failures.append(name)
        print('  FAIL', name, '—', detail)


def cited(prompt):
    """Every (date, {two team codes}) the prompt states a scoreline for."""
    out, owner = [], None
    for line in prompt.split('\n'):
        sec = SECTION.match(line)
        if sec:
            owner = sec.group(1)
            continue
        m = OWN.match(line)
        if m and owner:
            out.append((m.group(1), frozenset((owner, m.group(2)))))
            continue
        m = MEETING.match(line)
        if m:
            out.append((m.group(5), frozenset((m.group(1), m.group(4)))))
    return out


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
    # A cited scoreline names a date and two sides, never a fixture id, so the
    # lookup that turns one back into a fixture is built once.
    by_pairing = {}
    for m in fixtures['matches']:
        by_pairing.setdefault((m['date'], frozenset((m['home'], m['away']))), []).append(m)

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
        later, unknown, itself = [], [], []
        for date, pair in cited(prompt):
            found = by_pairing.get((date, pair)) or []
            if not found:
                unknown.append(f'{date} {"/".join(sorted(pair))}')
                continue
            for m in found:
                if m['id'] == mid:
                    itself.append(mid)
                elif bt.kickoff(m) >= cut:
                    later.append(m['id'])
        check(f'{mid} cites only fixtures that had already pushed back',
              not later and not unknown,
              ', '.join(later + unknown) or '')
        check(f'{mid} does not carry its own result', not itself,
              'its own scoreline is printed in the prompt')

        # The header names the fixture being picked; a score there would be the
        # answer written above the question.
        head = prompt.split('\n')[0]
        check(f'{mid} header states the fixture and no score',
              head.startswith('MATCH: ') and not re.search(r'\d+-\d+', head), head)

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
