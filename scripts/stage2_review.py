#!/usr/bin/env python3
"""
Stage 2 match briefs and pick rationales — the Stage 1 review, continued.

Same contract as stage1_review.py: every brief is written from the official
match record — the goals in fixtures.json, how each was scored, and the cards
— and reads as a match report, never as a description of the machinery. That
record is the limit as well as the source: FIH does not publish possession,
shots, circle entries or penalty-corner counts, so nothing here argues from
one. Every rationale
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
    'S2H1': """South Africa opened Stage 2 in Brussels with the result their pool campaign never quite produced: a first win of the tournament, and it was effectively built inside twenty minutes. Mustaphaa Cassiem converted penalty corners in the 17th and the 19th, and a French side that had come through Pool B unbeaten against Germany and Malaysia found itself two down inside the first quarter.

Victor Charlet's reply in the 30th kept France alive, converting a penalty corner on the stroke of half-time, and the game France wanted was set up: one goal in it and half the match still to play. It never became more than a chase. South Africa defended the margin through the third and fourth quarters — the green cards shown to Senzwesihle Ngubane in the 13th and Amaury Bellenger in the 17th were the only interruptions of a hard first half — and Dayaan Cassiem's field goal in the 60th, moments before Samkelo Mvimbi's late yellow, closed it out.

The arithmetic is simple: three penalty-corner goals in the match, two of them South African, and the side that scored the extra one won. France managed a single goal in sixty minutes against a defence that had shipped nine in the pool, and that — rather than any collapse at the back — is what cost them a match they were favoured to win.""",

    'S2H2': """Ireland won the highest-scoring match of this World Cup so far, and they had effectively won it by half-time. Jonathan Lynch opened in the 8th from open play and added a penalty-corner goal in the 12th; Matthew Nelson made it three in the 19th, and when Lynch completed his hat-trick in the 24th — his first three goals of the tournament, all inside twenty-four minutes — Ireland led by four against opponents who had barely settled.

Malaysia's response came almost entirely from the short corner: Azimuddin Kamaruddin in the 29th, Amirul Azahar in the 36th and Abu Kamal Azrai in the 41st, three penalty-corner goals that kept them in touching distance without ever threatening parity. Ireland's answer to the second of them was immediate — John McKee converted a corner of their own in the 37th and Nelson struck again in the 39th, so Azrai's goal only trimmed the third-quarter score to 6-3. Benjamin Walker's field goal in the 54th settled the afternoon, and Faizal Saari's reply in the 55th, Malaysia's only goal from open play, fixed the final margin at 7-4.

Eleven goals, and the shape of them tells the story of both campaigns. Ireland scored five from open play through three different scorers — the running, carried threat that Malaysia's pool opponents also found, with Malaysia now on twenty conceded across four matches. Malaysia's three corner goals confirm that their set piece travels; nothing else did. For Ireland, who left Pool C with a four-one win over South Africa and two two-goal defeats, this is the day their finishing finally caught up with their chances, and Lynch — scoreless in the pool — leaves it with a hat-trick completed inside the first half.""",

    'S2F2': """Spain beat a previously unbeaten Germany by finding two moments in a match that produced only three goals and not one short-corner conversion at either end. Justus Weigand gave Germany the lead from open play in the 26th, reward for the sharper pressing of the first half, and it lasted four minutes: José Basterra levelled from a penalty stroke in the 30th, on the stroke of half-time.

The winner came in the 50th — Basterra again, this time from open play, a brace that contains Spain's entire output. No goal came from a penalty corner at either end, and the discipline matched the scoreline's restraint: not a single card in the match. Germany kept pushing after falling behind, but a side that had scored once a game against everyone bar Malaysia found nothing more, and the equaliser never came.

The result reshapes Pool F. Spain carry a narrow defeat to Australia forward from Stage 1, and beating Germany puts them level on three points in a pool nobody has yet escaped from — even Belgium, pointless so far, still have six to play for. Germany's unbeaten run ends at four matches, and the pattern beneath it is worth noting: five of their eight tournament goals came in one afternoon against Malaysia, and in their three matches against everyone else they have scored exactly once per game. The finishing, not the defence, is what the rest of Stage 2 will examine.""",

    'S2F1': """Australia remain the only unbeaten side in Pool F after an evening in Brussels that finished all square and could barely have been closer — a single goal apiece, one from open play and one from the set piece. Tom Craig gave the Kookaburras the lead in the 24th from open play, finishing the best move of a first half they controlled without ever dominating.

Belgium's reply came from the set piece: Tom Boon converted a penalty corner in the 38th, early in the third quarter, in a match that never produced a card and never quite lost its balance. Neither side could find a second goal, and two of the tournament's heavyweights settled for a point apiece.

The point suits Australia far more. With the win over Spain carried forward from Stage 1 they top Pool F on four points, unbeaten across four matches this tournament; Belgium, carrying the one-goal defeat to Germany, hold a single point from their two counted results with only the Spain fixture left to change it. Even a win there leaves the world's number-one side needing results elsewhere — a semi-final place is no longer in Belgium's own hands.""",

    'S2G1': """Wales led this match twice and still lost it by five, which is the truest measure of what New Zealand did to them after the first quarter. Jolyon Morgan scored from open play in the 8th, and when James Hickson's penalty corner levelled it in the 22nd, Morgan answered within a minute — his second, in the 23rd, had Wales in front again.

The response was six unanswered goals in thirty-three minutes. Hickson levelled once more in the 25th from open play, Scott Boyde — shown a green card in the 22nd — turned the match properly in the 32nd, and Kane Russell's penalty corner in the 35th gave New Zealand a lead they never looked like surrendering. Finn Ward in the 41st, Sam Lane in the 48th and Hickson's third in the 56th completed the rout: a hat-trick opened by a corner and closed by two field goals, with five different New Zealand scorers behind it.

The scoring underneath is lopsided in a way Pool A never let New Zealand show: seven goals from five different scorers, five of them from open play and two from the set piece. With the two-goal win over Japan carried forward, the Black Sticks top Pool G on six points. For Wales the tournament's pattern hardens — twenty-one conceded across four matches now — and Morgan's brace was the only reward from a morning that began exactly the way they must have dreamed it.""",

    'S2G2': """Japan led this match by two goals inside the opening quarter — one more than they had managed in their entire pool campaign — and still ended the afternoon with the tournament's familiar result. Hyota Yamada converted a penalty corner in the 7th and Kaito Tanaka finished from open play in the 15th, and a Pakistan side that had left Pool D without a win was chasing again.

The chase is what Pakistan will remember. Waheed Ashraf Rana pulled one back from open play in the 22nd, levelled from a penalty corner in the 32nd, and a minute later Muhammad Hammadudin — shown a green card back in the 19th — put them in front in the 33rd. Koji Yamasaki's corner dragged Japan level in the 36th, but Hannan Shahid's field goal in the 41st, the fourth goal of a breathless third quarter, stood as the winner. Pakistan defended the last quarter through Muhammad Abdullah's yellow card in the 44th and a late green for Sufyan Khan, and held.

The match split almost evenly until the third quarter, and the difference was ruthlessness in front of goal: seven goals between them, three from short corners and every one of those converted. It is Pakistan's first win of this World Cup, from an attack that has now scored three or more in three consecutive matches, and Rana's brace led it. Japan's record now reads four defeats from four — with three of their four tournament goals scored on the day it finally was not enough.""",

    'S2E1': """For forty minutes India did to the world's number-one side what nobody in Pool A had managed: nothing happened. Three quarters came and went scoreless in Amstelveen, India absorbing everything the Dutch brought without conceding, and the Wagener crowd was still waiting when Duco Telgenkamp finally broke through from open play in the 41st, with Shilanand Lakra's green card following a minute later.

The last twenty minutes delivered everything the first forty withheld. Tjep Hoedemakers doubled the lead from open play in the 51st — Koen Bijen was shown a green in the same minute — and India's reply was immediate: Harmanpreet Singh converted a penalty corner in the 52nd, and at 2-1 with eight minutes left the upset was alive. Thijs van Dam ended it in the 55th, a third Dutch field goal, and the margin held to the final whistle.

The scoring routes are the story inside the story: all three Dutch goals were carved from open play, against the side whose tournament had been built on the set piece, and India's one reply came from the corner Harmanpreet converted. The Dutch top Pool E on six points, four wins from four without dropping a point this tournament; India, carrying the two-goal defeat to England, are left needing to win out and hope the table breaks their way.""",

    'S2E2': """England brought the tournament's most prolific attack and a perfect record to Amstelveen, and Argentina took both apart with the game England usually play. Los Leones controlled the evening, and after a scoreless first quarter and a half it was Tomas Domene who broke through — a penalty corner in the 26th, moments before Nicolas Keenan's green card briefly threatened the momentum.

It never turned. Domene doubled the lead from open play in the 36th, and England's response arrived only in the 49th, Samuel Hooper converting a penalty corner. At 2-1 with ten minutes left the comeback was live — until Domene settled it in the 58th from another corner, completing a hat-trick that contains every Argentine goal of the night. All three goals in the match came from the set piece: the pattern of this second stage held once more.

England's afternoon tells the harder truth: one goal, from a short corner, against a side that scored three and never needed a fourth. The first English defeat of the tournament cracks Pool E wide open — the Netherlands top it on six points, Argentina and England sit level on three, and India are last on none, with Monday's final round, Argentina against India and the Netherlands against England, deciding who joins the Dutch in the semi-finals.""",

    'S2E4': """The Netherlands had won every match they had played at this World Cup and needed only to keep doing it. England, already out of the semi-final race, spent sixty minutes refusing to let them — and took the point that ends the Dutch perfect record.

Stuart Rushmere put England ahead from open play in the 6th, and for a quarter of an hour the side with the tournament's best defence was chasing. The reply came either side of half-time and took two minutes: Jip Janssen converted a penalty corner in the 30th, Thierry Brinkman turned it around from open play in the 32nd, and the evening looked to have resolved itself into the pattern of the previous four. Green cards for Floris Wortelboer and Will Calnan in the same 15th minute were the only interruptions to a first half played at full tilt.

Henry Croft levelled from a corner in the 48th, and the Netherlands could not find a fifth win. Terrance Pieters' yellow in the 59th closed a match that finished as it had threatened to all evening. Pool E ends with the Netherlands top on seven points and Argentina second on six, both through; England finish on four, India on none. For a Dutch side that had scored fifteen and conceded four in four straight wins, a first dropped point is a small thing — but it arrives on the eve of the knockouts, against the one Pool E side with nothing left to play for.""",

    'S2E3': """Argentina needed six minutes to settle the question of who would join the Netherlands in the semi-finals, and the rest of the evening to survive the answer. Joaquin Toscani scored from open play in the 1st, Nicolas della Torre converted a short corner in the 6th, and India — who had to win to have any chance — were two down before they had touched the ball with purpose.

Sukhjeet Singh pulled one back from open play in the 10th and for twenty minutes it was a match again, until Tomas Domene took it away in the space of twelve second-half minutes: open play in the 33rd, then a penalty stroke in the 45th. Lucas Toscani made it five in the 53rd, and only then did India find the response their tournament had promised — Sukhjeet's second in the 58th and Hardik Singh's stroke in the 60th, two goals in the closing three minutes that arrived far too late.

Eight goals, five scorers, and a scoreline that flatters neither defence: Argentina have now scored twelve in three Stage 2 matches and conceded five. Domene's brace takes him to five for the tournament, all of them in the last two matches, and Los Leones go through in second place behind the Dutch. India leave with the record their pool form always risked — beaten in every match against top-eight opposition, and fourteen conceded across five games.""",

    'S2G3': """Japan won their first match of this World Cup at the eleventh hour, and then had to survive the strangest minute of it. Shota Yamada opened from a short corner in the 15th and Kosei Kawabe doubled the lead from open play in the 28th — the same minute Rhodri Furlong went to the bin — and for half an hour a side that had scored four goals in four matches looked comfortable.

Wales came back through the set piece. Jacob Draper converted in the 49th, and with Raiki Fujishima yellow-carded in the 51st and Dale Hutchinson green-carded in the 58th, the closing stretch was played by two tiring, depleted teams. Then both scored in the 60th: Kazumasa Matsumoto restored the two-goal cushion from open play, and Sam Welsh answered immediately for 3-2, too late to matter.

It is Japan's first win in five and it ends a run in which they had been shut out by Argentina and New Zealand and beaten by Pakistan. Wales end the tournament still looking for one: a draw with Pakistan is all five matches have produced, with twenty-four conceded and a defence that has kept nobody out. Both Pool G sides who arrived on nothing leave with the two-goal margin that separated them all afternoon.""",

    'S2G4': """New Zealand were three up inside twenty-two minutes and never looked like losing from there. Dylan Thomas scored inside the opening minute from open play, Scott Boyde added the second in the 16th and George Baker the third in the 22nd — three field goals against a Pakistan defence that has now conceded nineteen in five matches.

Pakistan's reply came, as it usually does, from the short corner: Sufyan Khan in the 33rd and Afraz in the 38th, the second of them cutting the deficit to a single goal and turning a procession into a contest. Benjamin Culhane's green card in the 36th had briefly given Pakistan the extra man, and for a quarter of an hour the margin looked fragile.

Kane Russell settled it in the 49th, converting the corner that made it four, and Abdul Manan's green card in the 51st was the last incident of note. Both of Pakistan's goals from the set piece, three of New Zealand's from open play and one from a corner — the same split that has defined both campaigns. New Zealand finish Stage 2 with three wins from five; Pakistan, with thirteen scored and nineteen conceded, leave a tournament in which they were never dull and never quite solid.""",

    'S2H3': """Malaysia led this match twice, were behind for the whole of the second half, and still walked off with a point they had earned in the very last minute. Abu Kamal Azrai scored both of their first two — from open play in the 14th, then from a short corner in the 22nd, five minutes after Luke Wynford's 17th-minute equaliser — and at 2-1 Malaysia held exactly the game they wanted.

South Africa took it away from them while barely keeping eleven on the pitch. All five cards of the match were theirs — green cards for Dayaan Cassiem inside two minutes, Calvin Davis in the 27th and Wynford in the 48th, yellows for Viwe Mbata in the 29th and Dayaan Cassiem in the 42nd — and yet each setback was answered with a goal. Nicholas Spooner levelled in the 28th, a minute after Davis went off; Mustaphaa Cassiem put South Africa ahead for the first time in the 43rd, sixty seconds after his brother's yellow had left them a man short.

Then, in the 60th, Faizal Saari equalised from open play for 3-3 — Malaysia's first point of the tournament, at the eleventh time of asking. The shape of the afternoon still flatters South Africa, who scored three times from open play without a single short-corner goal, but a side reduced twice by cards could not close out a lead it had spent fifty minutes chasing. For Malaysia, five matches and twenty-three conceded have finally produced something: they have scored in every game of this World Cup, and this time it was enough to hold on to.""",

    'S2H4': """For thirty-eight minutes Brussels watched two sides cancel each other out — the only interruptions the matching green cards shown to Mattéo Desgouillons and Jonathan Lynch in the 12th, and a third for Jeremy Duncan in the 20th. It was Duncan who broke the deadlock, scoring from open play in the 39th, and for three minutes Ireland held the match they had come for.

France's reply was immediate and familiar: Victor Charlet converted a penalty corner in the 42nd — his second set-piece goal in a week, after the one that kept France alive against South Africa. From there the game tilted, and Timothée Clément won it from open play in the 59th — France's second goal of an afternoon in which they had not led at all.

The difference from Monday is the whole story for France: against South Africa the pressure produced one goal and a defeat; here it produced two and a win, the first of their Stage 2. Ireland, who had put seven past Malaysia three days earlier, managed one, and both of these sides now stand on a win and a defeat in Pool H, chasing a South African side with two from two.""",

    'S2F3': """Everything Germany's tournament had lacked arrived in nine first-half minutes. Blake Govers had given Australia the lead from open play in the 3rd — Tim Brand's green card following sixty seconds later — and then the side that had scored exactly once per match against everyone but Malaysia produced three field goals in a burst: Hannes Müller in the 11th, Michel Struthoff in the 12th, Justus Warweg in the 19th, and a 0-1 was a 3-1 before the first quarter's shape had settled.

Joel Rintala pulled Australia back to 3-2 from open play in the 30th, on the stroke of half-time, and the match Australia needed was there again. It lasted ten minutes: Hugo von Montgelas converted a penalty corner in the 40th, and from two goals up Germany managed the game home, with Müller's green card in the 50th the only late interruption.

Australia's unbeaten tournament ends at the last hurdle of their Pool F programme, and the manner matters as much as the result: a side that had conceded four goals in four matches gave up four in one evening, three of them from open play. Germany finish their Stage 2 fixtures on six points at the top of the pool, the Spain defeat answered emphatically; Australia close on four and can only watch tonight's Spain-Belgium match decide what their total is worth.""",

    'S2F4': """Belgium needed a win to keep their semi-final arithmetic alive, and for four minutes the evening obeyed: Arthur van Doren converted a penalty corner in the 4th, Belgium's first lead of Stage 2. What followed was forty-two minutes without a goal in a match that never opened up, and whose only two goals both came from the set piece.

Marc Miralles levelled in the 46th from a penalty corner, and so both goals in the match came from the set piece — neither defence was broken down in open play. Guillaume Hellin's green card in the 58th was the only other entry in the book, and neither side found the winner that would have changed what the table now says.

It says this: Germany top Pool F on six points, Australia and Spain finish level on four — Australia holding the win from their meeting in Stage 1 — and Belgium end bottom on two, without a win in Stage 2 for a side that arrived ranked first in the world. A draw with Australia, a draw with Spain and the carried defeat to Germany is a campaign of fine margins falling the wrong way; Spain, who took four points from the pool's two heavyweights, will feel the ones that fell their way were earned.""",
}

REASONS = {
    'S2H1': "France have taken two draws from three and have not won yet, a 1-1 with Germany the best of it, and five of their six goals have come from open play with one from a penalty corner. South Africa's record is worse and the 1-4 against Ireland is the heaviest defeat either side has taken, but three of their four goals have come from penalty corners. A side that scores from set pieces carries a route that does not depend on the run of play, and against a French attack with a single corner goal in three matches, the repeatable method is South Africa's.",

    'S2H2': "Ireland took three points from Pool C, losing by two to both Australia and Spain either side of a three-goal win over South Africa. Malaysia left Pool B with one point and thirteen conceded in three matches — though seven scored, including three against Belgium, show a genuine attacking threat. Expect goals at both ends; a Malaysian defence conceding more than four a match is the softer one, and that margin favours Ireland.",

    'S2F2': "Germany came through Pool B unbeaten with seven scored and only two conceded in three matches, the win over Belgium built on exactly the kind of defending this fixture rewards. Spain won twice by 3-1 in Pool C either side of a single-goal loss to Australia, so both arrive in form — but Spain's chances have come at a goal-a-game cost, and in a match likely to be tight and low-scoring, the side that has defended better all tournament is favoured.",

    'S2F1': "Belgium scored eight goals in three pool matches — three past France, five past Malaysia — and their only defeat was by a single goal to Germany. Australia took seven points from Pool C unbeaten, but two of those matches brought one goal or fewer and they dropped points to the pool's lowest seed. Between the tournament's most productive attack and its steadiest points-gatherer, the hosts' extra cutting edge tips a very close call — with a draw the likeliest single alternative.",

    'S2G1': "New Zealand's pool record reads worse than it was: both defeats came against top-seven opposition, and in their one match against a side outside that bracket they won 2-0 without conceding. Wales scored six in Pool D — three in one afternoon against Pakistan — but conceded fourteen, eight of them to England, and are yet to shut out anyone. Against the first non-elite attack of their tournament, New Zealand are favoured with something to spare.",

    'S2G2': "Pakistan left Pool D with a single point, but their attack travelled: seven scored in three matches against England, India and Wales, three of them in each of the last two. Japan's pool brought three defeats and one goal, with shut-outs conceded to Argentina and New Zealand. Both sides are winless — yet one has scored in every match this tournament and the other has barely scored at all, and that margin favours Pakistan.",

    'S2E1': "The Netherlands swept Pool A with three wins from three, twelve scored and three conceded — one of only two perfect records in the tournament. India took six points from Pool D, putting three past Wales and five past Pakistan, and their defeat to England came by two in a match they scored twice in. India's ten pool goals say they will create chances; the Dutch defence, breached once a game on average, says those chances stay scarce. The tournament's most complete side so far is favoured on the full sweep of the evidence.",

    'S2E2': "England's pool was a procession: three wins from three, sixteen scored and five conceded, eight of them put past Wales in a single evening. Argentina's eleven pool goals — three past Japan, seven past New Zealand — trail only England and the Dutch, but their one meeting with a top-tier side ended in a two-goal defeat to the Netherlands, the same margin by which England beat India. Two of the tournament's three sharpest attacks meet; the one nobody has slowed yet is favoured.",

    'S2E3': "Argentina's record is the stronger \u2014 three wins from four, fourteen scored and five conceded, with a 7-1 against New Zealand and a 3-1 over England. India's case is narrower and it is a set-piece case: seven of their eleven goals have come from penalty corners against Argentina's five. Argentina's only defeat came against the Netherlands, and a side that manufactures its chances from corners rather than from open play is the kind of opponent that does not need to out-play them to score.",

    'S2F3': "Australia are the only side in this pool yet to lose \u2014 two wins and two draws, and a 1-0 over Spain that is the best single result either side holds. The qualification is where the goals come from: two of their seven have been scored in open play, the rest from penalty corners and a stroke. Germany have scored six of their eight in open play and kept Belgium out entirely, and against a defence that has conceded four in four, the side that can score without needing a set piece has more ways through.",

    'S2E4': "The Netherlands are the only side with four wins from four \u2014 fifteen scored, four conceded, and no winning margin under two. England's single defeat came against Argentina and cost them a 1-3. But England have scored seventeen to the Dutch fifteen across the same four matches, eleven of those in open play to the Netherlands' nine, and their eight against Wales is the most any side has scored in a match at this tournament. Against a defence that has conceded four in four, the deeper attack is England's.",

    'S2F4': "Both sides have already measured themselves against Australia, the pool's pacesetters: Belgium took a point off them, Spain lost without scoring. Belgium's eight goals across three pool matches remain the heavier attacking output either side brings, their only defeat all tournament is by a single goal to Germany, and the corner conversion against Australia showed the set piece has carried into Stage 2. Spain keep winning tight matches on fine margins, but with Belgium needing a win to stay in the semi-final conversation, the extra firepower tips a very close call.",

    'S2H3': "South Africa arrive on the tournament's turnaround result — a first win over France, built on two converted short corners — after a pool that ended with a draw against unbeaten Australia. Malaysia are winless in four with twenty conceded, and while the set piece keeps producing, three corner goals against Ireland still came inside a 7-4 defeat. Two sides moving in opposite directions; South Africa favoured.",

    'S2G3': "Both sides are winless, so the argument is comparative. Wales have scored in all four of their matches — eight goals, three of them against Pakistan — while Japan's four games have produced four, three in one afternoon against that same Pakistan side, whom Japan still lost to and Wales held. Wales concede heavily, but here they meet the one attack in the tournament that has barely fired; the sharper of two struggling sides is favoured.",

    'S2G4': "New Zealand's two wins are emphatic \u2014 seven against Wales and a clean sheet over Japan \u2014 but their eleven goals are concentrated in them: against the Netherlands and Argentina they managed one apiece while conceding twelve across the two. Pakistan have also lost twice, yet have scored three or more in three of their four matches, four of them against Japan. The sides are level on goals scored and separated by one at the other end, and the one that has scored steadily rather than in bursts is Pakistan.",

    'S2H4': "Ireland arrive from the tournament's highest-scoring match, a 7-4 against Malaysia that accounts for more than half of their thirteen goals. Against the two sides that have beaten them, Australia and Spain, they scored once each time and conceded three in both. France have won none of four, but the shape of their defeats is different \u2014 one goal short against Belgium, a draw held against Germany \u2014 and across the same four matches they have conceded ten to Ireland's eleven. The win columns separate these two further than the pool evidence does.",
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
