#!/usr/bin/env python3
"""AI-authored pre-match rationales for upcoming Oracle picks.

Same two-tier contract as the match briefs: when an AI provider is
configured (scripts/ai_provider.py — ANTHROPIC_API_KEY or OPENAI_API_KEY),
every active pick for a match that has not pushed back yet gets its
rationale written by the model from the two teams' actual tournament
records; without a key, the deterministic template the pipeline already
writes stands. The ledger contract is untouched: picks, probabilities and
publishedAt are never modified, the replaced sentence stays on the row as
`reason_original`, and a rationale that has already been authored (by a
model or by hand — marked by `reason_original`) is never rewritten.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_provider  # noqa: E402
from update_data import kickoff, now_utc  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')

SYSTEM = (
    'You are the Oracle analyst for Hockey.AI at the FIH Hockey World Cup 2026. '
    'Write a single pre-match paragraph (60-90 words) arguing the given pick from the '
    'tournament evidence provided — results, goals scored and conceded, opponents faced. '
    'Never cite world rankings, ratings or model internals; never mention probabilities; '
    'never invent results not provided. Plain text, no markdown.')


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def save(name, doc):
    with open(os.path.join(DATA, name), 'w') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write('\n')


def team_record(code, fixtures, teams):
    lines = []
    for m in fixtures['matches']:
        if m['status'] != 'completed' or (m.get('score') or {}).get('home') is None:
            continue
        if code not in (m['home'], m['away']):
            continue
        lines.append(f"  {m['home']} {m['score']['home']}-{m['score']['away']} {m['away']} ({m['phase']})")
    name = next((t['name'] for t in teams['teams'] if t['code'] == code), code)
    return f"{name} ({code}) results this tournament:\n" + ('\n'.join(lines) or '  none yet')


def main():
    name, _, model = ai_provider.provider()
    if not name:
        print('No AI provider configured — deterministic rationales stand.')
        return 0

    fixtures = load('fixtures.json')
    preds = load('predictions.json')
    teams = load('teams.json')
    matches = {m['id']: m for m in fixtures['matches']}
    now = now_utc()
    stamp = datetime.now(timezone.utc).isoformat()

    wrote = 0
    for row in preds['predictions']:
        if row.get('superseded') or row.get('reason_original'):
            continue
        m = matches.get(row['matchId'])
        if not m or m['home'] == 'TBD':
            continue
        try:
            if kickoff(m) <= now:
                continue
        except ValueError:
            continue
        pick_code = m['home'] if row['pick'] == 'HOME' else m['away'] if row['pick'] == 'AWAY' else None
        pick_line = f"The Oracle picks {pick_code} to win." if pick_code else 'The Oracle picks a draw.'
        prompt = (
            f"Upcoming match: {m['home']} v {m['away']} ({m['phase']}, {m['date']}).\n"
            f"{pick_line}\n\n"
            f"{team_record(m['home'], fixtures, teams)}\n\n"
            f"{team_record(m['away'], fixtures, teams)}\n\n"
            'Write the pre-match rationale for the pick.')
        try:
            text = (ai_provider.complete(SYSTEM, prompt, max_tokens=300) or '').strip()
        except Exception as e:  # a provider hiccup must never fail the run
            print(f'AI rationale failed for {row["matchId"]}: {e}')
            continue
        if not text:
            continue
        row['reason_original'] = row['reason']
        row['reason'] = text
        row['reason_revised_at'] = stamp
        row['reason_revision'] = f'rationale authored by {model} from the tournament record; pick and probabilities unchanged'
        wrote += 1
        print(f'RATIONALE ({model}): {row["matchId"]}')

    if not wrote:
        print('No rationales to author this run.')
        return 0

    save('predictions.json', preds)
    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    version['updated_at'] = stamp
    save('data-version.json', version)
    from data_fingerprint import stamp as stamp_fingerprint
    stamp_fingerprint()
    print(f'{wrote} rationale(s) authored, data-version -> {version["version"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
