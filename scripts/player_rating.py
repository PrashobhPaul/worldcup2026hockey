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

WORKLOAD = 'workload'
GOAL_VALUE = 'goal_value'
FINISHING = 'finishing'
SET_PIECE = 'set_piece'
TALISMAN = 'talisman'
ON_PITCH_DEF = 'on_pitch_defence'
ON_PITCH_ATT = 'on_pitch_attack'
CLEAN_SHEETS = 'clean_sheets'
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
    WORKLOAD:          {'label': 'Workload',          'needs': ['start_share', 'app_share']},
    GOAL_VALUE:        {'label': 'Goal value',        'needs': ['goal_value']},
    FINISHING:         {'label': 'Finishing',         'needs': ['fg_scored']},
    SET_PIECE:         {'label': 'Set pieces',        'needs': ['pc_scored']},
    TALISMAN:          {'label': 'Share of attack',   'needs': ['goal_share']},
    ON_PITCH_DEF:      {'label': 'Conceded on pitch', 'needs': ['on_pitch_ga']},
    ON_PITCH_ATT:      {'label': 'Scored on pitch',   'needs': ['on_pitch_gf']},
    CLEAN_SHEETS:      {'label': 'Clean sheets',      'needs': ['on_pitch_cs']},
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

# WORKLOAD is not among these. It used to be a weighted component here — 16
# to 34% depending on the position — and that was not enough to stop a player
# who barely played from rating well: James Hickson, never once started,
# still combined a 92nd-percentile goal value with a 91st-percentile
# finishing rate into a top-quarter forward rating, because 68% of a
# forward's weight sat in components that do not ask how much of the
# tournament he actually played. It is a bounded multiplier on the whole
# performance instead, the same shape as CONTEXT_FLOOR below and for the same
# reason: a weighted component can be outvoted by the others no matter how
# badly a player scores on it, and a multiplier cannot be.
#
# Its weight still had to go somewhere, and splitting it evenly across
# whatever remained pushed goal-scoring components straight through the two
# guardrails a few paragraphs down: a forward's finishing, goal value and
# talisman would have summed to 81%, a defender's set pieces and goal value
# to 46%. Workload used to sit between goals and the rating precisely because
# it measured neither, so its share goes to the components that also do not —
# Scored/Conceded on pitch and Discipline — rather than backfilling the space
# it leaves with more goals.
WEIGHTS = {
    'Forward': {
        FINISHING: 0.28, GOAL_VALUE: 0.24, TALISMAN: 0.16,
        ON_PITCH_ATT: 0.22, DISCIPLINE: 0.10,
    },
    'Midfielder': {
        GOAL_VALUE: 0.34, ON_PITCH_ATT: 0.23,
        ON_PITCH_DEF: 0.20, DISCIPLINE: 0.23,
    },
    'Defender': {
        ON_PITCH_DEF: 0.42, SET_PIECE: 0.20,
        GOAL_VALUE: 0.16, DISCIPLINE: 0.22,
    },
    'Goalkeeper': {
        ON_PITCH_DEF: 0.56, CLEAN_SHEETS: 0.30, DISCIPLINE: 0.14,
    },
    # The line the record cannot name.
    #
    # The FIH states a position for 48 of 320 entrants and marks the other 272
    # "Squad", so every outfield line here is inferred from how a player's
    # goals were scored — which says nothing at all about a player who has not
    # scored. That left 186 travelling players unrated, 119 of whom started
    # matches: Argentina's Matias Rey started all five as co-captain and
    # carried no number at all.
    #
    # They are rated here instead, against each other, on what the record does
    # hold about them: what their side did while they were on the pitch, and
    # their discipline. It is a narrower model and the coverage figure says
    # so. What it is not is silence about half the tournament.
    'Outfield': {
        GOAL_VALUE: 0.30, ON_PITCH_ATT: 0.21,
        ON_PITCH_DEF: 0.21, DISCIPLINE: 0.28,
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

# ── Playing time ──────────────────────────────────────────────────────────
# The second multiplier: not what he did, but how much of the tournament he
# actually did it in. A coach who starts a player five times has made a
# different claim about him than one who sends him on for the last ten
# minutes five times, and the components above cannot see that difference —
# they only see what happened while he was out there.
#
# Bounded for the same reason CONTEXT_FLOOR is. WORKLOAD is percentile-ranked
# like every other component, and the floor is much lower than the context
# floor's 88%, because how much a player actually played is a fact about him,
# not an indirect signal like his side's results — a value worth suppressing
# hard rather than nudging. 0.55 still left James Hickson — never started,
# four goals from the bench — in the upper half of the forward board, tied
# with a cluster of five-start regulars a handful of points above him; at
# 0.45 he sits clearly under every one of them.
PLAYING_TIME_FLOOR = 0.45

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


# What a substitute appearance is worth against a start, for the purpose of
# rating a player's attacking output.
#
# Hockey rolls substitutions continuously and the FIH does not publish when a
# substitute came on for this competition, so there is no minutes-played
# figure to weigh a cameo against — "appearances" is the only count available,
# and shrinkage was trusting five of them as readily as five full starts. That
# is what let James Hickson, never once started, rate 6th of 31 forwards on
# four goals scored from the bench: shrunk over a same-size sample as a
# player who started every match, his rate barely moved off its unshrunk
# value, because appearances treated a cameo and a start as the same match.
#
# BENCH_CREDIT is not a minutes estimate; nothing here claims to know how long
# a substitute actually played. It is a stated, printed discount on how much
# an appearance that was not a start counts towards the sample the shrinkage
# below trusts, in the same spirit as GOAL_STATE_WEIGHT and CONTEXT_FLOOR: an
# editorial number the reader can see and disagree with, not a fact pulled
# from a source that does not exist for this tournament. The rate itself is
# unchanged — four goals from five appearances is still divided by five; it
# is the confidence placed in that rate, before it is blended towards the
# group's, that a cameo no longer earns on equal terms with a start.
BENCH_CREDIT = 0.3


def _playing_time(row):
    """Starts, plus a discounted credit for appearances that were not one."""
    started = row.get('started') or 0
    ap = row.get('appearances') or 0
    return started + BENCH_CREDIT * max(0, ap - started)


def _raw(row, comp, group_has_appearances=False):
    """The component's raw figure for one player, or None if unsupported.

    Every figure here is a rate, not a total. Totals reward the player whose
    side played more matches and the one who came on for the last ten minutes
    of six of them; the question a rating answers is what he did with the time
    he had. The rate itself is still per appearance — how confidently it is
    trusted, against _playing_time, is a separate question the shrinkage below
    answers.
    """
    ap = row.get('appearances')
    started = row.get('started') or 0

    if comp == WORKLOAD:
        # Starting is the claim a coach makes about a player, and it is the
        # single strongest signal the FIH publishes for someone who does not
        # score. Appearances count for a quarter of it, so a used substitute
        # is ahead of a man who never left the bench.
        ss, aps = row.get('start_share'), row.get('app_share')
        if ss is None or aps is None:
            return None
        return 0.75 * ss + 0.25 * aps

    if comp == GOAL_VALUE:
        # The rate itself is still per appearance — dividing by the discounted
        # playing time here, instead of only shrinking against it below, made
        # the same four goals a bigger number for a five-time substitute than
        # for a five-time starter, which is backwards: a smaller time on the
        # same output is not a stronger claim. The discount belongs in how
        # much the shrinkage below trusts this rate, not in the rate.
        v = row.get('goal_value')
        if v is None:
            return None
        return (v / ap) if ap else 0.0

    if comp == FINISHING:
        fg = row.get('fg_scored')
        if fg is None:
            return None
        return (fg / ap) if ap else 0.0

    if comp == SET_PIECE:
        pc, ps = row.get('pc_scored'), row.get('ps_scored')
        if pc is None or ps is None:
            return None
        return ((pc + ps) / ap) if ap else 0.0

    if comp == TALISMAN:
        v = row.get('goal_share')
        return None if v is None else float(v)

    if comp == ON_PITCH_DEF:
        # Conceded per match started — his side's record while he was on it,
        # not the flat team figure both keepers of a squad used to share.
        # A player with no starts has no on-pitch record; the component is
        # unavailable for him rather than scored as though he kept a clean
        # sheet by sitting out.
        v = row.get('on_pitch_ga')
        return None if v is None or not started else float(v) / started

    if comp == ON_PITCH_ATT:
        v = row.get('on_pitch_gf')
        return None if v is None or not started else float(v) / started

    if comp == CLEAN_SHEETS:
        v = row.get('on_pitch_cs')
        return None if v is None or not started else float(v) / started

    if comp == MATCH_CONTEXT:
        v = row.get('team_points_per_match')
        return None if v is None else float(v)

    if comp == DISCIPLINE:
        pts = row.get('card_points')
        if pts is None:
            return None
        return float(pts) / ap if ap else float(pts)

    # Everything else needs a source the record does not carry yet.
    needs = COMPONENTS[comp]['needs']
    if any(row.get(n) is None for n in needs):
        return None
    return float(sum(row.get(n) or 0 for n in needs))


# Components where a lower figure is the better performance.
LOWER_IS_BETTER = {ON_PITCH_DEF, DISCIPLINE}

# Rate components, and the count each rate is measured over. These are the
# ones shrunk towards the group mean: a figure over one match is a weaker
# claim than the same figure over five, and the rating should say so.
SHRINK = {
    ON_PITCH_DEF: lambda r: r.get('started') or 0,
    ON_PITCH_ATT: lambda r: r.get('started') or 0,
    CLEAN_SHEETS: lambda r: r.get('started') or 0,
    # Playing time, not appearance count — the same discount _raw already
    # divides by, so the sample a component is shrunk over is the same sample
    # its rate was computed against. Shrinking these three on raw appearances
    # while dividing by playing time would call five cameos a five-match
    # sample in one line and a mostly-discounted 1.5 in the next.
    GOAL_VALUE: _playing_time,
    FINISHING: _playing_time,
    SET_PIECE: _playing_time,
    DISCIPLINE: lambda r: r.get('appearances') or 0,
}

# How many matches the group's own average is worth as a prior. Two is a
# little under half a group stage: enough that a single match cannot carry a
# player to the top of a board, not so much that five matches of real evidence
# are drowned by it.
PRIOR_MATCHES = 2.0


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
    group_has_appearances = all(r.get('appearances') is not None for r in rows)
    raws = {c: [_raw(r, c, group_has_appearances) for r in rows] for c in weights}

    # A player who never started has no on-pitch record, and that is a fact
    # about him rather than a gap in the source. Left as missing it triggered
    # the group-completeness rule below and took the two components that
    # matter most away from every goalkeeper in the tournament, because the
    # reserve keepers never played: a keeper's coverage fell to 38% and his
    # rating became workload and discipline. He is ranked level with the worst
    # on-pitch record actually observed in his group instead — conservative,
    # inside the real range, and never better than a man who took the field.
    for c in (ON_PITCH_DEF, ON_PITCH_ATT, CLEAN_SHEETS):
        if c not in weights:
            continue
        seen_vals = [v for v in raws[c] if v is not None]
        if not seen_vals:
            continue
        worst = max(seen_vals) if c in LOWER_IS_BETTER else min(seen_vals)
        for i, r in enumerate(rows):
            if raws[c][i] is None and not (r.get('started') or 0):
                raws[c][i] = worst

    # Completeness and shrinkage are both judged over the players who will
    # actually be rated. Two travelling players are on no team sheet at all —
    # they were never named in a match squad — and their blanks were dropping
    # Workload for all 179 players in the Outfield group. A player who cannot
    # be rated cannot decide what the rest are rated on.
    rateable = [i for i, r in enumerate(rows) if (r.get('appearances') or 0) > 0]

    # Small samples, shrunk towards the group.
    #
    # Every component here is a rate, and a rate over one match is not the same
    # claim as a rate over five. Unshrunk, a defender who started once and
    # whose side conceded one goal that day scored a better "conceded per match
    # started" than a man who started all five — and he was picked ahead of him
    # for it. Each rate is pulled towards the group mean in proportion to how
    # little of it there is: with a prior worth PRIOR_MATCHES matches, one
    # start carries a third of its own number and five carries five-sixths.
    for c, sample_size in SHRINK.items():
        if c not in weights:
            continue
        obs = [(i, raws[c][i], float(sample_size(rows[i])))
               for i in rateable if raws[c][i] is not None]
        weighted = [v * n for _, v, n in obs]
        total_n = sum(n for _, _, n in obs)
        if not total_n:
            continue
        prior = sum(weighted) / total_n
        for i, v, n in obs:
            raws[c][i] = (v * n + prior * PRIOR_MATCHES) / (n + PRIOR_MATCHES)

    scores = {c: _pct(raws[c], invert=c in LOWER_IS_BETTER) for c in weights}
    available = {c for c in weights
                 if rateable and all(raws[c][i] is not None for i in rateable)}

    # Context and playing time are scored across the group like everything
    # else, but neither joins the weighted sum — see the notes above
    # CONTEXT_FLOOR and PLAYING_TIME_FLOOR.
    context_raw = [_raw(r, MATCH_CONTEXT) for r in rows]
    context_score = (_pct(context_raw)
                     if all(v is not None for v in context_raw) else {})
    workload_raw = [_raw(r, WORKLOAD) for r in rows]
    workload_score = (_pct(workload_raw)
                      if all(v is not None for v in workload_raw) else {})

    out = []
    for i, row in enumerate(rows):
        # An unrateable player can be missing a component score entirely; he
        # is returned unrated just below, and asking for his percentile first
        # is what raised a KeyError.
        mine = {c: scores[c][i] for c in available if i in scores[c]}
        total_w = sum(weights[c] for c in mine)
        if not total_w or not (row.get('appearances') or 0):
            out.append(None)
            continue
        pct = sum(weights[c] * mine[c] for c in mine) / total_w
        performance = SCALE_MIN + (SCALE_MAX - SCALE_MIN) * pct / 100.0
        ctx = context_score.get(i)
        ctx_factor = 1.0 if ctx is None else CONTEXT_FLOOR + (1 - CONTEXT_FLOOR) * ctx / 100.0
        wl = workload_score.get(i)
        wl_factor = 1.0 if wl is None else PLAYING_TIME_FLOOR + (1 - PLAYING_TIME_FLOOR) * wl / 100.0
        rating = performance * ctx_factor * wl_factor
        out.append({
            'rating': round(rating, 1),
            'performance': round(performance, 1),
            # Stated separately because it is a different kind of claim from
            # the components: not what he did, but what he did it against.
            'context': None if ctx is None else {
                'label': COMPONENTS[MATCH_CONTEXT]['label'],
                'score': round(ctx, 1),
                'factor': round(ctx_factor, 3),
                'raw': round(context_raw[i], 3),
            },
            # A third kind of claim again: not what he did and not what he did
            # it against, but how much of the tournament he actually did it
            # in — starts weighted well above a used substitute's appearances,
            # exactly as the Workload component always measured it.
            'playing_time': None if wl is None else {
                'label': COMPONENTS[WORKLOAD]['label'],
                'score': round(wl, 1),
                'factor': round(wl_factor, 3),
                'raw': round(workload_raw[i], 3),
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
