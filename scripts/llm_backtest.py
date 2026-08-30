#!/usr/bin/env python3
"""
Hockey.AI — the same call, made by a language model instead of the model.

The app's picks come from a statistical model that sees, before each push-back,
exactly one thing: this tournament so far. This replays all fifty matches and
asks a language model the same question from the same evidence — the results
that had been played by that kickoff, the two sides' records in them, their
meetings with each other, and the world ranking that stood at the time.

What makes the answer worth anything is that the model cannot see the result.
`build_prompt` is a pure function of (fixtures, teams, rankings, matchId): it
takes the fixture list, keeps only what had kicked off earlier, and never reads
the target match's score. Every run records the SHA of the prompt it sent, and
scripts/test_llm_backtest.py rebuilds each prompt from the committed data and
checks the SHA — so a reader can verify, without a key and without trusting the
run, that no future result was in front of the model when it picked.

Two properties follow, and both matter more than the accuracy figure:

  * Without a key this writes nothing and the committed run stands.
  * With a key — any provider, any model — anyone who clones the repository
    gets their own column. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, optionally
    AI_MODEL, and run it.

    python3 scripts/llm_backtest.py [--limit N] [--out FILE]
"""
import argparse
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_provider  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')
OUT = os.path.join(DATA, 'llm-backtest.json')

# The instruction the app itself works under: this tournament's evidence, no
# ranking-gap hand-waving, no model internals, and a pick even when it is a
# coin toss — a knockout has no draw to hide behind.
SYSTEM = (
    'You are the Oracle for Hockey.AI at the FIH Hockey World Cup 2026. You are given the '
    'tournament exactly as it stood before this match pushed back, and nothing after it. '
    'Pick the outcome. Pool and Stage 2 matches may end HOME, DRAW or AWAY. Knockout matches '
    'have no draw: level after sixty minutes goes to a shoot-out, so pick the side that '
    'ADVANCES. Weigh what the two sides have actually done at this tournament above their '
    'world ranking. Never refuse and never hedge: give one pick and a confidence between 0.34 '
    'and 0.99. Answer with one line of JSON and nothing else: '
    '{"pick": "HOME|DRAW|AWAY", "confidence": 0.00}')


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def kickoff(m):
    """Sort key. Date alone is not enough — two finals share 30 August."""
    return (m['date'], m['time'])


def played_before(matches, target):
    cut = kickoff(target)
    return [m for m in matches
            if m['status'] == 'completed' and (m.get('score') or {}).get('home') is not None
            and kickoff(m) < cut]


def form(code, played):
    f = dict(played=0, w=0, d=0, l=0, gf=0, ga=0)
    for m in played:
        if code not in (m['home'], m['away']):
            continue
        side, opp = ('home', 'away') if m['home'] == code else ('away', 'home')
        gf, ga = m['score'][side], m['score'][opp]
        f['played'] += 1; f['gf'] += gf; f['ga'] += ga
        f['w'] += gf > ga; f['l'] += gf < ga; f['d'] += gf == ga
    return f


def ranks_at(rankings, target):
    """The world ranking that stood before this push-back, not today's.

    The FIH table is live — a played match moves both nations' points — so a
    match replayed against the final table is being judged on information that
    did not exist when it started.
    """
    stamp = f"{target['date']}T{target['time']}:00+02:00"
    usable = [s for s in rankings.get('snapshots', []) if s['at'] < stamp]
    points = (usable[-1]['points'] if usable else rankings.get('frozen') or {})
    order = sorted(points.items(), key=lambda kv: -kv[1])
    return {code: i + 1 for i, (code, _) in enumerate(order)}


def describe(code, teams, played, rank):
    t = teams[code]
    f = form(code, played)
    if not f['played']:
        return f"{t['name']} ({code}), world #{rank}: no matches played yet at this tournament."
    return (f"{t['name']} ({code}), world #{rank}: played {f['played']}, "
            f"won {f['w']}, drawn {f['d']}, lost {f['l']}, "
            f"scored {f['gf']}, conceded {f['ga']}.")


def build_prompt(fixtures, teams, rankings, match_id):
    """The evidence for one pick. A pure function — no clock, no key, no result."""
    matches = fixtures['matches']
    target = next(m for m in matches if m['id'] == match_id)
    played = sorted(played_before(matches, target), key=kickoff)
    rank = ranks_at(rankings, target)
    h, a = target['home'], target['away']
    knockout = target['phase'] not in ('pool', 'stage2')

    lines = [
        f"MATCH: {teams[h]['name']} ({h}) vs {teams[a]['name']} ({a})",
        f"STAGE: {target.get('label') or target['phase']}"
        + (' — knockout, no draw: pick who advances' if knockout else ' — a draw is possible'),
        f"PLAYED SO FAR AT THIS TOURNAMENT: {len(played)} match(es)",
        '',
        describe(h, teams, played, rank.get(h, 99)),
        describe(a, teams, played, rank.get(a, 99)),
        '',
    ]

    meetings = [m for m in played if {m['home'], m['away']} == {h, a}]
    if meetings:
        lines.append('THEY HAVE ALREADY MET HERE:')
        for m in meetings:
            lines.append(f"  {m['home']} {m['score']['home']}-{m['score']['away']} {m['away']}"
                         f" ({m.get('label') or m['phase']}, {m['date']})")
        lines.append('')

    for code in (h, a):
        own = [m for m in played if code in (m['home'], m['away'])]
        if not own:
            continue
        lines.append(f"{code} RESULTS IN ORDER:")
        for m in own:
            side, opp = ('home', 'away') if m['home'] == code else ('away', 'home')
            lines.append(f"  {m['date']} vs {m[opp]} {m['score'][side]}-{m['score'][opp]}")
        lines.append('')

    lines.append('Pick the outcome of MATCH.')
    return '\n'.join(lines)


PICK = re.compile(r'"?pick"?\s*[:=]\s*"?(HOME|DRAW|AWAY)"?', re.I)
CONF = re.compile(r'"?confidence"?\s*[:=]\s*"?([01]?\.\d+|1(?:\.0+)?)"?', re.I)


def parse(text):
    if not text:
        return None
    p = PICK.search(text)
    if not p:
        return None
    c = CONF.search(text)
    return {'pick': p.group(1).upper(),
            'confidence': round(min(0.99, max(0.34, float(c.group(1)))), 3) if c else None}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0, help='stop after N matches (a smoke run)')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    name, _, model = ai_provider.provider()
    if not name:
        print('No AI provider configured (ANTHROPIC_API_KEY or OPENAI_API_KEY).')
        print('Nothing was run; any committed backtest stands untouched.')
        return 0

    fixtures, teams_doc = load('fixtures.json'), load('teams.json')
    teams = {t['code']: t for t in teams_doc['teams']}
    rankings = load('rankings-history.json')
    done = sorted((m for m in fixtures['matches']
                   if m['status'] == 'completed' and (m.get('score') or {}).get('home') is not None),
                  key=kickoff)
    if args.limit:
        done = done[:args.limit]

    rows, unparsed = [], 0
    for i, m in enumerate(done, 1):
        prompt = build_prompt(fixtures, teams, rankings, m['id'])
        got = parse(ai_provider.complete(SYSTEM, prompt, max_tokens=120))
        if not got:
            unparsed += 1
            print(f"  {m['id']}: no usable pick came back")
            continue
        rows.append({'matchId': m['id'], 'kickoff': f"{m['date']}T{m['time']}",
                     'pick': got['pick'], 'confidence': got['confidence'],
                     'promptSha': hashlib.sha256(prompt.encode()).hexdigest()})
        print(f"  {i:>2}/{len(done)} {m['id']:<6} {got['pick']:<5} {got['confidence']}")

    doc = {
        'source': 'scripts/llm_backtest.py',
        'note': ('One pick per match from a language model given only the tournament as it '
                 'stood before that push-back. Prompts are rebuildable from the committed '
                 'data; scripts/test_llm_backtest.py checks every promptSha.'),
        'provider': name, 'model': model,
        'systemSha': hashlib.sha256(SYSTEM.encode()).hexdigest(),
        'ranAt': datetime.now(timezone.utc).isoformat(),
        'matchesAsked': len(done), 'picksReturned': len(rows), 'unparsed': unparsed,
        'picks': rows,
    }
    with open(args.out, 'w') as fh:
        json.dump(doc, fh, indent=2)
        fh.write('\n')
    print(f'\n{len(rows)} pick(s) from {name}/{model} -> {os.path.relpath(args.out)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
