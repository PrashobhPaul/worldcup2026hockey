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

    'S2H2': """Ireland won the highest-scoring match of this World Cup so far, and they had effectively won it by half-time. Jonathan Lynch opened in the 8th from open play and added a penalty-corner goal in the 12th; Matthew Nelson made it three in the 19th, and when Lynch completed his hat-trick in the 24th — his first three goals of the tournament, all inside twenty-four minutes — Ireland led by four against opponents who had barely settled.

Malaysia's response came almost entirely from the short corner: Azimuddin Kamaruddin in the 29th, Amirul Azahar in the 36th and Abu Kamal Azrai in the 41st, three penalty-corner goals that kept them in touching distance without ever threatening parity. Ireland's answer to the second of them was immediate — John McKee converted a corner of their own in the 37th and Nelson struck again in the 39th, so Azrai's goal only trimmed the third-quarter score to 6-3. Benjamin Walker's field goal in the 54th settled the afternoon, and Faizal Saari's reply in the 55th, Malaysia's only goal from open play, fixed the final margin at 7-4.

Eleven goals, and the shape of them tells the story of both campaigns. Ireland scored five from open play through three different scorers — the running, carried threat that Malaysia's pool opponents also found, with Malaysia now on twenty conceded across four matches. Malaysia's three corner goals confirm that their set piece travels; nothing else did. For Ireland, who left Pool C with a four-one win over South Africa and two two-goal defeats, this is the day their finishing finally caught up with their chances, and Lynch — scoreless in the pool — leaves it with a hat-trick completed inside the first half.""",

    'S2F2': """Spain beat a previously unbeaten Germany by finding two moments in a match of almost perfect equilibrium — possession fifty-one per cent to forty-nine, shots seven to six, circle entries twenty-one to twenty. Justus Weigand gave Germany the lead from open play in the 26th, reward for the sharper pressing of the first half, and it lasted four minutes: José Basterra levelled from a penalty stroke in the 30th, on the stroke of half-time.

The winner came in the 50th — Basterra again, this time from open play, a brace that contains Spain's entire output. No goal came from a penalty corner at either end, and the discipline matched the scoreline's restraint: not a single card in the match. Germany kept pushing after falling behind, but their twenty circle entries produced only six shots all game, and the equaliser never came.

The result reshapes Pool F. Spain carry a narrow defeat to Australia forward from Stage 1, and beating Germany puts them level on three points in a pool nobody has yet escaped from — even Belgium, pointless so far, still have six to play for. Germany's unbeaten run ends at four matches, and the pattern beneath it is worth noting: five of their eight tournament goals came in one afternoon against Malaysia, and in their three matches against everyone else they have scored exactly once per game. The finishing, not the defence, is what the rest of Stage 2 will examine.""",

    'S2F1': """Australia remain the only unbeaten side in Pool F after an evening in Brussels that finished all square and could barely have been closer — circle entries twenty-one apiece, Australia edging possession fifty-two per cent to forty-eight and shots nine to six. Tom Craig gave the Kookaburras the lead in the 24th from open play, finishing the best move of a first half they controlled without ever dominating.

Belgium's reply came from the set piece: Tom Boon converted a penalty corner in the 38th, early in the third quarter, in a match that never produced a card and never quite lost its balance. Australia's nine shots to six were the greater volume, but neither side could find a second goal, and two of the tournament's heavyweights settled for a point apiece.

The point suits Australia far more. With the win over Spain carried forward from Stage 1 they top Pool F on four points, unbeaten across four matches this tournament; Belgium, carrying the one-goal defeat to Germany, hold a single point from their two counted results with only the Spain fixture left to change it. Even a win there leaves the world's number-one side needing results elsewhere — a semi-final place is no longer in Belgium's own hands.""",

    'S2G1': """Wales led this match twice and still lost it by five, which is the truest measure of what New Zealand did to them after the first quarter. Jolyon Morgan scored from open play in the 8th, and when James Hickson's penalty corner levelled it in the 22nd, Morgan answered within a minute — his second, in the 23rd, had Wales in front again.

The response was six unanswered goals in thirty-three minutes. Hickson levelled once more in the 25th from open play, Scott Boyde — shown a green card in the 22nd — turned the match properly in the 32nd, and Kane Russell's penalty corner in the 35th gave New Zealand a lead they never looked like surrendering. Finn Ward in the 41st, Sam Lane in the 48th and Hickson's third in the 56th completed the rout: a hat-trick opened by a corner and closed by two field goals, with five different New Zealand scorers behind it.

The numbers underneath are lopsided in a way Pool A never let New Zealand show: sixty-five per cent of possession, eleven shots to six, forty circle entries to seventeen, and both penalty corners converted. With the two-goal win over Japan carried forward, the Black Sticks top Pool G on six points. For Wales the tournament's pattern hardens — twenty-one conceded across four matches now — and Morgan's brace was the only reward from a morning that began exactly the way they must have dreamed it.""",

    'S2G2': """Japan led this match by two goals inside the opening quarter — one more than they had managed in their entire pool campaign — and still ended the afternoon with the tournament's familiar result. Hyota Yamada converted a penalty corner in the 7th and Kaito Tanaka finished from open play in the 15th, and a Pakistan side that had left Pool D without a win was chasing again.

The chase is what Pakistan will remember. Waheed Ashraf Rana pulled one back from open play in the 22nd, levelled from Pakistan's only penalty corner of the match in the 32nd, and a minute later Muhammad Hammadudin — shown a green card back in the 19th — put them in front in the 33rd. Koji Yamasaki's corner dragged Japan level in the 36th, but Hannan Shahid's field goal in the 41st, the fourth goal of a breathless third quarter, stood as the winner. Pakistan defended the last quarter through Muhammad Abdullah's yellow card in the 44th and a late green for Sufyan Khan, and held.

The sheet split almost evenly — possession fifty apiece, circle entries twenty-four to twenty-two in Japan's favour, shots twelve to nine to Pakistan — and the difference was ruthlessness at the set piece and in front of goal: three penalty corners in the match, three goals. It is Pakistan's first win of this World Cup, from an attack that has now scored three or more in three consecutive matches, and Rana's brace led it. Japan's record now reads four defeats from four — with three of their four tournament goals scored on the day it finally was not enough.""",
}

REASONS = {
    'S2H1': "France left Pool B unbeaten against Germany and Malaysia and lost to Belgium by a single goal, conceding seven in three matches against far stronger opposition than South Africa met. South Africa bring one point from three into Stage 2, with nine conceded in the pool — seven of them to Spain and Ireland — and the Cassiem set-piece threat as their clearest route to goal. The steadier pool evidence favours France.",

    'S2H2': "Ireland took three points from Pool C, losing by two to both Australia and Spain either side of a three-goal win over South Africa. Malaysia left Pool B with one point and thirteen conceded in three matches — though seven scored, including three against Belgium, show a genuine attacking threat. Expect goals at both ends; a Malaysian defence conceding more than four a match is the softer one, and that margin favours Ireland.",

    'S2F2': "Germany came through Pool B unbeaten with seven scored and only two conceded in three matches, the win over Belgium built on exactly the kind of defending this fixture rewards. Spain won twice by 3-1 in Pool C either side of a single-goal loss to Australia, so both arrive in form — but Spain's chances have come at a goal-a-game cost, and in a match likely to be tight and low-scoring, the side that has defended better all tournament is favoured.",

    'S2F1': "Belgium scored eight goals in three pool matches — three past France, five past Malaysia — and their only defeat was by a single goal to Germany. Australia took seven points from Pool C unbeaten, but two of those matches brought one goal or fewer and they dropped points to the pool's lowest seed. Between the tournament's most productive attack and its steadiest points-gatherer, the hosts' extra cutting edge tips a very close call — with a draw the likeliest single alternative.",

    'S2G1': "New Zealand's pool record reads worse than it was: both defeats came against top-seven opposition, and in their one match against a side outside that bracket they won 2-0 without conceding. Wales scored six in Pool D — three in one afternoon against Pakistan — but conceded fourteen, eight of them to England, and are yet to shut out anyone. Against the first non-elite attack of their tournament, New Zealand are favoured with something to spare.",

    'S2G2': "Pakistan left Pool D with a single point, but their attack travelled: seven scored in three matches against England, India and Wales, three of them in each of the last two. Japan's pool brought three defeats and one goal, with shut-outs conceded to Argentina and New Zealand. Both sides are winless — yet one has scored in every match this tournament and the other has barely scored at all, and that margin favours Pakistan.",

    'S2E1': "The Netherlands swept Pool A with three wins from three, twelve scored and three conceded — one of only two perfect records in the tournament. India took six points from Pool D, putting three past Wales and five past Pakistan, and their defeat to England came by two in a match they scored twice in. India's ten pool goals say they will create chances; the Dutch defence, breached once a game on average, says those chances stay scarce. The tournament's most complete side so far is favoured on the full sweep of the evidence.",
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
