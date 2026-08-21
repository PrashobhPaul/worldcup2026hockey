#!/usr/bin/env python3
"""
Hockey.AI — match briefs (GitHub Actions job).

Every completed match carries a brief. Two tiers, in order of preference:

  source "ai"     — written by Claude from the full event ledger. Requires the
                    ANTHROPIC_API_KEY repository secret.
  source "engine" — deterministic brief composed here from the same ledger
                    (scorers, minutes, penalty corners, cards, ranks). Written
                    for every completed match that has no brief yet, so the app
                    is never missing one, with or without the API key.

An engine brief is upgraded to an AI brief on a later run once the key is
available. An AI brief is never downgraded or rewritten.
"""
import json
import os
import urllib.request
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
MODEL = 'claude-sonnet-4-6'

VENUES = {'AMV': 'the Wagener Stadion in Amstelveen', 'BRU': 'the Royal Leopold Club in Brussels'}

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

# ── Deterministic brief ───────────────────────────────────────────────────

def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"

def quarter_of(minute):
    return min(4, max(1, (int(minute) - 1) // 15 + 1))

def describe_goals(events, code, teams):
    """'Harmanpreet Singh (12', PC) and Abhishek (44')' from the event ledger."""
    parts = []
    for e in events:
        if e.get('type') != 'goal' or e.get('team') != code:
            continue
        via = e.get('via')
        tag = {'PC': 'penalty corner', 'PS': 'penalty stroke'}.get(via)
        who = e.get('player') or teams.get(code, {}).get('name', code)
        parts.append(f"{who} ({e.get('minute')}'{', ' + tag if tag else ''})")
    return parts

def join_list(items):
    if not items:
        return ''
    if len(items) == 1:
        return items[0]
    return ', '.join(items[:-1]) + ' and ' + items[-1]

def plural(n, word):
    """'1 penalty corner', '5 penalty corners' — briefs are read, not parsed."""
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def possessive(name):
    """Netherlands' 2, not Netherlands's 2."""
    return f"{name}'" if name.endswith('s') else f"{name}'s"


def engine_brief(m, teams):
    """A factual brief built only from data already in the ledger."""
    h, a = teams.get(m['home'], {}), teams.get(m['away'], {})
    hn = h.get('name', m['home'])
    an = a.get('name', m['away'])
    sh, sa = m['score']['home'], m['score']['away']
    events = m.get('events', []) or []
    pc = m.get('penalty_corners', {}) or {}
    venue = VENUES.get(m.get('venue'), 'the tournament venue')
    stage = f"Pool {m['pool']}" if m.get('pool') else m.get('label', m['phase'])

    if sh > sa:
        winner, loser, wg, lg = hn, an, sh, sa
    elif sa > sh:
        winner, loser, wg, lg = an, hn, sa, sh
    else:
        winner = None

    # Paragraph 1 — the result.
    if winner:
        margin = wg - lg
        verb = ('edged' if margin == 1 else 'beat' if margin == 2 else 'ran out convincing winners over')
        p1 = (f"{winner} {verb} {loser} {wg}-{lg} at {venue}, "
              f"in a {stage} tie of the FIH Hockey World Cup 2026.")
    else:
        p1 = (f"{hn} and {an} shared a {sh}-{sa} draw at {venue}, "
              f"in a {stage} tie of the FIH Hockey World Cup 2026.")
    if h.get('fih_rank') and a.get('fih_rank'):
        p1 += (f" {hn} came in ranked {ordinal(h['fih_rank'])} in the world, "
               f"{an} {ordinal(a['fih_rank'])}.")

    # Paragraph 2 — who scored, and when.
    hg, ag = describe_goals(events, m['home'], teams), describe_goals(events, m['away'], teams)
    if hg or ag:
        bits = []
        if hg:
            bits.append(f"{hn} scored through {join_list(hg)}")
        if ag:
            bits.append(f"{an} through {join_list(ag)}")
        p2 = '; '.join(bits) + '.'
        goals = sorted((e for e in events if e.get('type') == 'goal'),
                       key=lambda e: int(e.get('minute', 0)))
        if goals:
            first, last = goals[0], goals[-1]
            p2 += (f" The opener came in Q{quarter_of(first['minute'])} and the final goal"
                   f" in Q{quarter_of(last['minute'])}.")
    else:
        p2 = 'The goal-by-goal detail for this match has not been published yet.'

    # Paragraph 3 — the shape of the game.
    p3_bits = []
    if pc.get('home') is not None and pc.get('away') is not None:
        p3_bits.append(f"{hn} won {plural(pc['home'], 'penalty corner')} to {possessive(an)} {pc['away']}")
    cards = [e for e in events if e.get('type') in ('yellow_card', 'green_card', 'red_card')]
    if cards:
        n = len(cards)
        p3_bits.append(f"{n} card{'s were' if n != 1 else ' was'} shown")
    # Nothing about how this was assembled belongs in it. A reader wants the
    # match; the machinery behind the sentence is our business, not theirs.
    p3 = ('. '.join(s[0].upper() + s[1:] for s in p3_bits) + '.') if p3_bits else ''

    return '\n\n'.join(p for p in (p1, p2, p3) if p)

def build_prompt(m, teams):
    h, a = teams.get(m['home'], {}), teams.get(m['away'], {})
    events = '\n'.join(
        f"- {e['minute']}' {e['type']} {e.get('player','')} ({e['team']}, {e.get('via','')})"
        for e in m.get('events', [])
    ) or 'No event feed available — write from the scoreline and context.'
    pc = m.get('penalty_corners', {})
    return (
        f"Write the match story.\n\n"
        f"Match: {h.get('name', m['home'])} {m['score']['home']}-{m['score']['away']} {a.get('name', m['away'])}\n"
        f"Phase: {m['phase']} (Pool {m.get('pool','-')}) · {m['date']} · "
        f"{'Wagener Stadion, Amstelveen' if m['venue']=='AMV' else 'Royal Leopold Club, Brussels'}\n"
        f"FIH ranks: {h.get('name')} #{h.get('fih_rank')} vs {a.get('name')} #{a.get('fih_rank')}\n"
        f"Penalty corners: {pc.get('home','?')} - {pc.get('away','?')}\n"
        f"Events:\n{events}"
    )

def main():
    api_key = os.environ.get('ANTHROPIC_API_KEY')
    fixtures = load('fixtures.json')
    stories_doc = load('ai-stories.json')
    teams = {t['code']: t for t in load('teams.json')['teams']}
    version_doc = load('data-version.json')

    by_id = {s['matchId']: s for s in stories_doc['stories']}
    finished = [m for m in fixtures['matches']
                if m['status'] == 'completed' and (m.get('score') or {}).get('home') is not None]
    changed = False

    # Tier 2 first: guarantee every finished match has a brief.
    for m in finished:
        if m['id'] in by_id:
            continue
        entry = {
            'matchId': m['id'],
            'story': engine_brief(m, teams),
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'model': 'hockey-ai-engine',
            'source': 'engine',
        }
        stories_doc['stories'].append(entry)
        by_id[m['id']] = entry
        changed = True
        print(f"BRIEF (engine): {m['id']}")

    # Tier 1: upgrade engine briefs to AI stories when the key is present.
    if not api_key:
        print('ANTHROPIC_API_KEY not set — engine briefs only, no AI upgrade this run.')
    else:
        for m in finished:
            existing = by_id.get(m['id'])
            if existing and existing.get('source', 'ai') == 'ai':
                continue  # already an AI story — never rewritten
            try:
                story = call_claude(api_key, build_prompt(m, teams)).strip()
                if not story:
                    continue
                existing.update({
                    'story': story,
                    'generatedAt': datetime.now(timezone.utc).isoformat(),
                    'model': MODEL,
                    'source': 'ai',
                })
                changed = True
                print(f"BRIEF (ai): {m['id']}")
            except Exception as e:
                print(f"AI story failed for {m['id']} — engine brief stands: {e}")

    covered = sum(1 for m in finished if m['id'] in by_id)
    print(f'Brief coverage: {covered}/{len(finished)} finished matches.')

    if changed:
        stamp = datetime.now(timezone.utc).isoformat()
        stories_doc['updated_at'] = stamp
        version_doc['version'] = int(version_doc.get('version', 0)) + 1
        version_doc['updated_at'] = stamp
        save('ai-stories.json', stories_doc)
        save('data-version.json', version_doc)
        print(f"Data version bumped -> {version_doc['version']}")
    else:
        print('No new briefs.')

if __name__ == '__main__':
    main()
