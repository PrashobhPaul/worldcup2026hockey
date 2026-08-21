#!/usr/bin/env python3
"""
Stage 2 match briefs and pick rationales — the Stage 1 review, continued.

Same contract as stage1_review.py: every brief is written from the official
match record (fixtures.json events, penalty corners, match stats) and reads
as a match report, never as a description of the machinery; every rationale
is rewritten as a pre-match argument from the team's tournament evidence up
to that match — never a ranking gap, never hindsight. Picks, probabilities
and publishedAt are untouched; the replaced sentence stays on the row as
`reason_original`.

Unlike the Stage 1 review — a one-shot over a finished stage — this file
grows one match at a time as Stage 2 results land, so a finished match not
yet reviewed here is a reminder, not an error.

Usage:
    python3 scripts/stage2_review.py --check    # report, change nothing
    python3 scripts/stage2_review.py            # apply
"""
import json
import os
import sys
from datetime import datetime, timezone

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')

STORIES = {
    'S2H1': """South Africa opened Stage 2 in Brussels with the result their pool campaign never quite produced: a first win of the tournament, and it was effectively built inside twenty minutes. Mustaphaa Cassiem converted penalty corners in the 17th and the 19th — South Africa's only two corners of the match — and a French side that had come through Pool B unbeaten against Germany and Malaysia found itself two down before it had won a corner of its own.

Victor Charlet's reply in the 30th kept France alive, converting their single corner of the match on the stroke of half-time, and the game France wanted was set up: one goal in it, half the match to play, and twenty-one circle entries to South Africa's twenty saying the territory was theirs to use. It never became more than territory. South Africa defended the margin through the third and fourth quarters — the green cards shown to Senzwesihle Ngubane in the 13th and Amaury Bellenger in the 17th were the only interruptions of a hard first half — and Dayaan Cassiem's field goal in the 60th, moments before Samkelo Mvimbi's late yellow, closed it out.

The arithmetic is simple: three penalty corners in the match, three goals, perfect conversion at both ends, and the side that won one more corner won the game. Nor was it against the run of play — South Africa held sixty-one per cent of possession and out-shot France six to four. France's twenty-one circle entries produced only four shots, and that gap between territory and threat, rather than any defensive failure, is what cost them a match they were favoured to win.""",
}

REASONS = {
    'S2H1': "France left Pool B unbeaten against Germany and Malaysia and lost to Belgium by a single goal, conceding seven in three matches against far stronger opposition than South Africa met. South Africa bring one point from three into Stage 2, with nine conceded in the pool — seven of them to Spain and Ireland — and the Cassiem set-piece threat as their clearest route to goal. The steadier pool evidence favours France.",
}


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def save(name, doc, indent=2):
    with open(os.path.join(DATA, name), 'w') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=indent)
        fh.write('\n')


def main():
    check = '--check' in sys.argv
    now = datetime.now(timezone.utc).isoformat()

    fixtures = load('fixtures.json')
    finished = [m for m in fixtures['matches']
                if m['status'] == 'completed' and m['phase'] != 'pool'
                and (m.get('score') or {}).get('home') is not None]
    ids = {m['id'] for m in finished}

    extra = set(STORIES) - ids
    if extra:
        print(f'MISMATCH — briefs written for unplayed matches: {sorted(extra)}')
        return 1
    missing = ids - set(STORIES)
    if missing:
        print(f'REMINDER — finished Stage 2+ matches awaiting a brief: {sorted(missing)}')

    stories = load('ai-stories.json')
    by_id = {s['matchId']: s for s in stories['stories']}
    wrote = 0
    for mid, text in STORIES.items():
        row = by_id.get(mid)
        body = text.strip()
        if row and row.get('story') == body:
            continue
        wrote += 1
        if check:
            continue
        if row:
            row.pop('model', None)          # provenance is `source`; no id needed
            row.update({'story': body, 'generatedAt': now, 'source': 'ai'})
        else:
            stories['stories'].append(
                {'matchId': mid, 'story': body, 'generatedAt': now, 'source': 'ai'})

    preds = load('predictions.json')
    revised = 0
    for row in preds['predictions']:
        if row.get('superseded'):
            continue                        # errata stay exactly as published
        new = REASONS.get(row['matchId'])
        if not new or row['reason'] == new:
            continue
        revised += 1
        if check:
            continue
        # The pick, the probabilities and publishedAt are untouched; the
        # sentence being replaced stays on the row so nothing is erased.
        row.setdefault('reason_original', row['reason'])
        row['reason'] = new
        row['reason_revised_at'] = now
        row['reason_revision'] = 'rationale rewritten from pre-match tournament evidence; pick and probabilities unchanged'

    if check:
        print(f'{wrote} brief(s) and {revised} rationale(s) would change.')
        return 0

    if not wrote and not revised:
        print('Nothing to change — briefs and rationales already match this review.')
        return 0

    stories['stories'].sort(key=lambda s: s['matchId'])
    save('ai-stories.json', stories)
    save('predictions.json', preds)

    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    version['updated_at'] = now
    save('data-version.json', version)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from data_fingerprint import stamp as stamp_fingerprint
    stamp_fingerprint()

    print(f'{wrote} brief(s) rewritten, {revised} rationale(s) revised, '
          f"data-version -> {version['version']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
