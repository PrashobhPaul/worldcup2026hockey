"""
Hockey.AI — the team rating.

Same architecture as the player rating, one level up: components with named
inputs, percentile-normalised across the sixteen teams, weighted, and carrying
their own breakdown so the number can be read.

The point of this file is not a league table — the standings already are one.
It is evidence. A pick that says "Netherlands" should be able to point at the
components that make Netherlands the pick, in this tournament's own numbers,
and a reader should be able to see which of them the two sides actually differ
on. So every component here is something a rationale can quote in a sentence.

Everything is a rate per match, never a total: teams reach this stage having
played different numbers of matches, and a total rewards survival rather than
performance.
"""

ATTACK = 'attack'
FINISHING = 'finishing'
SET_PIECE = 'set_piece'
DEFENCE = 'defence'
CLEAN_SHEETS = 'clean_sheets'
CONTROL = 'control'
CLOSING = 'closing'
STARTING = 'starting'
DISCIPLINE = 'discipline'

COMPONENTS = {
    ATTACK:       {'label': 'Attack',          'unit': 'goals scored per match'},
    FINISHING:    {'label': 'Open play',       'unit': 'field goals per match'},
    SET_PIECE:    {'label': 'Set pieces',      'unit': 'penalty-corner and stroke goals per match'},
    DEFENCE:      {'label': 'Defence',         'unit': 'goals conceded per match'},
    CLEAN_SHEETS: {'label': 'Clean sheets',    'unit': 'share of matches without conceding'},
    CONTROL:      {'label': 'Match control',   'unit': 'points won per match'},
    CLOSING:      {'label': 'Fourth quarter',  'unit': 'goal difference from the 46th minute'},
    STARTING:     {'label': 'First quarter',   'unit': 'goal difference in the opening 15'},
    DISCIPLINE:   {'label': 'Discipline',      'unit': 'card points per match'},
}

WEIGHTS = {
    ATTACK: 0.20, DEFENCE: 0.20, CONTROL: 0.18, SET_PIECE: 0.12,
    FINISHING: 0.10, CLEAN_SHEETS: 0.08, CLOSING: 0.06, STARTING: 0.03,
    DISCIPLINE: 0.03,
}

LOWER_IS_BETTER = {DEFENCE, DISCIPLINE}
SCALE_MIN, SCALE_MAX = 40.0, 99.0
CARD_POINTS = {'green_card': 1, 'yellow_card': 2, 'red_card': 5}
LATE_FROM_MINUTE = 46
EARLY_TO_MINUTE = 15


def collect(matches):
    """{code: {raw component figures}} from the completed matches only."""
    rows = {}
    def row(code):
        return rows.setdefault(code, {
            'mp': 0, 'gf': 0, 'ga': 0, 'pts': 0, 'clean': 0,
            'field': 0, 'set_piece': 0, 'late_for': 0, 'late_against': 0,
            'early_for': 0, 'early_against': 0, 'card_points': 0,
        })

    for m in matches:
        if m.get('status') != 'completed':
            continue
        score = m.get('score') or {}
        if score.get('home') is None or score.get('away') is None:
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            r = row(m[side])
            gf, ga = score[side], score[opp]
            r['mp'] += 1
            r['gf'] += gf
            r['ga'] += ga
            r['pts'] += 3 if gf > ga else 1 if gf == ga else 0
            r['clean'] += 1 if ga == 0 else 0
        for e in m.get('events') or []:
            code = e.get('team')
            if code not in rows:
                continue
            minute = e.get('minute') or 0
            other = m['away'] if code == m['home'] else m['home']
            if e.get('type') == 'goal':
                via = e.get('via')
                if via in ('PC', 'PS', 'STROKE'):
                    rows[code]['set_piece'] += 1
                elif via != 'SO':
                    rows[code]['field'] += 1
                if via != 'SO':
                    if minute >= LATE_FROM_MINUTE:
                        rows[code]['late_for'] += 1
                        if other in rows:
                            rows[other]['late_against'] += 1
                    elif minute <= EARLY_TO_MINUTE:
                        rows[code]['early_for'] += 1
                        if other in rows:
                            rows[other]['early_against'] += 1
            else:
                rows[code]['card_points'] += CARD_POINTS.get(e.get('type'), 0)
    return rows


def _figure(r, comp):
    mp = r['mp']
    if not mp:
        return None
    if comp == ATTACK:       return r['gf'] / mp
    if comp == FINISHING:    return r['field'] / mp
    if comp == SET_PIECE:    return r['set_piece'] / mp
    if comp == DEFENCE:      return r['ga'] / mp
    if comp == CLEAN_SHEETS: return r['clean'] / mp
    if comp == CONTROL:      return r['pts'] / mp
    if comp == CLOSING:      return (r['late_for'] - r['late_against']) / mp
    if comp == STARTING:     return (r['early_for'] - r['early_against']) / mp
    if comp == DISCIPLINE:   return r['card_points'] / mp
    return None


def _pct(values, invert=False):
    vals = [v for v in values if v is not None]
    if len(set(vals)) <= 1:
        return {i: 50.0 for i, v in enumerate(values) if v is not None}
    out = {}
    for i, v in enumerate(values):
        if v is None:
            continue
        below = sum(1 for w in vals if w < v)
        same = sum(1 for w in vals if w == v)
        rank = (below + same / 2.0) / len(vals) * 100.0
        out[i] = 100.0 - rank if invert else rank
    return out


def rate_teams(matches):
    """{code: {rating, components: {...}, figures: {...}}} across all teams."""
    rows = collect(matches)
    codes = sorted(rows)
    if not codes:
        return {}
    figures = {c: [_figure(rows[code], c) for code in codes] for c in WEIGHTS}
    scores = {c: _pct(figures[c], invert=c in LOWER_IS_BETTER) for c in WEIGHTS}

    out = {}
    for i, code in enumerate(codes):
        mine = {c: scores[c][i] for c in WEIGHTS if i in scores[c]}
        total_w = sum(WEIGHTS[c] for c in mine)
        if not total_w:
            continue
        pct = sum(WEIGHTS[c] * mine[c] for c in mine) / total_w
        out[code] = {
            'rating': round(SCALE_MIN + (SCALE_MAX - SCALE_MIN) * pct / 100.0, 1),
            'matches': rows[code]['mp'],
            'components': {
                c: {
                    'label': COMPONENTS[c]['label'],
                    'unit': COMPONENTS[c]['unit'],
                    'score': round(mine[c], 1),
                    'weight': round(WEIGHTS[c] / total_w, 3),
                    'figure': round(figures[c][i], 3),
                }
                for c in sorted(mine, key=lambda k: -WEIGHTS[k])
            },
            'coverage': round(total_w, 3),
        }
    return out


def edge(ratings, home, away, top=3):
    """The components two sides differ on most, largest gap first.

    This is what a rationale quotes: not "Netherlands are better", but the
    two or three things this tournament says they are better at, with both
    figures beside each other.
    """
    a, b = ratings.get(home), ratings.get(away)
    if not a or not b:
        return []
    gaps = []
    for key, ca in a['components'].items():
        cb = b['components'].get(key)
        if not cb:
            continue
        gaps.append({
            'component': key,
            'label': ca['label'],
            'unit': COMPONENTS[key]['unit'],
            'home_figure': ca['figure'],
            'away_figure': cb['figure'],
            'home_score': ca['score'],
            'away_score': cb['score'],
            'favours': home if ca['score'] > cb['score'] else away if cb['score'] > ca['score'] else None,
            'gap': round(abs(ca['score'] - cb['score']), 1),
            # What the gap is worth. A fifty-point gap on a component carrying
            # eight per cent of the rating separates two sides less than a
            # twenty-point gap on one carrying a fifth of it, and ranking on
            # the raw gap put clean sheets and card counts above attack and
            # defence in a tie between the two best teams in the tournament.
            'weight': ca['weight'],
            'swing': round(abs(ca['score'] - cb['score']) * ca['weight'], 2),
        })
    gaps.sort(key=lambda g: -g['swing'])
    return gaps[:top]
