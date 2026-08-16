#!/usr/bin/env python3
"""
Hockey.AI — AI match story generation (GitHub Actions job).

For every COMPLETED match with a score that lacks a story, calls the Anthropic API
and writes the result into public/data/ai-stories.json, then bumps data-version.json.
Requires repo secret ANTHROPIC_API_KEY. Skips silently if the key is absent,
so the data pipeline never breaks.
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
MODEL = 'claude-sonnet-4-6'

def load(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return json.load(f)

def save(name, obj):
    with open(os.path.join(DATA_DIR, name), 'w') as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)

def call_claude(api_key, prompt):
    body = json.dumps({
        'model': MODEL,
        'max_tokens': 600,
        'system': (
            'You are the match reporter for Hockey.AI, covering the FIH Hockey World Cup 2026. '
            'Write vivid, factual 3-paragraph match stories in the style of premium sports journalism. '
            'Field hockey specifics matter: quarters (Q1-Q4), penalty corners (PC), drag flicks, '
            'push-back, the shooting circle. Never invent events not provided. Plain text, no markdown.'
        ),
        'messages': [{'role': 'user', 'content': prompt}],
    }).encode()
    req = urllib.request.Request(
        'https://api.anthropic.com/v1/messages',
        data=body,
        headers={
            'Content-Type': 'application/json',
            'x-api-key': api_key,
            'anthropic-version': '2023-06-01',
        },
    )
    resp = json.loads(urllib.request.urlopen(req, timeout=60).read())
    return ''.join(b.get('text', '') for b in resp.get('content', []))

def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        print('ANTHROPIC_API_KEY not set — skipping story generation.')
        return

    fixtures = load('fixtures.json')
    stories_doc = load('ai-stories.json')
    teams = {t['code']: t for t in load('teams.json')['teams']}
    version_doc = load('data-version.json')

    have = {s['matchId'] for s in stories_doc['stories']}
    changed = False

    for m in fixtures['matches']:
        if (m['status'] != 'completed' or m['id'] in have
                or m.get('score', {}).get('home') is None):
            continue
        h, a = teams.get(m['home'], {}), teams.get(m['away'], {})
        events = '\n'.join(
            f"- {e['minute']}' {e['type']} {e.get('player','')} ({e['team']}, {e.get('via','')})"
            for e in m.get('events', [])
        ) or 'No event feed available — write from the scoreline and context.'
        pc = m.get('penalty_corners', {})
        prompt = (
            f"Write the match story.\n\n"
            f"Match: {h.get('name', m['home'])} {m['score']['home']}-{m['score']['away']} {a.get('name', m['away'])}\n"
            f"Phase: {m['phase']} (Pool {m.get('pool','-')}) · {m['date']} · "
            f"{'Wagener Stadion, Amstelveen' if m['venue']=='AMV' else 'Royal Leopold Club, Brussels'}\n"
            f"FIH ranks: {h.get('name')} #{h.get('fih_rank')} vs {a.get('name')} #{a.get('fih_rank')}\n"
            f"Penalty corners: {pc.get('home','?')} - {pc.get('away','?')}\n"
            f"Events:\n{events}"
        )
        try:
            story = call_claude(api_key, prompt).strip()
            if story:
                stories_doc['stories'].append({
                    'matchId': m['id'],
                    'story': story,
                    'generatedAt': datetime.now(timezone.utc).isoformat(),
                    'model': MODEL,
                })
                changed = True
                print(f"STORY: {m['id']}")
        except Exception as e:
            print(f"Story failed for {m['id']}: {e}")

    if changed:
        stamp = datetime.now(timezone.utc).isoformat()
        stories_doc['updated_at'] = stamp
        version_doc['version'] = int(version_doc.get('version', 0)) + 1
        version_doc['updated_at'] = stamp
        save('ai-stories.json', stories_doc)
        save('data-version.json', version_doc)
        print(f"Data version bumped -> {version_doc['version']}")
    else:
        print('No new stories.')

if __name__ == '__main__':
    main()
