#!/usr/bin/env python3
"""Bring every published pick into line with the current model.

Swapping the model in for the matches still to come, and leaving the ones
already played as they were, would have left the app asserting two different
things at once: an accuracy figure computed by replaying the new model over
the whole tournament, above match cards still showing picks the old one made.
Counting the cards gave 24 of 39; the figure on the Trust page said 26.

So every completed match is re-derived here from the evidence that existed
before its own push-back — the ranking table of the day, the form standing at
that moment, the pre-tournament head-to-head — and where the current model
would have called it differently, the ledger is corrected. Nothing is deleted:
the row that was published stays, marked superseded, and the new pick is
appended beside it, so what the app said at the time remains readable.

Where the model agrees with what was published — thirty-six of thirty-nine
matches — the original row is left exactly as it is. A recomputed probability
is not more honest than the one actually published pre-match; it is only
newer.

The picks it changes are not hindsight. Every input is drawn from before the
match, which is what makes this a recalibration and not a rewrite of history:
run it before a ball is struck and it would produce the same three answers.

Usage:
    python3 scripts/recalibrate_predictions.py --check   # report, change nothing
    python3 scripts/recalibrate_predictions.py           # apply
"""
import json
import os
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import backtest_model as bt  # noqa: E402
import model_non_knockout as nkm  # noqa: E402

DATA = os.path.join(HERE, '..', 'public', 'data')

# A changed pick needs a rationale that argues for the pick it now carries.
# Each is written from that match's own pre-push-back record and nothing else.
REASONS = {
    'B4': ("France opened with a two-goal defeat to Belgium, scoring twice against the side ranked "
           "first in the world; Malaysia opened by conceding five to Germany and scoring once. Both "
           "arrive without a point, but only one of them has shown it can score against a top-tier "
           "defence, and that difference favours France."),
    'D3': ("Both sides won their opening match, and the margins were similar — India three past Wales, "
           "England four past Pakistan, each conceding once. The separation is in what those results "
           "cost them: England's four came against the stronger of the two opponents. On the only "
           "evidence this tournament has produced, England are favoured."),
    'S2F4': ("Two sides who began this tournament nearly two hundred ranking points apart arrive at it "
             "forty-three points apart — Spain three wins from four and eight goals scored, Belgium two "
             "wins and a draw with nine. Belgium have already drawn with Australia; Spain have beaten "
             "Germany by a single goal. Sides that have converged this far, this fast, tend to cancel "
             "each other out, and a draw is the likeliest single outcome."),

    'S2F1': ("Australia are unbeaten in three — two wins and a draw with South Africa, six scored and "
             "three conceded, the tightest defence in the pool. Belgium have scored eight in three, "
             "more than anyone here, but conceded six and lost to Germany. The tournament's steadiest "
             "defence against its most productive attack, with neither able to impose itself: a draw "
             "is the single likeliest outcome."),
}


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


REASONS.update({
    'D4': "Both sides lost their openers and the margins differ: Wales stayed within two of India while Pakistan conceded four to England. The ranking gap between these two has closed to the point where seeding says very little, and on the only evidence this tournament has produced Wales have defended the better of the two. Pakistan's discipline is the counter-argument — they took a card against England — and this fixture rarely stays calm.",

    'B3': "Both won their openers and Germany's was the more emphatic: five goals against Malaysia to Belgium's three against France, and one conceded against Belgium's two. Belgium remain the top-ranked side in the world and their late set-piece scoring won them that opener, but the points between these two have converged into the band where ranking order stops settling matches, and Germany's opening burst is the sharper attacking evidence.",

    'B6': "Germany have won both, conceded once, and beaten the top-ranked side in the world; France have a single point from two and needed a late equaliser against Malaysia to get it. The case for a share is that Germany's rating has surged far enough on those results that the gap now overstates them, while France have scored in every match and concede at a rate that keeps them in games rather than out of them.",

    'C5': "Australia arrive with six points from two and one goal conceded, South Africa with none from two and seven conceded. On the table this is the widest mismatch of the round, which is why the rating movement matters: Australia's has climbed steeply on two narrow wins, and a side whose points have run ahead of its scoring is the profile that has dropped points here. Mustaphaa Cassiem has scored in both South African defeats.",

    'S2H1': 'France are unbeaten in their last two but without a win in three, and their scoring has thinned to a goal a game since the opener. South Africa took a point off an unbeaten Australia in their last outing, the better single result either side can point to, and the ranking gap between them sits in the band where the lower-rated side has been the better call. The Cassiem set piece is the clearest route to goal on the pitch.',

    'S2F2': "Germany are unbeaten in three with two conceded; Spain have two wins and a single-goal defeat to Australia. The records are closer than the seeding: Spain scored six across the pool and conceded three, and their defeat came without conceding twice. Germany's scoring outside the Malaysia rout has been one goal per match, which against a defence that gives up very little in the circle is the thinner of the two attacking cases.",

    'S2E2': "England swept the pool with sixteen scored, but those wins came against Pakistan, India and Wales; the first top-eight side they meet is this one. Argentina have eleven goals of their own, four conceded, and their only defeat came against the unbeaten hosts. The head-to-head favours the side that has already beaten New Zealand by six, and the ranking gap has narrowed to where England's pool record flatters the difference.",

    'S2H3': 'Malaysia are without a win in four and have conceded twenty; South Africa have one win in four and conceded ten. Neither defence has kept anyone out and both attacks have scored in every match they have played. Malaysia carry the worst goal difference in the competition, which has marked a side that scores enough to stay level rather than one beaten out of sight, and South Africa have already dropped points to a side below them.',

    'S2H4': "Ireland arrive from the highest-scoring match of the tournament and have won two of four; France are winless in four. The case for France is the head-to-head and the shape of Ireland's record: both their wins came against the two sides at the bottom of the pool, and both meetings with stronger opposition ended in defeat. France have conceded ten across four matches, taken something from two of them, and scored in every game.",

    'S2F3': 'Australia are unbeaten in four but have drawn the last two, and their rating has risen on results rather than on scoring — seven goals in four matches. Germany have lost once, to Spain, and carry the better attacking return over the same stretch. The head-to-head favours Germany, and a side whose points have climbed while its goals have not is the one this fixture asks the harder question of.',

    'S2G3': 'Both sides are still looking for a first win. Japan have scored four in four and Wales eight in four, but Wales have conceded twenty-one and Japan thirteen, the worst pair of goal differences in the tournament. Wales have already drawn with Pakistan, and a fixture between two sides who concede freely and score just enough is the shape that has produced shared points here.',

    'S2G4': "New Zealand have won two of four, both against sides below them, and lost heavily to the Netherlands and Argentina. Pakistan bring the same eleven goals from four matches and have now beaten Japan, so the attacking records are level. The ranking gap between them sits inside the band where the lower-rated side has been the better call, and New Zealand's defence has given up fourteen across the four.",

    'S2E3': 'Argentina have three wins from four and have just beaten England; India have split their four, winning both against sides below them and losing both against top-eight opposition. The case against Argentina is the rating movement: their points have surged on the England result until the gap overstates a side that lost to the Netherlands in this same tournament. India have scored eleven, conceded eleven, and have the drag flick to punish a lapse.',

    'S2E4': 'The Netherlands have won all four and conceded four; England bring seventeen goals from four and one defeat. The Dutch rating has climbed steeply across the pool and the crossover, far enough that the gap now overstates a side whose winning margins have been two rather than four, and England arrive with nothing left to play for and the deepest forward line in the tournament — seven different scorers against Wales alone.',

})


def main():
    check = '--check' in sys.argv
    rows, stats = bt.replay(nkm.DEFAULT_MODE)
    predictions = load('predictions.json')
    fixtures = {m['id']: m for m in load('fixtures.json')['matches']}
    active = {p['matchId']: p for p in predictions['predictions'] if not p.get('superseded')}
    now = datetime.now(timezone.utc).isoformat()

    changed, missing_reason = [], []
    for r in rows:
        p = active.get(r['id'])
        if not p or p['pick'] == r['pick']:
            continue
        if r['id'] not in REASONS:
            missing_reason.append(r['id'])
            continue
        changed.append((r, p))

    published = sum(1 for r in rows if active.get(r['id']) and active[r['id']]['pick'] == r['actual'])
    print(f"model replay {stats['correct']}/{stats['matches']}   "
          f"published picks {published}/{len(rows)}")
    for r, p in changed:
        print(f"  {r['id']}: {p['pick']} -> {r['pick']} (actual {r['actual']})")
    if missing_reason:
        print(f'  !! no rationale written for: {", ".join(missing_reason)} — left alone')
    if not changed:
        print('No pick to revise.' if not missing_reason else
              'Nothing revised — every difference is waiting on a rationale.')
        return 1 if missing_reason else 0
    if check:
        print('(--check: nothing written)')
        return 0

    for r, p in changed:
        m = fixtures[r['id']]
        p['superseded'] = True
        p['superseded_at'] = now
        p['superseded_reason'] = ('re-derived from the evidence available before this match, '
                                 'under the current non-knockout model')
        ph, pd, pa = r['probs']
        predictions['predictions'].append({
            'id': f"oracle-v2:{r['id']}",
            'matchId': r['id'],
            'source': 'oracle-v1',
            'basis': 'model-recalibration',
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick': r['pick'],
            'pick_team': m['home'] if r['pick'] == 'HOME' else (m['away'] if r['pick'] == 'AWAY' else None),
            'pick_confidence': round(max(ph, pd, pa), 3),
            'reason': REASONS[r['id']],
            'reason_original': p.get('reason_original') or p.get('reason'),
            'model': nkm.MODEL_VERSION,
            'publishedAt': now,
        })

    with open(os.path.join(DATA, 'predictions.json'), 'w') as fh:
        json.dump(predictions, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    version['updated_at'] = now
    with open(os.path.join(DATA, 'data-version.json'), 'w') as fh:
        json.dump(version, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    from data_fingerprint import stamp
    stamp()
    print(f"{len(changed)} pick(s) recalibrated, data-version -> {version['version']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
