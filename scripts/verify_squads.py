"""
Hockey.AI — are the squads we publish the squads the FIH entered?

The entry list is one report, served by the same AltiusRT system under two
hostnames: tms.fih.ch, which this pipeline has always read, and
fih.altiusrt.com, which is the same competition on the vendor's own domain.
Both are tried, because a host being down is not the same as a squad changing.

It reports rather than assumes: for every nation, who the list carries that we
do not, who we carry that it does not, and every shirt number, spelling,
captaincy and goalkeeper mark that differs. `--write` applies the list's answer
to public/data/players.json, refusing outright if the differences run past
WRITE_CEILING — a parser regression that misreads the PDF would otherwise
rewrite three hundred shirt numbers unattended, and a squad that changed by more
than a handful of fields is a thing to read before applying.

    python3 scripts/verify_squads.py            # report
    python3 scripts/verify_squads.py --write    # report and correct
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import update_data as ud                                        # noqa: E402

HOSTS = ['https://fih.altiusrt.com', 'https://tms.fih.ch']

# The most corrections --write will apply in one run. The entry list settles
# once a tournament starts: a handful of captaincy or shirt changes is real
# drift, a hundred is the parser having lost the column layout. Above this the
# run reports and writes nothing, which is the safe failure.
WRITE_CEILING = 25


def official_squads():
    """{code: [entry]} from the entry list, and the host it came from."""
    for host in HOSTS:
        for path in ud.TMS_SQUAD_PATHS:
            url = f'{host}/competitions/1866{path}'
            body, _ctype = ud._tms_get(url)
            if not body:
                continue
            squads = ud.parse_squad_lines(ud._tms_lines(body))
            total = sum(len(v) for v in squads.values())
            print(f'ENTRY LIST: {url} -> {total} players across {len(squads)} teams')
            if total >= 80:
                return squads, url
            print('ENTRY LIST: too few players to be the real list; trying the next source.')
    return None, None


def compare(squads, players_doc):
    """Print every difference, and return the corrections that would fix them."""
    ours = {}
    for p in players_doc['players']:
        ours.setdefault(p['team'], []).append(p)

    fixes, notes = [], []
    for code in sorted(squads):
        listed = squads[code]
        mine = ours.get(code, [])
        by_key = {tuple(ud._name_tokens(p['name'])): p for p in mine}

        seen = set()
        for entry in listed:
            key = tuple(ud._name_tokens(entry['name']))
            match = by_key.get(key)
            if match is None:
                # A name can be spelled differently and still be the same man;
                # the shirt number decides, because a squad wears each once.
                match = next((p for p in mine if p.get('number') == entry['number']
                              and ud._names_match(p['name'], entry['name'])), None)
            if match is None:
                notes.append(f'{code}: the list carries #{entry["number"]} '
                             f'{entry["name"]}, we do not')
                continue
            seen.add(id(match))
            for field, want, label in (
                ('name', entry['name'], 'name'),
                ('number', entry['number'], 'shirt'),
                ('is_captain', entry['is_captain'], 'captain'),
            ):
                have = match.get(field)
                if field == 'is_captain':
                    have = bool(have)
                if have != want:
                    notes.append(f'{code}: #{entry["number"]} {entry["name"]} — '
                                 f'{label} is {have!r}, the list says {want!r}')
                    fixes.append((match, field, want))
            if entry['goalkeeper'] and match.get('position') != 'Goalkeeper':
                notes.append(f'{code}: {entry["name"]} is marked (GK) on the list, '
                             f'we have {match.get("position")!r}')
                fixes.append((match, 'position', 'Goalkeeper'))
            for field, want in (('dob', entry.get('dob')), ('caps', entry.get('caps'))):
                if want is not None and match.get(field) != want:
                    fixes.append((match, field, want))

        for p in mine:
            if id(p) in seen:
                continue
            if p.get('on_team_list') is False:
                continue           # already known not to have travelled
            notes.append(f'{code}: we carry #{p.get("number")} {p["name"]}, '
                         f'the list does not')

        if len(listed) != len([p for p in mine if p.get('on_team_list') is not False]):
            notes.append(f'{code}: the list has {len(listed)} players, '
                         f'we publish {len([p for p in mine if p.get("on_team_list") is not False])}')

    return fixes, notes


def main():
    write = '--write' in sys.argv
    squads, source = official_squads()
    if not squads:
        print('ENTRY LIST: no usable source this run — nothing verified.')
        return 1

    players = ud.load('players.json')
    fixes, notes = compare(squads, players)

    print(f'\nSQUAD CHECK against {source}')
    print(f'  {sum(len(v) for v in squads.values())} players listed, '
          f'{len(players["players"])} carried, {len(notes)} difference(s).')
    for note in notes:
        print(f'  · {note}')
    if not notes:
        print('  Every squad matches the entry list, name for name.')

    if not fixes:
        return 0
    if not write:
        print(f'\n{len(fixes)} correction(s) available — rerun with --write to apply.')
        return 0
    if len(fixes) > WRITE_CEILING:
        print(f'\nREFUSING TO WRITE: {len(fixes)} corrections is past the ceiling of '
              f'{WRITE_CEILING}. A squad does not change this much mid-tournament; read '
              f'the differences above before applying any of them.')
        return 0
    for player, field, want in fixes:
        player[field] = want
    ud.save('players.json', players)
    print(f'\nWROTE {len(fixes)} correction(s) to players.json.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
