"""
Hockey.AI — the official match report.

/matches/{id}/reports/matchreport is a public TMS report, a sibling of the two
this pipeline already fetches without a credential. It carries the whole team
sheet, which nothing else here had:

    Minute Shirt # Name              Green Yellow Red
    X   4  SINGH Jarmanpreet          X  3  KYRIAKIDES Daniel
    3   9  SINGH Dilpreet             4 13  HUTCHINSON Dale
    16 27  Shashikumar Mohith (GK)    X 23  PRITCHARD Jack
    X  77  KARKERA Suraj (GK)           33  PAYNE Rhys (GK)

X in the minute column means the player started. A number means the minute he
came on. Blank means he was named and never took the field — Payne above.

The rows carry both teams side by side, and a name can be one word or four, so
the split between them cannot be found by counting tokens. It is found by
asking the squads: a row is split at the one point where the left half parses
as a player of the home squad and the right half as a player of the away squad.
Anything that does not resolve to exactly one such split is left alone rather
than guessed at.
"""
import re

# The minute a player came on. "15+" is a substitution in the time added to a
# quarter, and the report writes it exactly that way.
MINUTE = re.compile(r'^(\d{1,2})\+?$')


def pdf_name_key(name):
    """A comparable key for a name written either way round.

    The report prints "SINGH Harmanpreet"; the squad list holds "Harmanpreet
    Singh". Comparing the set of lowercased word stems matches both without
    caring about order or case.
    """
    return frozenset(w.strip('().').casefold() for w in name.split()
                     if w.strip('().') and w.upper() not in ('C', 'GK', 'G'))


def _entry(tokens, squad_by_number):
    """(row, consumed) if these tokens open a valid entry, else None."""
    i = 0
    minute = None
    started = False
    if i < len(tokens) and tokens[i] == 'X':
        started = True
        i += 1
    elif (i + 1 < len(tokens) and MINUTE.match(tokens[i])
            and tokens[i + 1].isdigit()):
        # A leading number is the minute only when a shirt number follows it.
        # It may carry a "+": a substitution in a quarter's added time.
        minute = int(MINUTE.match(tokens[i]).group(1))
        i += 1
    if i >= len(tokens) or not tokens[i].isdigit():
        return None
    number = int(tokens[i])
    player = squad_by_number.get(number)
    if not player:
        return None
    i += 1
    # Take name words until they stop matching this player's name.
    want = pdf_name_key(player['name'])
    got, j = set(), i
    while j < len(tokens):
        w = tokens[j].strip('().').casefold()
        if tokens[j].upper().strip('()') in ('C', 'GK', 'G'):
            j += 1
            continue
        if w and w in want:
            got.add(w)
            j += 1
            continue
        break
    if not got or not got >= want:
        return None
    return ({
        'number': number,
        'playerId': player.get('id'),
        'name': player['name'],
        'started': started,
        'on_minute': minute,
        'played': started or minute is not None,
        'goalkeeper': any(t.upper().strip('()') in ('GK', 'G') for t in tokens[i:j]),
        'captain': any(t.upper().strip('()') == 'C' for t in tokens[i:j]),
    }, j)


def split_row(line, home_by_number, away_by_number):
    """(home_entry, away_entry) for one two-column row, or None."""
    tokens = line.split()
    home = _entry(tokens, home_by_number)
    if not home:
        return None
    _, used = home
    # The away half begins where the home half ends. Scanning forward, the
    # first start that resolves is the right one: "X 3 KYRIAKIDES Daniel"
    # parses both with and without the X — shirt 3 exists either way — and the
    # marker belongs to the entry, so the earlier reading is the true one.
    # The entry must also account for the rest of the row; a reading that
    # leaves tokens behind has mis-split it.
    for start in range(used, len(tokens)):
        away = _entry(tokens[start:], away_by_number)
        if not away:
            continue
        # What follows the away player's name is the card columns, and they
        # hold the minute a card was shown — "GOYET François (C) 26" — so a
        # row is fully accounted for when nothing but numbers is left over.
        rest = tokens[start + away[1]:]
        if all(t.isdigit() for t in rest):
            return home[0], away[0]
    return None


HEADER = re.compile(r'^Minute\s+Shirt', re.I)
GOAL_HEADER = re.compile(r'^Team\s+Minute\s+Number\s+Action', re.I)
GOAL_ROW = re.compile(r'^([A-Z]{3})\s+(\d{1,2})\s+(\d{1,2})\s+([A-Z]{2})\s+(\d+)\s*-\s*(\d+)$')
STAFF = re.compile(r'^(Coach|Team Manager|Umpire|Scoring Judge|Timing Judge|'
                   r'Technical Officer|Reserve Umpire)\b', re.I)


def parse(lines, home_squad, away_squad, on_reject=None):
    """
    {home: {...}, away: {...}, goals: [...]} from the report's text lines.

    Returns None unless both sides parse to a full eleven starters, because a
    half-read sheet is worse than the estimate it would replace.
    """
    home_by_number = {p['number']: p for p in home_squad if p.get('number')}
    away_by_number = {p['number']: p for p in away_squad if p.get('number')}

    rows_home, rows_away = [], []
    reading = False
    goals, in_goals = [], False
    for line in lines:
        if HEADER.match(line):
            reading = True
            continue
        if GOAL_HEADER.match(line):
            reading, in_goals = False, True
            continue
        if reading:
            if STAFF.match(line):
                reading = False
                continue
            # Card counts trail the name; they are read from the competition
            # report instead, which states them per player without ambiguity.
            row = line
            pair = split_row(row, home_by_number, away_by_number)
            if pair:
                rows_home.append(pair[0])
                rows_away.append(pair[1])
            elif on_reject and row.strip():
                # One unreadable row leaves ten starters and loses the whole
                # sheet, so a rejection has to say which row and why rather
                # than leaving the caller to guess.
                on_reject(row)
            continue
        if in_goals:
            m = GOAL_ROW.match(line.strip())
            if m:
                goals.append({
                    'team': m.group(1), 'minute': int(m.group(2)),
                    'number': int(m.group(3)), 'via': m.group(4),
                    'score': [int(m.group(5)), int(m.group(6))],
                })
            elif line.startswith('FG -'):
                in_goals = False

    def side(rows):
        starters = [r for r in rows if r['started']]
        subs = [r for r in rows if not r['started']]
        return {'startingXI': starters, 'substitutes': subs}

    if len(side(rows_home)['startingXI']) != 11 or len(side(rows_away)['startingXI']) != 11:
        return None
    return {'home': side(rows_home), 'away': side(rows_away), 'goals': goals}
