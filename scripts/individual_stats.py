"""
Hockey.AI — the FIH's own individual statistics.

Two public competition reports state per player what this app had only been
deriving from the event ledger:

    /competitions/{id}/reports/scorers   goals split field / corner / stroke
    /competitions/{id}/reports/cards     cards split red / yellow / green

They are the governing body's figures for its own tournament, so where they
speak they are the record and the ledger is the estimate — not the other way
round.

Both reports end in a Totals row, and both parsers reconcile against it before
returning anything. A report that does not add up to its own stated totals is
refused whole: a partly-read statistics table is indistinguishable from a
complete one once it is published, which is what makes it worth refusing.

The scorers report is a plain table and reads from text alone:

    Rank Team # Player            FG PC PS Goals
    1    ARG 21 DOMENE Tomas       3  3  2     8
    53   IND 70 Sanjay             0  1  0     1

The cards report is not, and this is the whole difficulty of it:

    Team Shirt # Name           Red Yellow Green
    ARG  7       KEENAN Nicolas               1
    PAK  5       KHAN Sufyan       1          2

Empty cells leave no trace in extracted text, so "KEENAN Nicolas 1" could be
one red, one yellow or one green, and nothing in the line says which. The
column is recovered from where the digit sits on the page: each cell is
assigned to the header it falls under. That is why this parser reads words
with their coordinates rather than lines of text.
"""
import re

SCORER_ROW = re.compile(
    r'^(\d+)\s+([A-Z]{3})\s+(\d{1,3})\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$')
SCORER_TOTALS = re.compile(r'^Totals\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$')
CARD_TOTALS = re.compile(r'^Totals\s+(\d+)\s+(\d+)\s+(\d+)$')
CARD_COLUMNS = ('red', 'yellow', 'green')


def parse_scorers(lines):
    """[{team, number, name, fg, pc, ps, goals}] or None if it does not add up."""
    rows, totals = [], None
    for line in lines:
        m = SCORER_TOTALS.match(line.strip())
        if m:
            totals = tuple(int(g) for g in m.groups())
            continue
        m = SCORER_ROW.match(line.strip())
        if not m:
            continue
        fg, pc, ps, goals = (int(m.group(i)) for i in (5, 6, 7, 8))
        if fg + pc + ps != goals:
            # A row that contradicts itself has been mis-split, and one
            # mis-split row is enough to make the whole table untrustworthy.
            print(f'  SCORERS: row does not add up, refusing the report: {line}')
            return None
        rows.append({'team': m.group(2), 'number': int(m.group(3)),
                     'name': m.group(4).strip(), 'fg': fg, 'pc': pc,
                     'ps': ps, 'goals': goals})
    if not rows or not totals:
        return None
    got = tuple(sum(r[k] for r in rows) for k in ('fg', 'pc', 'ps', 'goals'))
    if got != totals:
        print(f'  SCORERS: read {got}, report states {totals} — refusing it.')
        return None
    return rows


def _columns(word_rows):
    """x-centres of the Red / Yellow / Green headers, or None."""
    for words in word_rows:
        text = ' '.join(w[0] for w in words)
        if not re.search(r'\bRed\s+Yellow\s+Green\b', text):
            continue
        at = {}
        for token, x0, x1 in words:
            key = token.strip().casefold()
            if key in CARD_COLUMNS:
                at[key] = (x0 + x1) / 2
        if len(at) == 3:
            return at
    return None


def parse_cards(word_rows):
    """[{team, number, name, red, yellow, green}] or None if it does not add up.

    `word_rows` is the page laid out as it is printed: one list per line of
    (text, x0, x1). The coordinates are the point of it — see the note above.
    """
    columns = _columns(word_rows)
    if not columns:
        print('  CARDS: no Red/Yellow/Green header found — refusing the report.')
        return None
    order = sorted(columns, key=columns.get)
    # Where the name column ends and the card block begins. A number to the
    # left of it is part of a name or a shirt; a number to the right of it is
    # a count, and belongs to whichever header it sits nearest.
    block_starts = min(columns.values()) - 20

    rows, totals = [], None
    for words in word_rows:
        tokens = [w[0] for w in words]
        text = ' '.join(tokens)
        m = CARD_TOTALS.match(text.strip())
        if m:
            totals = {c: int(g) for c, g in zip(CARD_COLUMNS, m.groups())}
            continue
        if len(tokens) < 3 or not re.match(r'^[A-Z]{3}$', tokens[0]):
            continue
        if not tokens[1].isdigit():
            continue
        counts = [w for w in words[2:]
                  if w[0].isdigit() and (w[1] + w[2]) / 2 >= block_starts]
        if not counts:
            continue
        name_words = [w[0] for w in words[2:] if (w[1] + w[2]) / 2 < block_starts]
        row = {'team': tokens[0], 'number': int(tokens[1]),
               'name': ' '.join(name_words).strip(), 'red': 0, 'yellow': 0, 'green': 0}
        for token, x0, x1 in counts:
            centre = (x0 + x1) / 2
            column = min(order, key=lambda c: abs(columns[c] - centre))
            row[column] += int(token)
        rows.append(row)
    if not rows or not totals:
        return None
    got = {c: sum(r[c] for r in rows) for c in CARD_COLUMNS}
    if got != totals:
        print(f'  CARDS: read {got}, report states {totals} — refusing it.')
        return None
    return rows
