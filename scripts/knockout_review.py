#!/usr/bin/env python3
"""
Rationales for the fixtures still to be played, argued from this tournament.

The picks for matches 41-48 were published with the pipeline's fallback
sentence — "FIH #10 FRA favoured over #16 JPN — points-based Elo with a full
draw model". That is a description of a world-ranking gap, not a case for a
team, and it is exactly the sentence the Stage 1 and Stage 2 reviews replaced
for matches already played. It survived here because the prose gate only ever
read completed matches, so nothing held an upcoming pick to the same standard.

Every rationale below argues from THIS TOURNAMENT and nothing else: results,
goals scored and conceded, how those goals came, and who scored them — all of
it from public/data, which is FIH-derived. Earlier meetings between the two
sides are a matter of record and are shown on the match page as history, but
they are not used here to justify a pick, and neither is a ranking position.

What is NOT touched: the picks themselves, their probabilities and their
publication times. Only the prose changes, and the sentence it replaces stays
on the row as `reason_original`.

    python3 scripts/knockout_review.py            # apply
    python3 scripts/knockout_review.py --check    # report, change nothing
"""
import json
import os
import sys
from datetime import datetime, timezone

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')

# One per fixture still to be played. Each cites this tournament's record for
# both sides and names the strongest evidence against the pick as well as for
# it. No ranking positions, no earlier meetings, no hindsight — none of these
# matches has been played.
REASONS = {
    'POS13': "France have taken a point off Germany and beaten Ireland in this tournament, and have scored in four of their five matches; Japan's only win came against Wales, the side with the worst defensive record here. Nine goals to seven and eleven conceded to fifteen is a narrow edge rather than a wide one, and Japan arrive on their first win of the fortnight, which is the case against.",

    'POS15': "Neither side has won a match here, so the argument is which of two struggling teams creates more. Malaysia have scored fourteen to Wales' ten and have taken two draws to Wales' one; Abu Kamal Azrai has four of those goals. Wales have conceded twenty-four, the most of any side in the tournament. Gareth Furlong's four goals are the reason this is not comfortable.",

    'POS11': "South Africa have the better result on their sheet — a draw with an unbeaten Australia and a three-goal win over France — and Mustaphaa Cassiem's six goals are the most by anyone outside the semi-finalists. Pakistan have scored thirteen to South Africa's ten, so the attacking numbers favour them, but they have conceded nineteen against South Africa's thirteen and their only win came against Japan.",

    'POS9': "New Zealand have won both of their classification matches and three of five overall, scoring fifteen; Ireland have won two of five and lost three. Ireland's seven goals against Malaysia are the biggest single return either side has managed, and Lee Cole and Jonathan Lynch have three each, so the attacking case is real. New Zealand's is the steadier record across the fortnight.",

    'POS5': "England have scored nineteen goals in five matches to Australia's nine, with twelve of them from open play and seven from set pieces — the broadest scoring of any side outside the semi-finals. Australia have conceded eight to England's ten and lost only once, so this is a contest between the sharper attack and the tighter defence, and the attack has the larger margin.",

    'POS7': "Belgium have conceded eight goals in five matches to India's sixteen, and have lost once where India have lost three, including their last three in a row. India's fourteen goals and Harmanpreet Singh's six from penalty corners are the counter-argument, and a real one — they have the more dangerous set piece on the pitch. Belgium's defence is the more reliable of the two.",

    'SF1': "The Netherlands are the only unbeaten side left, with seventeen goals scored and six conceded across five matches, and they are playing at home in Amstelveen. Spain have conceded only five, the fewest of anyone, and have already beaten Germany here, so this is the tournament's best attack against its most miserly defence. Spain's nine goals in five matches are why the Netherlands are favoured rather than certain.",

    'SF2': "Argentina come in on four straight wins with nineteen goals, and Tomas Domene's eight are the most by any player in the tournament — he scored all three in the win over England. Germany have conceded six to Argentina's eight and beat Australia to top the pool, so the defensive record is theirs. The margin is narrow: Argentina's scoring rate against Germany's back line.",
}


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def main():
    check = '--check' in sys.argv
    now = datetime.now(timezone.utc).isoformat()
    fixtures = {m['id']: m for m in load('fixtures.json')['matches']}
    preds = load('predictions.json')

    # A rationale for a fixture that has been played belongs to the stage
    # reviews, not here; one for a fixture whose sides are not named yet would
    # be arguing about teams nobody knows.
    unplayable = [mid for mid in REASONS
                  if mid not in fixtures
                  or fixtures[mid]['status'] == 'completed'
                  or fixtures[mid]['home'] == 'TBD']
    if unplayable:
        print(f'SKIPPED — played, unknown or missing: {sorted(unplayable)}')

    revised = 0
    for row in preds['predictions']:
        if row.get('superseded'):
            continue
        new = REASONS.get(row['matchId'])
        if not new or row['matchId'] in unplayable or row['reason'] == new:
            continue
        revised += 1
        if check:
            continue
        row.setdefault('reason_original', row['reason'])
        row['reason'] = new
        row['reason_revised_at'] = now
        row['reason_revision'] = ('rationale rewritten from this tournament only; '
                                  'pick and probabilities unchanged')

    if check:
        print(f'{revised} rationale(s) would change.')
        return 0
    if not revised:
        print('Nothing to change — every rationale already matches this review.')
        return 0

    with open(os.path.join(DATA, 'predictions.json'), 'w') as fh:
        json.dump(preds, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    version['updated_at'] = now
    with open(os.path.join(DATA, 'data-version.json'), 'w') as fh:
        json.dump(version, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from data_fingerprint import stamp
    stamp()
    print(f"{revised} rationale(s) revised, data-version -> {version['version']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
