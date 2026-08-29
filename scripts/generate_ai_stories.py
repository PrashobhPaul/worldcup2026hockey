#!/usr/bin/env python3
"""
Hockey.AI — match briefs (GitHub Actions job).

Every completed match carries a brief. Two tiers, in order of preference:

  source "ai"     — written by the configured AI provider from the full
                    event ledger (see scripts/ai_provider.py: set
                    ANTHROPIC_API_KEY or OPENAI_API_KEY).
  source "engine" — deterministic brief composed here from the same ledger
                    (scorers, minutes, penalty corners, cards, ranks). Written
                    for every completed match that has no brief yet, so the app
                    is never missing one, with or without the API key.

An engine brief is upgraded to an AI brief on a later run once the key is
available. An AI brief is never downgraded or rewritten.
"""
import json
import re
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_provider  # noqa: E402

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')

STORY_SYSTEM = (
    'You are the match reporter for Hockey.AI, covering the FIH Hockey World Cup 2026. '
    'Write vivid, factual 3-paragraph match stories in the style of premium sports journalism. '
    'Field hockey specifics matter: quarters (Q1-Q4), penalty corners (PC), drag flicks, '
    'push-back, the shooting circle. Never invent events not provided. Plain text, no markdown.')

VENUES = {'AMV': 'the Wagener Stadion in Amstelveen', 'BRU': 'the Royal Leopold Club in Brussels'}

def load(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return json.load(f)

def save(name, obj):
    with open(os.path.join(DATA_DIR, name), 'w') as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)

# ── Deterministic brief ───────────────────────────────────────────────────

def ordinal(n):
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"

def quarter_of(minute):
    return min(4, max(1, (int(minute) - 1) // 15 + 1))

def describe_goals(events, code, teams):
    """'Harmanpreet Singh (12th minute, penalty corner)' from the event ledger.

    Minutes are written as ordinals because that is how the fact gate reads
    them back: every goal minute in the record must appear in the brief, and
    "17'" is a notation, not a word.
    """
    parts = []
    for e in events:
        if e.get('type') != 'goal' or e.get('team') != code:
            continue
        via = e.get('via')
        tag = {'PC': 'penalty corner', 'PS': 'penalty stroke'}.get(via)
        who = e.get('player') or teams.get(code, {}).get('name', code)
        parts.append(f"{who} ({ordinal(int(e.get('minute')))} minute{', ' + tag if tag else ''})")
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
    """A factual brief built only from data already in the ledger.

    A stopgap, not a lesser truth: it is published when the AI writer is
    unavailable and replaced by an AI brief on a later run, and while it
    stands it is held to every rule the fact gate holds an AI brief to —
    every scorer named, every goal minute cited as an ordinal, three
    paragraphs of real length, and not one statistic the FIH does not
    publish. The 29 Aug outage published stopgaps that quoted "corners won",
    a number nobody measured (it was counting corner GOALS), and ran to
    seventy-seven words; the gate caught them a day late because nothing on
    main was running it. Facts only, from the ledger only.
    """
    h, a = teams.get(m['home'], {}), teams.get(m['away'], {})
    hn = h.get('name', m['home'])
    an = a.get('name', m['away'])
    sh, sa = m['score']['home'], m['score']['away']
    events = m.get('events', []) or []
    venue = VENUES.get(m.get('venue'), 'the tournament venue')
    stage = f"Pool {m['pool']}" if m.get('pool') else m.get('label', m['phase'])
    goals = sorted((e for e in events if e.get('type') == 'goal'),
                   key=lambda e: int(e.get('minute', 0)))

    # Paragraph 1 — the result, and what it settles.
    if sh > sa:
        winner, loser, wg, lg = hn, an, sh, sa
    elif sa > sh:
        winner, loser, wg, lg = an, hn, sa, sh
    else:
        winner = None
    if winner:
        margin = wg - lg
        verb = ('edged' if margin == 1 else 'beat' if margin == 2
                else 'ran out convincing winners over')
        p1 = (f"{winner} {verb} {loser} {wg}-{lg} at {venue}, "
              f"in the {stage} tie of the FIH Hockey World Cup 2026.")
    else:
        p1 = (f"{hn} and {an} finished level at {sh}-{sa} after sixty minutes "
              f"at {venue}, in the {stage} tie of the FIH Hockey World Cup 2026.")
        so = m.get('shootout')
        if so:
            so_w = hn if so['home'] > so['away'] else an
            p1 += (f" {so_w} took the tie {max(so['home'], so['away'])}-"
                   f"{min(so['home'], so['away'])} in the shoot-out.")
    if winner and isinstance(stage, str):
        placing = re.match(r'(\d+)[a-z]{2}/(\d+)[a-z]{2} Place', stage)
        if placing:
            p1 += (f" The result settles {ordinal(int(placing.group(1)))} place for "
                   f"{winner}; {loser} finish {ordinal(int(placing.group(2)))}.")
    if h.get('fih_rank') and a.get('fih_rank'):
        p1 += (f" {hn} came into the match ranked {ordinal(h['fih_rank'])} in the "
               f"world, {an} {ordinal(a['fih_rank'])}")
        gap = abs(h['fih_rank'] - a['fih_rank'])
        p1 += (f" — {plural(gap, 'place')} between them on the FIH table." if gap
               else ' — level pegging on the FIH table.')
    try:
        played_on = datetime.strptime(m['date'], '%Y-%m-%d').strftime('%-d %B')
        p1 = p1.replace(' at ' + venue + ',', f" at {venue} on {played_on},", 1)
    except (KeyError, ValueError):
        pass

    # Paragraph 2 — who scored, and when. Every name and every minute in the
    # record appears here; the gate reads them back one by one.
    hg, ag = describe_goals(events, m['home'], teams), describe_goals(events, m['away'], teams)
    if hg or ag:
        # Whoever scored first is narrated first — "replied" must follow an
        # actual opener, not the home column of a table.
        first_scorer = goals[0].get('team') if goals else m['home']
        order = [(hn, hg), (an, ag)] if first_scorer == m['home'] else [(an, ag), (hn, hg)]
        bits = []
        for i, (name, gl) in enumerate(order):
            if not gl:
                continue
            verb = 'scored through' if not bits else 'replied through'
            bits.append(f"{name} {verb} {join_list(gl)}")
        p2 = '; '.join(bits) + '.'
        if len(goals) == sh + sa:
            half = [g for g in goals if int(g.get('minute', 0)) <= 30]
            hh = sum(1 for g in half if g.get('team') == m['home'])
            ha = len(half) - hh
            p2 += f" It stood {hh}-{ha} at half-time."
        first, last = goals[0], goals[-1]
        if len(goals) == 1:
            p2 += (f" The only goal on the official record came in the "
                   f"{ordinal(int(first['minute']))} minute, in the "
                   f"{ordinal(quarter_of(first['minute']))} quarter.")
        else:
            p2 += (f" The opening goal came in the {ordinal(int(first['minute']))} minute"
                   f" and the final goal in the {ordinal(int(last['minute']))},"
                   f" from the {ordinal(quarter_of(first['minute']))} quarter"
                   f" to the {ordinal(quarter_of(last['minute']))}.")
        # Claims about the whole of the scoring key off the SCORE, and are only
        # made when the event feed carries every goal the score claims — a
        # partial feed once had this composer calling a 3-1 a one-goal
        # afternoon.
        if len(goals) != sh + sa:
            p2 += (f" The official record so far details {plural(len(goals), 'goal')} of the "
                   f"{sh + sa}; the rest are added the moment the FIH publishes them.")
        elif sh + sa <= 2:
            p2 += (f" Goals were scarce all afternoon — "
                   f"{plural(sh + sa, 'goal')} in the sixty minutes was the whole of the scoring.")
        if winner and wg - lg == 1 and goals:
            decider = goals[-1] if (goals[-1].get('team') == m['home']) == (winner == hn) else None
            if decider and decider.get('player'):
                p2 += (f" {possessive(decider['player'])} {ordinal(int(decider['minute']))}-minute "
                       f"goal stood as the difference.")
    elif sh == 0 and sa == 0:
        p2 = ('Neither side found a way through in the sixty minutes: sixty minutes '
              'of hockey, four quarters, and not one goal on the official record. '
              'The point apiece is what the scoreline says it is.')
    else:
        p2 = ('The goal-by-goal detail for this match has not been published by the '
              'FIH yet; the scoreline above is the confirmed final. Scorers and '
              'minutes are added to this brief the moment the official record '
              'carries them.')

    # Paragraph 3 — the shape of the game, from published facts only: the goal
    # split by type and quarter, and the cards. Nothing here quotes a count
    # the FIH does not publish.
    p3_bits = []
    feed_complete = bool(goals) and len(goals) == sh + sa
    if feed_complete:
        # A set piece is a penalty corner or a stroke; 'FG' in the record is a
        # field goal, i.e. open play — testing the field for truthiness once
        # called every goal in a match a set piece. Every claim in this block
        # describes the whole of the scoring, so none is made off a partial
        # feed.
        set_piece = sum(1 for g in goals if g.get('via') in ('PC', 'PS'))
        open_play = len(goals) - set_piece
        if set_piece and open_play:
            p3_bits.append(f"of the {plural(len(goals), 'goal')}, {open_play} came in open play "
                           f"and {set_piece} from the set piece")
        elif set_piece:
            p3_bits.append("every goal came from the set piece")
        else:
            p3_bits.append("every goal came in open play")
        by_q = {}
        for g in goals:
            by_q[quarter_of(g['minute'])] = by_q.get(quarter_of(g['minute']), 0) + 1
        top = max(by_q.values())
        leaders = [q for q, n in by_q.items() if n == top]
        # "Busiest" is a superlative; a tie has no busiest quarter.
        if top > 1 and len(leaders) == 1:
            p3_bits.append(f"the {ordinal(leaders[0])} quarter was the busiest, "
                           f"with {top} of them")
    if feed_complete and winner:
        half_h = sum(1 for x in goals if int(x.get('minute', 0)) <= 30 and x.get('team') == m['home'])
        half_a = sum(1 for x in goals if int(x.get('minute', 0)) <= 30 and x.get('team') != m['home'])
        w_half, l_half = (half_h, half_a) if winner == hn else (half_a, half_h)
        if w_half < l_half:
            p3_bits.append(f"{winner} trailed at the interval and turned the match "
                           f"around in the second half")
        elif w_half == l_half:
            p3_bits.append(f"the sides were level at the interval, and {winner} "
                           f"won the second half")
        else:
            p3_bits.append(f"{winner} led at the interval and were not caught")
    if winner and lg == 0:
        p3_bits.append(f"{winner}'s defence kept {loser} off the scoresheet entirely")
    cards = [e for e in events if e.get('type') in ('yellow_card', 'green_card', 'red_card')]
    if cards:
        colours = {'green_card': 0, 'yellow_card': 0, 'red_card': 0}
        for c in cards:
            colours[c['type']] += 1
        parts = [plural(n, colour.split('_')[0] + ' card')
                 for colour, n in colours.items() if n]
        p3_bits.append(f"{join_list(parts)} {'were' if len(cards) != 1 else 'was'} shown")
    else:
        p3_bits.append('no cards were shown')
    scorers = {g.get('player') for g in goals if g.get('player')}
    if feed_complete and len(scorers) > 2:
        p3_bits.append(f"the goals were spread across {len(scorers)} different scorers")
    if m.get('matchNo'):
        p3_bits.append(f"this was match {m['matchNo']} of the tournament's fifty")
    p3 = ('. '.join(b[0].upper() + b[1:] for b in p3_bits) + '.') if p3_bits else ''

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
    ai_name, _, ai_model = ai_provider.provider()
    fixtures = load('fixtures.json')
    stories_doc = load('ai-stories.json')
    teams = {t['code']: t for t in load('teams.json')['teams']}
    version_doc = load('data-version.json')

    by_id = {s['matchId']: s for s in stories_doc['stories']}
    finished = [m for m in fixtures['matches']
                if m['status'] == 'completed' and (m.get('score') or {}).get('home') is not None]
    changed = False

    # Tier 2 first: guarantee every finished match has a brief. An engine
    # brief is a deterministic derivation of the ledger, not a published
    # opinion — so an existing one that no longer matches what the composer
    # derives today (the events arrived late, or the composer was fixed) is
    # re-derived rather than left stale. AI stories are never touched here.
    for m in finished:
        existing = by_id.get(m['id'])
        if existing and existing.get('source', 'ai') == 'ai':
            continue
        text = engine_brief(m, teams)
        if existing:
            if existing.get('story') != text:
                existing.update({'story': text,
                                 'generatedAt': datetime.now(timezone.utc).isoformat()})
                changed = True
                print(f"BRIEF (engine, re-derived): {m['id']}")
            continue
        entry = {
            'matchId': m['id'],
            'story': text,
            'generatedAt': datetime.now(timezone.utc).isoformat(),
            'model': 'hockey-ai-engine',
            'source': 'engine',
        }
        stories_doc['stories'].append(entry)
        by_id[m['id']] = entry
        changed = True
        print(f"BRIEF (engine): {m['id']}")

    # Tier 1: upgrade engine briefs to AI stories when the key is present.
    if not ai_name:
        print('No AI provider configured (ANTHROPIC_API_KEY / OPENAI_API_KEY) — '
              'engine briefs only, no AI upgrade this run.')
    else:
        for m in finished:
            existing = by_id.get(m['id'])
            if existing and existing.get('source', 'ai') == 'ai':
                continue  # already an AI story — never rewritten
            try:
                story = (ai_provider.complete(STORY_SYSTEM, build_prompt(m, teams)) or '').strip()
                if not story:
                    continue
                existing.update({
                    'story': story,
                    'generatedAt': datetime.now(timezone.utc).isoformat(),
                    'model': ai_model,
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
        # The fingerprint must move with the content, or installed apps that
        # trust the stamp never refetch the new brief.
        from data_fingerprint import stamp as stamp_fingerprint
        print(f"Data version bumped -> {version_doc['version']} "
              f"(fingerprint {stamp_fingerprint(version_doc)})")
    else:
        print('No new briefs.')

if __name__ == '__main__':
    main()
