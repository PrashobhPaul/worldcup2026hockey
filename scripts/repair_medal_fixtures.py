#!/usr/bin/env python3
"""One-off repair: undo the knockout re-match corruption of 2026-08-29.

What happened, from the pipeline's own history. The schedule sync and the
results backfill both matched TMS pages to fixtures by the unordered team
pair. No two teams meet twice in a pool, so the shortcut held for two weeks —
until the semi-finals produced the tournament's first genuine re-matches:

    bronze  NED v ARG   — already met in pool A (A3, 18 Aug, ARG 1-3 NED)
    gold    ESP v GER   — already met in stage 2 (S2F2, 21 Aug, GER 1-2 ESP)

Once the medal ties were slotted, each pair keyed TWO fixtures, a dict
comprehension quietly kept one, and two runs later the damage was mutual:
A3 and S2F2 had been re-dated onto the medal slots (30 Aug), and BRZ and
GOLD had absorbed the OLD pool results as if the medals were already
decided — a gold final "played" nine days before the semi-finals that feed
it, and a champion the app then reported with certainty.

This script restores the four rows verbatim from the last commits that held
them correctly, then proves the result:

    A3, S2F2   from 57e2df0b (2026-08-28 18:14 UTC, pre-corruption)
    GOLD, BRZ  from 4f0b7e6f (2026-08-28 23:57 UTC — correctly slotted from
               the real semi-final results, still unplayed, no stolen ids)

Nothing is written by hand: every restored byte comes from the repository's
own committed history. Derived artifacts (player stats, ratings, stories,
calibration) are rebuilt afterwards by scripts/recompute.py and the
pipeline. The matching bug itself is fixed in update_data.py; the
regression tests live in test_parsers.py.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'public', 'data')
SOURCES = {'A3': '57e2df0b6cea14e966912e536abc69dd3bc1b107',
           'S2F2': '57e2df0b6cea14e966912e536abc69dd3bc1b107',
           'GOLD': '4f0b7e6fef3f85527e3a9de83d434ce45bb51a94',
           'BRZ': '4f0b7e6fef3f85527e3a9de83d434ce45bb51a94'}


def rows_at(commit):
    body = subprocess.check_output(
        ['git', 'show', f'{commit}:public/data/fixtures.json'],
        cwd=os.path.join(HERE, '..'))
    return {m['id']: m for m in json.loads(body)['matches']}


def main():
    path = os.path.join(DATA, 'fixtures.json')
    with open(path) as fh:
        doc = json.load(fh)
    good = {mid: rows_at(commit)[mid] for mid, commit in SOURCES.items()}

    for i, m in enumerate(doc['matches']):
        if m['id'] in good:
            was = f"{m['date']} {m.get('time')} {m['status']} {m.get('score')}"
            doc['matches'][i] = good[m['id']]
            now = good[m['id']]
            print(f"restored {m['id']}: {was}  ->  "
                  f"{now['date']} {now.get('time')} {now['status']} {now.get('score')}")

    by_id = {m['id']: m for m in doc['matches']}
    semis_day = max(by_id['SF1']['date'], by_id['SF2']['date'])
    assert by_id['GOLD']['status'] == 'scheduled' and by_id['BRZ']['status'] == 'scheduled'
    assert by_id['GOLD']['date'] > semis_day and by_id['BRZ']['date'] > semis_day, \
        'a medal match still predates the semi-finals'
    assert by_id['A3']['tms_id'] == 22349 and by_id['S2F2']['tms_id'] == 22360
    tms = [m.get('tms_id') for m in doc['matches'] if m.get('tms_id')]
    assert len(tms) == len(set(tms)), 'two fixtures share a TMS id'
    done = sum(1 for m in doc['matches'] if m['status'] == 'completed')
    print(f'completed matches now: {done} (the medal round is back to being unplayed)')

    with open(path, 'w') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write('\n')

    # Stories written for the phantom completions describe matches that never
    # happened; they are presentation derived from the record, not the ledger,
    # and go with the record they were derived from. The pipeline writes real
    # pre-match previews for the medal ties on its next run.
    spath = os.path.join(DATA, 'ai-stories.json')
    with open(spath) as fh:
        stories = json.load(fh)
    keep, dropped = [], []
    for s in stories['stories']:
        if s.get('matchId') in ('GOLD', 'BRZ') and s.get('kind') != 'preview':
            dropped.append((s.get('matchId'), s.get('kind')))
        else:
            keep.append(s)
    if dropped:
        stories['stories'] = keep
        with open(spath, 'w') as fh:
            json.dump(stories, fh, indent=2, ensure_ascii=False)
            fh.write('\n')
        print('dropped phantom stories:', dropped)


if __name__ == '__main__':
    main()
