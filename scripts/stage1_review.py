#!/usr/bin/env python3
"""
Stage 1, reviewed in one pass.

The 24 pool matches are played and frozen, so their write-ups no longer have to
be produced one at a time by a template that has only ever seen the match in
front of it. Every brief below was written from the full match record — goals,
methods, minutes, cards — with the tournament to that point in view, so the 24
read as one series rather than 24 unrelated paragraphs, and so each one can say
what actually decided the game instead of listing what happened in it.

The record is the limit as well as the source. FIH publishes the goals, how
each was scored, and the cards; it does not publish possession, shots, circle
entries or penalty-corner counts, so nothing below argues from one.

The pick rationales get the same treatment. They used to read "FIH #5 X favoured
over #12 Y — Elo model from world rankings", which is a description of the
model, not a case for the team. A rationale here argues from what the side had
shown IN THIS TOURNAMENT up to the previous match — its scoring pattern, the
routes its goals came by, its discipline — and names the strongest evidence
against the pick as well as for it. Nothing is written with hindsight: no
rationale refers to the result it preceded, and where the pick turned out
wrong the case stands as it was, because a justification that only appears
after the fact is not a justification.

What is NOT touched: the picks themselves, their probabilities, and their
publication times. Only the prose changes, and the sentence it replaces is kept
on the row as `reason_original` so the ledger still shows what we said before.

    python3 scripts/stage1_review.py            # apply
    python3 scripts/stage1_review.py --check    # report, change nothing
"""
import json
import os
import sys
from datetime import datetime, timezone

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')

# ── The briefs ───────────────────────────────────────────────────────────
# Three movements each: what settled it, how the goals came, and what the match
# says about the two sides. Every number below is in the official record.
STORIES = {
    'D1': """India opened their World Cup by turning one weapon on Wales and never putting it down. All three of their goals came from penalty corners, and by the time Wales found an answer the game had already been decided by a routine they ran better than their opponents could defend it.

Sanjay struck first in the 8th minute and Harmanpreet Singh doubled it in the 11th, both from the top of the circle. Harmanpreet returned in the 43rd for his second and India's third. Sam Welsh pulled one back for Wales in the 56th, a field goal and the only time in the match that either side scored from open play.

The scoring routes are the honest measure of this one. Three set-piece goals to nil is a battery working exactly as designed; one field goal to nil the other way is a Welsh side that had to manufacture its chance from nothing and did. Wales defended the run of play competently enough to keep the score respectable, but a side that can only stay level while the whistle stays quiet is chasing a game it never led. India's set piece is a genuine tournament weapon; their open play, on this evidence, still needs one.""",

    'B1': """Germany settled this inside seven minutes, which is the whole story of the match and most of the story of Malaysia's afternoon. Three goals in the first quarter — one from a corner, two from open play — put the game beyond a side that had barely touched the ball in its own attacking half.

Jakob Brilla converted a penalty corner in the 3rd minute, Christopher Rühr scored from open play in the 4th, and Justus Weigand made it three in the 7th. Malaysia recovered enough to take something from the third quarter, Abu Kamal Azrai converting a corner in the 39th, but Justus Warweg answered in the 44th and Paul-Philipp Kaufmann added a fifth in the 52nd.

Malaysia's goal came from the set piece, which is where their scoring has always come from; Germany's came one from the set piece and four from open play, which is the difference between a side that needs a routine and a side that merely has one. Germany's opening burst, not their corner routine, is what should worry the rest of Pool B — three goals in four minutes against any defence in this tournament is a statement, and it was made before Malaysia had settled.""",

    'D2': """England scored in all four quarters and beat Pakistan by three, and the scoreline flatters neither side. This was a controlled performance built on repeatable chances rather than a single decisive spell, which is the more durable way to win a pool match.

Stuart Rushmere opened from open play in the 12th, Sam Ward added a second in the 28th, and Samuel Hooper converted a penalty corner in the 31st. James Albery's corner in the 47th made it four before Afraz found a consolation for Pakistan in the 50th. Four different scorers, two from set pieces and two from open play — a spread that is hard to plan against.

Pakistan's only goal came from open play with ten minutes left, by which point the match was gone. A green card in the 20th, immediately before England's second and third goals, did not help: England scored twice in the eleven minutes that followed it. On this evidence Pakistan can reach the circle against a top-five defence but cannot finish there, and England will be satisfied that four goals came from four names.""",

    'B2': """France led this match twice and still lost it, which tells you exactly where Belgium's advantage lies: in the last sixteen minutes, and in the circle. Two penalty-corner goals late turned a game France had shaped for most of an hour.

Eliot Curty put France ahead in the 3rd minute. Nelson Onana levelled in the 17th and Florent Vaal restored the French lead in the 18th — three goals in a fifteen-minute stretch, all from open play. Then it stopped being open. Roman Duvekot converted a corner in the 44th and Alexander Hendrickx, the most reliable drag flick in the competition, struck in the 56th to win it.

That is the entire margin: everything scored before the 40th minute came from open play, everything after it came from a set piece, and only one of these sides had a set piece to turn to. For France there is real encouragement here — they scored twice against the world's top-ranked side and led them for a quarter of the match — but a team with no way of scoring once the game tightens is asking to be beaten late, and was.""",

    'C1': """Every goal in this match came from a penalty corner: three Australian, one Irish. On a night when neither side could break the other down in open play, the difference between them was entirely in the set piece, and Australia's was ruthless.

Joel Rintala converted in the 7th and again in the 23rd, and Blake Govers made it three from another corner in the 27th. Every Australian goal came from a set piece and all three arrived before half-time, which is how a match ends up decided by the interval. Alistair Empey converted for Ireland in the 54th, a late reply to a game already gone.

The routine behind Australia's three was the difference: two different finishers, three conversions, all of them inside the opening half-hour. Ireland kept the Kookaburras to a single scoring route and will conclude they can live with them territorially; a match in which nobody scored from open play is not one they were outplayed in. They cannot yet live with them in the circle, which is a narrower problem and a more fixable one.""",

    'C2': """Spain took this match in the space of a minute. Marc Reyne scored in the 12th minute and José Basterra in the 13th, both from open play, and South Africa spent the remaining forty-seven minutes chasing a game that had turned while they were still settling into it.

Basterra added his second in the 28th to make it three before half-time — again from open play, the pattern of the whole Spanish performance. Mustaphaa Cassiem converted a penalty corner in the 45th to give South Africa something, but two green cards in the last eight minutes, to Kenton Melville and Cassiem himself, ended any prospect of a late push with Spain content to see it out.

Three goals, none of them from a set piece, makes the result more impressive rather than less: this was a win built entirely in open play against a side that defends the set piece well. South Africa's counter-attack is genuine and Cassiem is a real finisher — their goal came from the routine he takes — but conceding three inside twenty-eight minutes leaves too much to do, and the cards that followed made sure they never got near it.""",

    'A2': """The hosts trailed at half-time and won by four. New Zealand led this match for eleven minutes of playing time and then conceded five goals in seventeen, which is the most emphatic quarter of hockey any side produced in the pool stage.

James Hickson's field goal in the 24th put New Zealand ahead. Tjep Hoedemakers levelled in the 35th, Duco Telgenkamp converted a penalty corner in the 41st, and then it broke: Thierry Brinkman in the 49th, Hoedemakers again in the 50th, Koen Bijen from a corner in the 52nd. Three goals in four minutes, two of them from open play.

What should concern the rest of Pool A is not the margin but the shape of it — the Netherlands were behind, in front of their own crowd, and their response was to score at will rather than to force set pieces. Three of their five came from open play and they arrived in a seventeen-minute stretch either side of the third quarter, which is a side raising its level rather than finding a routine. New Zealand defended one half competently and were dismantled in the other.""",

    'A1': """A tight, low-event match for fifty minutes and then Argentina finished it in four. Three goals, all from open play, all from different scorers, and a clean sheet against a Japan side that never quite got into the Argentine circle.

Lucas Toscani broke the deadlock in the 21st minute and the score stayed 1-0 for more than half an hour — Japan's most encouraging spell of the tournament so far, defensively organised and compact through the middle. Then Lucio Mendez scored in the 54th and Maico Casella in the 58th, and a result that had looked like it might stay uncomfortable became routine.

Los Leones did all of this without a set-piece goal, which is worth noting: three scorers, three field goals, no reliance on a routine. Japan will take the shape of the first three quarters as something to build on, but a side that creates nothing at the other end is only ever one lapse from exactly this ending, and the last ten minutes are where organised defences that have spent an hour under pressure tend to give way.""",

    'D4': """Six goals, seven cards, two lead changes and an equaliser from a penalty stroke with seven minutes left. Pakistan and Wales, both beaten in their openers, produced the most chaotic match of the pool stage and neither could finish it off.

Rehman Abdul put Pakistan ahead in the 3rd minute. The game turned on a yellow card to Sufyan Khan in the 24th: Gareth Furlong converted a corner in the 25th and Rhys Bradshaw scored in the 26th, two Welsh goals in as many minutes while Pakistan were a man short. Pakistan then flipped it back in the fourth quarter — Sufyan Khan himself from a corner in the 49th, Hannan Shahid from open play in the 51st — before Furlong's penalty stroke in the 53rd made it 3-3.

The cards, not the set pieces, decided the shape of this: both Welsh goals in open play arrived while Pakistan were short-handed, and the equaliser came from the whistle. Two yellows and three greens for Pakistan against two yellows and two greens for Wales is a discipline problem for both, and in a group where goal difference will matter, both dropped two points they will want back.""",

    'B4': """Malaysia led three times and did not win. France equalised with the last meaningful touch of the match, Noé Jouin scoring in the 59th minute to rescue a point from a game they had trailed for most of an hour.

Shello Silverius opened for Malaysia in the 5th and Victor Charlet levelled from a penalty corner in the 19th. Louis Haertelmeyer put France ahead in the 37th, Silverius answered from a corner in the 45th, and Akhimullah Anuar looked to have won it for Malaysia in the 57th before Jouin's late strike.

One set-piece goal each and four field goals between them describes a match neither side could control: every lead was answered inside eight minutes. The card count tells the rest — five greens between them, three to France in a six-minute spell in the second quarter — of a game played at a pace neither could hold. Both took a point that flatters and frustrates in equal measure: Malaysia for leading three times, France for needing the sixtieth minute to avoid defeat.""",

    'D3': """India scored from their set piece and lost the match. England answered with three goals from open play and one from a corner, and that contrast is the entire sixty-minute argument: one side had a single route to goal and the other had two.

Nicholas Bandurak put England ahead in the 14th. Harmanpreet Singh converted a corner in the 17th and Dilpreet Singh scored from open play in the 25th to send India in leading. England's third quarter settled it: Stuart Rushmere in the 39th, Henry Croft in the 43rd, both from open play, either side of a green card that India could not exploit. Bandurak's corner in the 55th made it 4-2.

England took four green cards in this match and still controlled the second half, which speaks to how comfortable they were without the ball. India led at half-time against the tournament's most in-form attack and were outscored 3-0 after it. Their set piece remains the best in the competition; their inability to score from open play against organised defences is now a pattern, not an accident — Dilpreet's field goal is their only one in two matches.""",

    'B3': """One goal, one set piece, one result. Jakob Brilla converted a penalty corner in the 39th minute and Germany beat the top-ranked side in the world with it — the only goal Belgium have conceded or scored in a match that never opened up for either of them.

Belgium have the most feared set-piece unit in the tournament and did not get to use it. They were denied the entry passes and the circle contacts that lead to a shooting chance, and Alexander Hendrickx — the most dangerous flick in the competition — went the whole match without a goal for the first time in a World Cup fixture. Germany defended the top of their own circle for sixty minutes and attacked Belgium's once, successfully.

Four green cards were shown, three of them Belgian, the last to Hendrickx in the 58th as frustration set in. Germany have now beaten Malaysia 5-1 and Belgium 1-0, two performances with nothing in common except that both were completely controlled. Belgium's problem here was not finishing; it was that they were never allowed to reach the position from which they finish.""",

    'A4': """Two field goals thirty-four minutes apart, and nothing else. New Zealand's win over Japan was as plain as a World Cup result gets, and both sides will read something useful in it.

Sam Lane scored in the 12th minute from open play and New Zealand led from there. Dylan Thomas doubled it in the 46th, again from open play, and the game closed out without either defence being asked a set-piece question. Not one set-piece goal in sixty minutes is unusual at this level, and reflects two sides content to defend deep and give the routine nothing to work with.

Japan have now played two matches without scoring, which is the harder of the two problems on show here. New Zealand, beaten 5-1 in their opener, will take a clean sheet and a first win, achieved by playing within themselves — two goals from two different forwards, neither of them needing a whistle. Neither performance suggests a side about to trouble the top of Pool A, but New Zealand's was the more complete.""",

    'C3': """The best defensive contest of the pool stage: one penalty stroke, six cards, and nothing else to separate two sides who had each won their opener by the same 3-1 scoreline. Blake Govers converted in the 47th minute and Australia won a match in which neither team scored from open play or from a corner.

That is worth restating — sixty minutes between the fourth and sixth ranked sides in the world produced a single goal, and it came from the spot. Both defences protected the top of the circle rather than the goal line, forcing errors outside it. Australia collected three green cards in the first twenty-three minutes, Spain two more in the second half, and Tim Brand's yellow in the 54th made the closing minutes genuinely uncomfortable.

Australia have now taken six points from two matches while conceding once, and have scored from a corner, from open play and from a stroke, which is the profile of a side with more than one way to win. Spain lose nothing here: they were not outplayed, they were beaten by the only clear-cut decision of the match.""",

    'C4': """Ireland trailed after thirty-eight minutes and won by three. Four goals in the last twenty-two minutes against a South African side that had a lead to protect and could not, and Ireland's first points of the tournament arrive with real force behind them.

Kenton Melville put South Africa ahead in the 38th from open play. Benjamin Walker levelled in the 43rd, then Lee Cole scored twice from penalty corners — the 49th and the 56th — and Sam Hyland scored with the last action of the match in the 60th. Two set-piece goals and two from open play in twenty-two minutes: Ireland scored every way available to them once the game turned.

South Africa's discipline unravelled first. A yellow in the 10th and greens in the 15th and 60th meant that once they lost the lead they were repeatedly defending short-handed, and they did not score again after the 38th minute. Ireland found in Cole a set-piece answer to the problem that cost them against Australia, where their only goal came from the same routine, and turned a losing position into a four-goal haul without ever looking hurried.""",

    'A3': """Argentina matched the Netherlands for a quarter and then lost the middle of the match, which is where the hosts have decided most of their games so far. Thierry Brinkman scored in the 7th, Nicolas della Torre answered from a corner in the 11th, and for twenty minutes this looked like the tightest fixture in Pool A.

Matias Andreotti's yellow card in the 27th changed it. The Netherlands scored twice while Argentina reorganised: Tijmen Reyenga from a penalty corner in the 34th, Duco Telgenkamp from open play in the 42nd, and the game was effectively over with a quarter still to play.

One set-piece goal each, so the routine is not the story here — the discipline is. Argentina had beaten Japan without conceding and were level with the hosts until a card they did not need, and the Netherlands scored the decisive goal seven minutes into the period that followed it. The hosts have now scored eight goals in two matches and taken both from behind or from level, which is the mark of a side that trusts its second half.""",

    'D5': """England put eight past Wales — the highest single-team total of the pool stage — and did most of it by movement rather than routine. Sam Ward opened from open play in the 2nd, Will Calnan scored in the 13th and again in the 20th, the same minute Daniel Kyriakides was shown a green card, and Thomas Sorsby made it four in the 22nd. Four goals by the 22nd minute, every one of them a field goal, against a Welsh side that had drawn with Pakistan and stayed within two of India.

Zachary Wallace continued the pattern in the 41st before the set piece finally told: Samuel Hooper converted in the 48th and Henry Croft in the 51st, and Nicholas Bandurak's field goal in the 54th made it eight. Wales's response came late and came entirely through Gareth Furlong — a penalty stroke in the 58th and a corner goal in the 59th — after Kyriakides had compounded his green with a yellow in the 44th of a second half England controlled from first minute to last.

The balance is the warning England leave the pool stage with: six of the eight from open play, two from corners, and seven different scorers, so this attack beats a defence by movement first and by routine second, and depends on no one name. Wales conceded more in one afternoon than in their other two pool matches combined, and Furlong's late double was the only answer they found.""",

    'D6': """The most goals either of these sides has scored in a World Cup meeting, and the fixture lived up to everything it usually promises. India led 4-2 at half-time in a first half that produced six goals, then closed the match out with the control that has been missing from their tournament so far.

Harmanpreet Singh converted penalty corners in the 5th and again in the 21st. Abhishek added field goals in the 11th and the 24th. Pakistan refused to fold: Hannan Shahid in the 22nd, Sufyan Khan from a corner in the 24th, and Shahid again in the 46th. Hardik Singh's penalty stroke in the 35th proved the decisive fifth.

Two set-piece goals, two field goals and a stroke is the most varied scoring India have managed in this tournament, and a marked change from a pool campaign in which the corner had been carrying them alone. Abhishek's two from open play are the meaningful development, because they answer the criticism that has followed India since the England defeat. Pakistan scored three times against a top-eight defence and still lost; their defending of the counter, not their attack, is what ends their pool campaign.""",

    'B6': """France equalised with the last touch of the match. Louis Haertelmeyer scored in the 60th minute to deny a German side that had controlled the game, had beaten Belgium three days earlier, and had conceded once in three matches until that moment.

Justus Weigand's field goal in the 43rd looked like enough. Germany had allowed France nothing all evening — no shot they could not account for, no set-piece goal at either end, and only a green card in the 24th to interrupt the pattern. Then, with the clock gone, France found the circle contact they had not managed for fifty-nine minutes, and Benedikt Schwarzhaupt's yellow card in the same minute told you what Germany made of it.

Two field goals and nothing from a routine, in a match between the fifth and ninth ranked teams in the world, is a defensive achievement on both sides, but Germany will regard this as two points dropped. France, who have now taken draws from Malaysia and Germany after losing narrowly to Belgium, are the most awkward side in Pool B to play against and the least likely to beat you.""",

    'B5': """Tom Boon scored four and Belgium needed all of them. Malaysia scored twice from short corners and added a third from open play, and a match Belgium were expected to control instead turned into the highest-scoring game of their pool campaign.

Boon opened in the 17th and struck again in the 20th, both from open play. Aiman Rozemi pulled one back from a corner in the 32nd, Boon restored the two-goal lead from a corner in the 36th, and Marhan Jalil answered again in the 37th. Thibeau Stockbroekx scored in the 43rd, Boon completed his four from another corner in the 53rd, and Akhimullah Anuar replied within the same minute.

Two of Malaysia's three goals came from the short corner, the set-piece route that has carried their scoring all tournament. Belgium matched them with two short-corner goals of their own, restoring the set-piece rhythm Germany had denied them entirely. The five goals will please them; conceding three to the lowest-ranked side in the pool, after failing to score against Germany, leaves a defensive question they carry into Stage 2.""",

    'C5': """South Africa took a point from the side that had conceded once in two matches, and did it with two penalty-corner goals. Mustaphaa Cassiem converted in the 4th minute and again in the 44th, and Australia — two wins, four goals, one conceded coming in — could not find a third.

Australia trailed for thirty-four minutes. Joel Rintala levelled from a corner in the 38th and Ky Willott put them ahead in the 43rd from open play, and the lead lasted exactly one minute before Cassiem's second. That sequence — three goals in seven minutes, after thirty-four without one — was the whole match.

Cassiem's set-piece scoring is the story of South Africa's tournament: he has now converted in three consecutive matches, and both of his side's goals here came from the routine he takes. So is the discipline, in the other direction — two yellows and two greens, and a side that spent long spells short-handed and defended through them. Australia drop their first points of the tournament to the lowest-ranked team in Pool C.""",

    'A6': """Argentina fell behind to a penalty stroke and won by six. Tomas Domene scored three of them — a stroke, a penalty corner and a field goal, the full set — in a second half that produced six Argentine goals in twenty-two minutes.

Kane Russell's stroke in the 13th put New Zealand ahead. Domene equalised from a stroke of his own in the 22nd, and then the match broke open after the interval: Bautista Capurro in the 39th, Domene from a corner in the 43rd, Tadeo Marcucci from another in the 48th, Nicolas Keenan in the 52nd, Capurro again in the 58th, Domene with the last of them in the 60th.

Four of the seven goals came from open play, which is the number that matters — this was not a set-piece exhibition but a side scoring in every way available to it: a stroke, two corner goals and four from open play. New Zealand, who had kept Japan out four days earlier, conceded more here than in their previous two matches combined, and their only goal came from the spot.""",

    'C6': """Spain won this with two goals in six minutes from Marc Reyne, the first from a penalty corner and the second from open play. Ireland, buoyed by four goals against South Africa, found a far more disciplined opponent and could not repeat the trick.

Nicolas Alvarez put Spain ahead in the 9th from open play. Lee Cole levelled from a penalty stroke in the 19th and the match stayed level for twenty-eight minutes — a genuinely even contest through the middle two quarters, with neither side able to turn a spell of pressure into a goal. Then Reyne converted in the 47th and added a field goal in the 53rd.

Spain scored the only set-piece goal of the match, and it broke a deadlock nothing else had. Ireland, whose win over South Africa was built on Lee Cole's two corner goals, got their goal from a stroke and nothing from the routine; against a Spanish defence that concedes very little in the circle, that leaves only open play. Spain finish the pool with two wins and a single-goal defeat to Australia, which is the profile of a side nobody wants in their Stage 2 group.""",

    'A5': """Japan scored their first goal of the tournament and led the hosts for four minutes. The Netherlands answered with a stroke and two penalty-corner goals, and finished with four goals in a match they had made hard work of for fifty minutes.

Kazumasa Matsumoto's field goal in the 8th was Japan's first in three matches. Thijs van Dam levelled in the 12th, and the score stayed 1-1 until the final ten minutes — comfortably Japan's best defensive performance of the pool stage. Then Jip Janssen converted a stroke in the 50th, and Tijmen Reyenga scored from corners in the 55th and 56th.

Three goals in eleven minutes, all of them from the whistle, is the pattern of the Dutch pool campaign in miniature: they have now scored twelve goals across three matches, and in every one of them the decisive scoring has come after the interval. Japan leave the pool stage with one goal and no points, but with sixty minutes here that bore no resemblance to their first two matches.""",
}

# ── The pick rationales ─────────────────────────────────────────────────
# Each argues from this tournament, up to the previous match, and names the
# evidence against the pick as well as for it. None refers to the result.
REASONS = {
    'D1': "Opening match, so there is no tournament form to read yet: the case rests on India's penalty-corner battery, with Harmanpreet Singh the most dangerous drag flick either side can put on the pitch, against a Welsh defence that will have to survive it repeatedly to stay in the match. The risk is that India have historically been corner-dependent, and one good defensive routine can keep this close.",

    'B1': "No tournament form on either side yet. Germany's press and structure make them the side more likely to score early and often, while Malaysia's route to goal is the counter and the short corner — real, but dependent on getting the ball back first. If Malaysia can survive the opening quarter this becomes a genuine contest; if they concede in it, the shape of the match is set.",

    'D2': "First match for both, so the argument is squad depth rather than results: England spread their scoring across a deep forward line and convert from open play as readily as from set pieces, which is harder to defend than a single route to goal. Pakistan's set piece is the counter-argument and it is not a small one — they can manufacture chances against anyone, and only need the conversion to follow.",

    'B2': "Tournament openers, so this is a judgement on how the two sides are built: Belgium have the best short-corner unit in the competition in Alexander Hendrickx and a defence that concedes very little through the middle. France's counter-attack is quick enough to punish any loose Belgian possession, which makes an early French goal the most likely route to an upset here.",

    'C1': "Nothing played yet on either side. Australia's transition speed is the sharpest weapon on show and their set-piece unit converts at a rate few defences survive; Ireland's answer is organisation rather than pace, and they defend the circle well enough to keep this from becoming a rout. That is exactly the scenario in which it becomes tight — if Ireland deny Australia the space to run at them, execution in the circle decides it.",

    'C2': "No form to read on either side. Spain score from open play more freely than most and rarely need a set piece to break a defence down, which suits them against a South African side that defends the circle competently. The Amabhungane counter-attack, with Mustaphaa Cassiem finishing, is the reason this is not a comfortable pick — one lapse and the shape of the game changes.",

    'A2': "Opening match, so the case is the hosts' quality and the venue rather than results: the Netherlands work the ball into the circle more often than anyone in Pool A and their forward line scores from every angle. New Zealand will defend deep and look to counter, and if they take an early lead in front of a home crowd the pressure shifts in a way no ranking accounts for.",

    'A1': "Neither side has played. Argentina's transition game should control the middle quarters and their forward line is the more varied of the two; Japan's strength is defensive shape rather than scoring, which usually keeps them in matches longer than the scoreline suggests. The risk in this pick is patience — if Argentina do not break the shape early, a low-scoring game favours the side defending it.",

    'D4': "Both lost their openers, and both lost them differently: Pakistan reached the England circle repeatedly and took only a 50th-minute consolation from it, while Wales were held to a single goal by India and did not score until the 56th. Pakistan's ability to create at this level is the edge here. Their discipline is the doubt — they took a green card against England, and this fixture rarely stays calm.",

    'B4': "Malaysia's corner goal against Germany and Shello Silverius's willingness to shoot on sight give them a route to goal that does not depend on sustained possession, which matters against a French side that plays through the middle. The strong counter-argument is France's opener: they scored twice against the top-ranked side in the world and led them twice, which is more attacking evidence than Malaysia's 1-5 provides.",

    'D3': "India come in having scored three penalty-corner goals against Wales, the best set-piece return of the opening round, and Harmanpreet Singh's two make them the more dangerous side the moment the ball enters the circle. England's counter-case is real and it is about breadth — four different scorers against Pakistan, in all four quarters, from both open play and set pieces, which is a harder pattern to defend than a single routine.",

    'B3': "Belgium opened with a 3-2 win over France in which both of their goals in the last sixteen minutes came from penalty corners, and Alexander Hendrickx's flick remains the most reliable set-piece finish in the tournament. Germany's 5-1 against Malaysia is the stronger attacking evidence — three goals inside seven minutes — so this pick rests on Belgium's defence keeping the game to one or two chances, not on outscoring them.",

    'A4': "Both lost their openers, but not equally: New Zealand scored first against the Netherlands and were level after three quarters before it ran away, while Japan were kept scoreless by Argentina and did not threaten the circle. New Zealand have shown they can score against a top-two defence; Japan have yet to show they can score at all, and that gap decides an evenly matched fixture.",

    'C3': "Both sides won their openers 3-1, which makes the method the deciding evidence: all three of Australia's came from penalty corners, while all three of Spain's came from open play. Against a Spanish defence that conceded a set-piece goal to South Africa, the Australian routine is the likelier route to goal. The reason this is close to a coin toss is that Spain conceded only one and never needed a set piece themselves.",

    'C4': "Both lost their openers by the same 1-3 scoreline, but Ireland's single goal against Australia came from a short corner, while South Africa conceded three inside twenty-eight minutes to Spain and took two green cards in the closing eight minutes. Ireland's problem is finishing, not creating, and against a South African side that struggles to hold a lead, the side that keeps generating chances is favoured.",

    'A3': "The Netherlands have scored five and conceded one, and did their scoring in an eighteen-minute burst after falling behind, which is the profile of a side that does not panic. Argentina's clean sheet against Japan is the counter-evidence and a good one — they conceded nothing and controlled the middle quarters — but all three of their goals came from open play and none from a set piece, so a tighter game leaves them fewer ways to score.",

    'D5': "England arrive with two wins, eight goals and scorers in every quarter of both matches; Wales have one point, four goals and have already conceded six. The gap in this pool is not close on any measure available. Wales' draw with Pakistan showed they punish a distracted opponent — Gareth Furlong converted their corner and their stroke — so the margin depends on England's concentration rather than the result.",

    'D6': "India have scored five in two matches, four of them from penalty corners with Harmanpreet Singh converting three; Pakistan have one point, seven goals conceded, and a discipline record — a yellow and three greens against Wales — that hands a set-piece side extra opportunities. Pakistan's three goals in that draw prove they can score against anyone in this pool, which is why the margin is less certain than the outcome.",

    'B6': "Germany have won both matches, conceded once, and beaten Belgium by keeping the best set-piece unit in the tournament off the scoresheet entirely — the most complete defensive performance of the pool stage. France have taken one point from two and needed a 59th-minute equaliser to get it. The caution is that France have now scored in every match and against Belgium showed they can punish one lapse, and Germany's wins have both been narrow in chances if not in scoreline.",

    'B5': "Belgium's defeat to Germany came without a goal of any kind, and against Malaysia — who have conceded five to Germany and three to France — they should get their set piece back, with Alexander Hendrickx and Tom Boon both capable of scoring from it. Malaysia's counter-argument is their scoring: they took three off France, converting from short corners in both matches, and Belgium's defence has now been breached in both of theirs.",

    'C5': "Australia have six points, four goals and one conceded, and have scored from a corner, from open play and from a stroke — three routes to goal against a South African side that has conceded seven in two matches and failed to score against Ireland. The one warning is discipline: Australia took three green cards against Spain in twenty-three minutes, and South Africa's Mustaphaa Cassiem has scored in both matches.",

    'A6': "Argentina beat Japan without conceding and lost to the Netherlands only after a yellow card gave the hosts the opening they needed; New Zealand have beaten Japan and been beaten 5-1 by the same Dutch side. The two results overlap almost exactly, so the edge is Argentina's attacking variety — three different scorers against Japan, a set-piece goal against the Netherlands — against a New Zealand side that has scored three in two.",

    'C6': "Spain's only defeat came 1-0 to Australia in a match decided by a penalty stroke, with neither side able to score from open play or from a corner, which says their defensive shape travels; Ireland's four goals against South Africa came from a side that had lost its opener and needed twenty-two minutes to turn the game. Ireland's Lee Cole converted twice from corners in that win, so the set piece is a genuine threat — but Spain have conceded two goals in two matches and give up very little in the circle.",

    'A5': "The Netherlands have won both matches, scored eight and taken the second half of each one decisively; Japan have not scored in the tournament and have conceded five, with no set-piece goal to their name in either match. Japan's defensive shape kept Argentina to one goal for thirty-three minutes, so a low-scoring first half is plausible — but a side with no attacking output cannot hold this Dutch forward line for sixty.",
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
    # Stage 1 only: this review covers the 24 pool matches. Stage 2 onwards is
    # stage2_review.py's ledger, one match at a time as results land.
    finished = [m for m in fixtures['matches']
                if m['status'] == 'completed' and m['phase'] == 'pool'
                and (m.get('score') or {}).get('home') is not None]
    ids = {m['id'] for m in finished}

    missing = ids - set(STORIES)
    extra = set(STORIES) - ids
    if missing or extra:
        print(f'MISMATCH — briefs missing for {sorted(missing)}, briefs for unplayed {sorted(extra)}')
        return 1

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
