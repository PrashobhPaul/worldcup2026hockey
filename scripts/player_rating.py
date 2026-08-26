"""
Hockey.AI — the positional player rating.

A player is judged against what his position is actually responsible for. The
pipeline runs one chain:

    raw match record
      -> components (volume + efficiency + impact)
      -> percentile within position
      -> position weights
      -> rating 0-100

Three rules hold the whole thing up.

1.  A component is a named thing with named inputs. If the record does not
    carry those inputs, the component is not scored 0 — it is declared
    unavailable, its weight is taken out, and the remaining weights are
    renormalised. A rating always says how much of its own model it stands on.

2.  Normalisation is by percentile inside the position group, not by dividing
    by a maximum. "Seven tackles" means nothing on its own; "better than 82%
    of the defenders at this tournament" means something, and it is the same
    sentence for every component, so components are comparable to each other.

3.  Volume, efficiency and impact are kept apart inside a component. Five
    goals from twenty shots and three goals from eight are different players,
    and a model that only counts goals cannot tell them apart.

The component set below is the full one. Most of it is unavailable today:
the FIH publishes goals, cards, appearances and results for this competition,
and nothing else — no shots, passes, circle entries, tackles or saves. Those
components are written out in full anyway, with the inputs they need, so that
the day a source for them lands the model gains a dimension instead of being
rewritten. What is available is marked, and every surface shows the coverage.

Nothing here is an FIH rating. It is Hockey.AI's, and it says so wherever it
is printed.
"""

# ── Components ────────────────────────────────────────────────────────────
# Each: what it measures, which raw fields it needs, and how it is computed.
# `needs` names fields on the player row; a component whose fields are all
# missing or None across the whole group is unavailable.

AVAILABILITY = 'availability'
SCORING = 'scoring'
SET_PIECE = 'set_piece'
OPEN_PLAY = 'open_play'
TEAM_DEFENCE = 'team_defence'
CLUTCH = 'clutch'
TALISMAN = 'talisman'
DISCIPLINE = 'discipline'
MATCH_CONTEXT = 'match_context'
# Declared, not yet fed by any source.
CHANCE_CREATION = 'chance_creation'
CIRCLE_IMPACT = 'circle_impact'
PROGRESSION = 'progression'
POSSESSION = 'possession'
DEFENSIVE_ACTIONS = 'defensive_actions'
DUELS = 'duels'
PRESSING = 'pressing'
SHOT_STOPPING = 'shot_stopping'
PC_DEFENCE = 'pc_defence'
DISTRIBUTION = 'distribution'

COMPONENTS = {
    AVAILABILITY:      {'label': 'Availability',      'needs': ['games_played']},
    SCORING:           {'label': 'Scoring',           'needs': ['goals']},
    SET_PIECE:         {'label': 'Set pieces',        'needs': ['pc_scored']},
    OPEN_PLAY:         {'label': 'Open play',         'needs': ['goals', 'pc_scored']},
    TEAM_DEFENCE:      {'label': 'Goals against',     'needs': ['team_ga_per_match']},
    CLUTCH:            {'label': 'Fourth quarter',    'needs': ['late_goals']},
    TALISMAN:          {'label': 'Share of attack',   'needs': ['goal_share']},
    DISCIPLINE:        {'label': 'Discipline',        'needs': ['card_points']},
    MATCH_CONTEXT:     {'label': 'Match context',     'needs': ['team_points_per_match']},
    CHANCE_CREATION:   {'label': 'Chance creation',   'needs': ['key_passes', 'assists']},
    CIRCLE_IMPACT:     {'label': 'Circle impact',     'needs': ['circle_entries']},
    PROGRESSION:       {'label': 'Progression',       'needs': ['progressive_passes', 'carries']},
    POSSESSION:        {'label': 'Possession',        'needs': ['passes_completed', 'turnovers']},
    DEFENSIVE_ACTIONS: {'label': 'Defensive actions', 'needs': ['tackles', 'interceptions']},
    DUELS:             {'label': '1v1 defending',     'needs': ['duels_won', 'duels']},
    PRESSING:          {'label': 'Pressing',          'needs': ['pressures']},
    SHOT_STOPPING:     {'label': 'Shot stopping',     'needs': ['saves', 'shots_faced']},
    PC_DEFENCE:        {'label': 'Penalty corners',   'needs': ['pc_saves', 'pc_faced']},
    DISTRIBUTION:      {'label': 'Distribution',      'needs': ['outlets_completed']},
}

# ── Position weights ──────────────────────────────────────────────────────
# What each position is asked to do. Weights sum to 1 inside a position; the
# engine renormalises over whatever is available, so these stay readable as
# intent rather than being tuned to today's coverage.

WEIGHTS = {
    'Forward': {
        SCORING: 0.30, CIRCLE_IMPACT: 0.15, OPEN_PLAY: 0.10, CHANCE_CREATION: 0.15,
        POSSESSION: 0.08, PRESSING: 0.07, TALISMAN: 0.05, CLUTCH: 0.05,
        AVAILABILITY: 0.03, DISCIPLINE: 0.02,
    },
    'Midfielder': {
        PROGRESSION: 0.25, POSSESSION: 0.18, CHANCE_CREATION: 0.17,
        DEFENSIVE_ACTIONS: 0.17, SCORING: 0.08, TALISMAN: 0.05, CLUTCH: 0.04,
        AVAILABILITY: 0.03, DISCIPLINE: 0.03,
    },
    'Defender': {
        DEFENSIVE_ACTIONS: 0.26, TEAM_DEFENCE: 0.18, PROGRESSION: 0.16,
        POSSESSION: 0.12, DUELS: 0.10, SET_PIECE: 0.09, AVAILABILITY: 0.05,
        DISCIPLINE: 0.04,
    },
    'Goalkeeper': {
        SHOT_STOPPING: 0.38, PC_DEFENCE: 0.20, TEAM_DEFENCE: 0.20,
        DISTRIBUTION: 0.10, AVAILABILITY: 0.08, DISCIPLINE: 0.04,
    },
}

# ── Match context ─────────────────────────────────────────────────────────
# The standard a performance was produced against, applied the way the
# architecture always called for it — Performance x Context — rather than as
# another weighted component.
#
# It was tried as a component first and that was wrong. The engine
# redistributes the weight of components the record cannot feed, so a
# component that is always available grows exactly where coverage is thinnest:
# a declared 12% became 37.5% of a midfielder's rating, and the XI filled with
# players who were in it because their country won matches rather than because
# they did anything. As a bounded multiplier it cannot do that.
#
# The floor is the claim being made: a performance for the weakest side in the
# tournament is worth 88% of the same performance for the strongest. Nothing
# is zeroed and nobody is excluded for the company they keep.
CONTEXT_FLOOR = 0.88

SCALE_MIN, SCALE_MAX = 40.0, 99.0


def _pct(values, invert=False):
    """Percentile rank 0-100 for each value against the others.

    Ties share a rank, so two players on the same figure cannot be separated
    by list order. An empty or single-valued group returns the midpoint: with
    nothing to compare against, a percentile is not a claim worth making.
    """
    vals = [v for v in values if v is not None]
    if len(set(vals)) <= 1:
        return {i: 50.0 for i, v in enumerate(values) if v is not None}
    lo, hi = min(vals), max(vals)
    out = {}
    for i, v in enumerate(values):
        if v is None:
            continue
        below = sum(1 for w in vals if w < v)
        same = sum(1 for w in vals if w == v)
        rank = (below + same / 2.0) / len(vals) * 100.0
        out[i] = 100.0 - rank if invert else rank
    del lo, hi
    return out


def _raw(row, comp, group_has_appearances=False):
    """The component's raw figure for one player, or None if unsupported.

    Volume, efficiency and impact are combined here, per component, and each
    returns a single comparable figure. Where a rate is the honest reading —
    goals against, share of attack — the rate is what is returned, so a player
    is not rewarded for his team having played more matches.
    """
    g = row.get('goals') or 0
    pc = row.get('pc_scored') or 0
    ps = row.get('ps_scored') or 0
    mp = row.get('games_played')
    if comp == AVAILABILITY:
        return None if mp is None else float(mp)

    if comp == SCORING:
        # Per appearance where the whole group's appearance counts are known,
        # so a starter is not out-scored on volume alone — and totals for the
        # whole group where they are not. Never a mix: two players measured in
        # different units cannot be ranked against each other.
        if not group_has_appearances:
            return float(g)
        return (g / mp) if mp else 0.0
    if comp == SET_PIECE:
        return float(pc + ps)
    if comp == OPEN_PLAY:
        return float(max(0, g - pc - ps))
    if comp == TEAM_DEFENCE:
        v = row.get('team_ga_per_match')
        return None if v is None else float(v)
    if comp == CLUTCH:
        v = row.get('late_goals')
        return None if v is None else float(v)
    if comp == TALISMAN:
        v = row.get('goal_share')
        return None if v is None else float(v)
    if comp == MATCH_CONTEXT:
        # The standard a performance was produced against.
        #
        # Without it the model asks only "how well did he play his position",
        # and a player carrying a side that went out in the pools outranks one
        # in a side that reached the semi-finals — because nothing in a
        # forward's or midfielder's model knows what his team was up against.
        # Points per match is the record's own answer to how far a side got,
        # and it is percentile-ranked like every other component rather than
        # being applied as a hidden multiplier: it appears in the breakdown
        # with its weight, so a reader can see it and disagree with it.
        v = row.get('team_points_per_match')
        return None if v is None else float(v)
    if comp == DISCIPLINE:
        pts = row.get('card_points')
        if pts is None:
            return None
        return float(pts) / mp if mp else float(pts)
    # Everything else needs a source the record does not carry yet.
    needs = COMPONENTS[comp]['needs']
    if any(row.get(n) is None for n in needs):
        return None
    return float(sum(row.get(n) or 0 for n in needs))


# Components where a lower figure is the better performance.
LOWER_IS_BETTER = {TEAM_DEFENCE, DISCIPLINE}


def rate_group(rows, position):
    """
    Rate every player of one position against the others in that position.

    `rows` are dicts of raw figures. Returns a list of
        {rating, components: {key: {label, score, weight, raw}}, coverage}
    aligned with `rows`. A player with no appearances is returned unrated:
    there is nothing to rate, and a zero would rank him against players who
    took the field.
    """
    weights = WEIGHTS.get(position)
    if not weights:
        return [None] * len(rows)

    # A percentile only means something when everyone in the group is measured
    # the same way. The FIH's appearance figures are read a squad at a time, so
    # mid-refresh some players in a group carry an appearance count and others
    # do not — and scoring the first group on Availability while the second is
    # renormalised without it ranks two halves of a position against different
    # models. A component counts for the group only when the group is complete
    # on it.
    group_has_appearances = all(r.get('games_played') is not None for r in rows)
    raws = {c: [_raw(r, c, group_has_appearances) for r in rows] for c in weights}
    scores = {c: _pct(raws[c], invert=c in LOWER_IS_BETTER) for c in weights}
    available = {c for c in weights if all(v is not None for v in raws[c])}

    # Context is scored across the group like everything else, but it never
    # joins the weighted sum — see the note above CONTEXT_FLOOR.
    context_raw = [_raw(r, MATCH_CONTEXT) for r in rows]
    context_score = (_pct(context_raw)
                     if all(v is not None for v in context_raw) else {})

    out = []
    for i, row in enumerate(rows):
        mine = {c: scores[c][i] for c in available}
        total_w = sum(weights[c] for c in mine)
        if not total_w or row.get('games_played') == 0:
            out.append(None)
            continue
        pct = sum(weights[c] * mine[c] for c in mine) / total_w
        performance = SCALE_MIN + (SCALE_MAX - SCALE_MIN) * pct / 100.0
        ctx = context_score.get(i)
        factor = 1.0 if ctx is None else CONTEXT_FLOOR + (1 - CONTEXT_FLOOR) * ctx / 100.0
        rating = performance * factor
        out.append({
            'rating': round(rating, 1),
            'performance': round(performance, 1),
            # Stated separately because it is a different kind of claim from
            # the components: not what he did, but what he did it against.
            'context': None if ctx is None else {
                'label': COMPONENTS[MATCH_CONTEXT]['label'],
                'score': round(ctx, 1),
                'factor': round(factor, 3),
                'raw': round(context_raw[i], 3),
            },
            'position': position,
            # Every component that fed the number, with the share it carried,
            # so the rating can be read rather than taken on trust.
            'components': {
                c: {
                    'label': COMPONENTS[c]['label'],
                    'score': round(mine[c], 1),
                    'weight': round(weights[c] / total_w, 3),
                    'raw': round(raws[c][i], 3) if raws[c][i] is not None else None,
                }
                for c in sorted(mine, key=lambda k: -weights[k])
            },
            # How much of the position's model this rating actually rests on.
            'coverage': round(total_w, 3),
            'components_missing': sorted(set(weights) - set(mine)),
        })
    return out
