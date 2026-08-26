"""
Hockey.AI — correct the team intros against the official team list.

The intros were written before the FIH published its entry lists. Eleven of
them named a player who is not on one: the Netherlands were introduced around
a goalkeeper who retired after Paris 2024, and five nations were credited with
a captain who is not their captain. Every one of those is a claim about who is
at this tournament, and every one of them was wrong.

Only the false clause is rewritten. The voice, the argument and the rest of
each intro are the author's and are left alone. Idempotent: it writes only
when the stored text still differs.

Run: python3 scripts/team_intro_review.py
"""
import json
import os
import sys

DATA = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')

# (team, the sentence as published, the sentence as it should read)
CORRECTIONS = [
    ('NED',
     'Thierry Brinkman captains a squad built on relentless circle entries and a '
     'goalkeeper in Pirmin Blaak who has seen every kind of World Cup night.',
     'Thierry Brinkman captains a squad built on relentless circle entries, with '
     'Maurits Visser and Derk Meijer sharing the goalkeeping.'),
    ('ARG',
     "Argentina's game is built on speed of thought — quick restarts, aggressive "
     'pressing, drag-flick threat from distance — and Lucas Martín Rossi leads a '
     'group that has grown up together.',
     "Argentina's game is built on speed of thought — quick restarts, aggressive "
     'pressing, drag-flick threat from distance — and Maico Casella leads a group '
     'that has grown up together.'),
    ('JPN',
     'Koji Kayukawa leads a squad that will look at a pool containing the '
     'Netherlands and Argentina and see two chances to be remembered.',
     'Raiki Fujishima leads a squad that will look at a pool containing the '
     'Netherlands and Argentina and see two chances to be remembered.'),
    ('GER',
     'Niklas Wellen and Christopher Rühr give them scoring from open play as well '
     'as set pieces.',
     'Christopher Rühr and Tom Grambusch give them scoring from open play as well '
     'as set pieces.'),
    ('MAS',
     "Malaysia's hockey is played at pace, with Tengku Ahmad Tajuddin driving from "
     'midfield and Adrian Albert leading a squad that has closed the gap on the '
     'European sides in recent seasons.',
     "Malaysia's hockey is played at pace, with Marhan Jalil leading a squad that "
     'has closed the gap on the European sides in recent seasons.'),
    ('AUS',
     "Blake Govers' flick and Tom Wickham's movement lead the scoring threat.",
     "Blake Govers' flick leads the scoring threat."),
    ('ESP',
     "Spain's strength is a settled defensive shape and a corner battery built "
     'around Marc Miralles and Pau Quemada.',
     "Spain's strength is a settled defensive shape and a corner battery built "
     'around captain Marc Miralles.'),
    ('IRL',
     "Conor Harte leads a squad with Shane O'Donoghue's experience and a defensive "
     'block that stays compact for the full seventy minutes.',
     'Kyle Marshall leads a squad with a defensive block that stays compact for '
     'the full seventy minutes.'),
    # The team list marks Arthur van Doren as Belgium's captain, not Arthur de
    # Sloover. The intro and the team card both said otherwise.
    ('BEL',
     'Arthur de Sloover captains a side that treats structure as a weapon.',
     'Arthur van Doren captains a side that treats structure as a weapon.'),
    ('PAK',
     "Sufyan Khan leads a young squad in which Muhammad Umar Bhutta's corner threat "
     'carries much of the scoring burden.',
     "Abu Mahmood leads a young squad in which Sufyan Khan's corner threat carries "
     'much of the scoring burden.'),
]


def load(name):
    with open(os.path.join(DATA, name)) as f:
        return json.load(f)


def check_intros(team_rows, players):
    """Every claim an intro makes about who is here, checked against the list.

    A surname alone is not evidence of a wrong name: Germany field Tom
    Grambusch and did not bring Mats, so "Grambusch" in their intro is correct.
    A name is only wrong when no player on that nation's official list carries
    it — and a full name that belongs to an absent player is always wrong.
    """
    problems = []
    for team in team_rows:
        code = team['code']
        intro = team.get('intro') or ''
        if not intro:
            continue
        squad = [p for p in players if p['team'] == code]
        listed = {p['name'] for p in squad if p.get('on_team_list')}
        listed_surnames = {n.split()[-1] for n in listed}
        for p in squad:
            if p.get('on_team_list'):
                continue
            if p['name'] in intro:
                problems.append(f"{code} names {p['name']}, who is not on the "
                                f'official team list')
                continue
            surname = p['name'].split()[-1]
            if surname and surname in intro and surname not in listed_surnames:
                problems.append(f'{code} names {surname}, which belongs only to '
                                f"{p['name']}, who is not on the official team list")
        # Nobody may be introduced as leading a side he does not captain. A side
        # can have more than one — the FIH list marks co-captains for Argentina
        # and Wales — so this reads the whole set, not the first name it finds.
        captains = {p['name'] for p in squad
                    if p.get('on_team_list') and p.get('is_captain')}
        for p in squad:
            if not p.get('on_team_list') or p['name'] in captains:
                continue
            for verb in ('captains', 'leads a squad', 'leads a group', 'leads a young squad'):
                if f"{p['name']} {verb}" in intro:
                    problems.append(f"{code} has {p['name']} {verb}, but the team "
                                    f"list marks {' and '.join(sorted(captains)) or 'nobody'} "
                                    f'as captain')
    return problems


def main(check_only=False):
    teams = load('teams.json')
    players = load('players.json')['players']
    on_list = {(p['team'], p['name']) for p in players if p.get('on_team_list')}

    by_code = {t['code']: t for t in teams['teams']}
    changed = applied = 0
    for code, was, now in CORRECTIONS:
        team = by_code.get(code)
        if not team:
            print(f'{code}: no such team.')
            continue
        intro = team.get('intro') or ''
        if now in intro:
            continue                      # already corrected
        if was not in intro:
            print(f'{code}: the sentence being corrected is no longer in the intro '
                  f'— leaving it alone rather than guessing.')
            continue
        if not check_only:
            team['intro'] = intro.replace(was, now)
        applied += 1
        changed = 1

    # The correction is only worth anything if it is true, so check the result
    # against the official list rather than trusting the table above.
    bad = check_intros(teams['teams'], players)
    for b in bad:
        print('UNRESOLVED:', b)

    # The team row used to carry its own `captain` string and the team page
    # printed it. Nothing cleared it when a captain turned out not to be at the
    # tournament — this loop only ever visited teams that HAD a captain on the
    # list — so Australia's page named Aran Zalewski, a pre-tournament seed the
    # official list does not carry, for the whole competition. The page now
    # reads the flag off the squad, which is the only place captaincy is
    # reconciled, so the field is removed rather than kept in sync.
    for team in teams['teams']:
        if 'captain' in team:
            print(f"{team['code']}: dropping the team row's own captain field "
                  f"({team['captain']!r}) — the squad is the source.")
            if not check_only:
                del team['captain']
            changed = 1
            applied += 1

    if check_only:
        if changed or bad:
            print(f'{applied} correction(s) outstanding, {len(bad)} unresolved claim(s).')
            return 1
        print('Every intro and captain matches the official FIH team list.')
        return 0
    if changed:
        with open(os.path.join(DATA, 'teams.json'), 'w') as f:
            json.dump(teams, f, indent=2, ensure_ascii=False)
        print(f'{applied} intro(s) corrected.')
    else:
        print('Nothing to change — every intro already matches the official team list.')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main(check_only='--check' in sys.argv))
