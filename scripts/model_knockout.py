#!/usr/bin/env python3
"""KNOCKOUT_MODEL_V2 — the pick rule for every match that cannot be drawn.

    pool + stage 2 (40)   -> model_non_knockout.py, three-way with a draw.
    classification, semis,
    the two medal finals  -> this model, two-way ADVANCE.

That is the only reason there are two models: a pool match can be drawn and a
knockout cannot. Both read the same live evidence — every match already played
in this tournament — through the same pipeline.

Dynamic, not a one-off fit
--------------------------
The model carries no learned constant. On every run it re-learns its weights
from the matches already completed, so the 49th match is predicted from 48
results and the 50th from 49. Evidence is cut by KICKOFF, not by date: the
bronze and gold finals share a day, and the gold final must learn from the
bronze one played two and a half hours earlier.

Bracket-aware
-------------
A knockout pairing is read as a matchup, not as two ratings. Each side's
attack is set against the other's defence, in both directions, and the two
gaps are weighted separately by what the record so far says each is worth.
When the bracket sends a side into a different opponent than expected, the
comparison is redrawn against that opponent before the match is played.

Structure the record fixes, and nothing else
--------------------------------------------
Three things are measured from the completed matches every run:

  · the weight of the attack gap and of the defence gap (fitted with no bias
    term — a knockout has no home side, every match is at one of two venues
    and the bracket decides which name prints first);
  · how far a knockout compresses an evidence gap, as the ratio of knockout
    to pool winning margins — sides that reach the same knockout are close by
    construction;
  · how often a knockout is level after sixty minutes.

A shoot-out is scored at exactly one half. The record holds too few of them to
claim any side is better at them, and a tilt that cannot be evidenced is a
tilt that has been invented.
"""
import json
import math
import os

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

with open(os.path.join(_ROOT, 'model', 'params.json')) as _fh:
    _CONFIG = json.load(_fh)

KM = _CONFIG['knockout_model']
MODEL_VERSION = KM['version']
NON_KNOCKOUT_PHASES = ('pool', 'stage2')

# The strengths and weaknesses offered to the learner. It decides which of
# them separate sides: a component the record does not support is driven to a
# weight of nought and stops speaking, which is exactly what happens to attack.
#
# The candidate set is deliberately short. Offering all nine rating components
# was tried and is worse — walked forward over the played knockouts it scores
# 3/8 at a log-loss of 0.713, losing to a coin flip, because nine weights on
# thirty-odd decisive matches fits noise. Two candidates score 5/8 at 0.678.
# The set lives in model/params.json so it can widen as the record grows.
COMPONENTS = tuple(KM.get('learn_components') or ('attack', 'defence'))


def kickoff_key(m):
    """Sort key that orders two matches on the same day by their kickoff."""
    return (m.get('date') or '', m.get('time') or '')


def evidence_before(match, matches):
    """Every match already completed by the time this one starts.

    Cut by kickoff rather than by date. The medal finals share 30 August —
    bronze at 14:00, gold at 16:30 — and the gold final is entitled to the
    bronze final's result. A match still to be played contributes nothing
    whatever its date.
    """
    cut = kickoff_key(match)
    return sorted(
        (m for m in matches
         if m is not match
         and m['status'] == 'completed'
         and (m.get('score') or {}).get('home') is not None
         and kickoff_key(m) < cut),
        key=kickoff_key)


def _sigmoid(z):
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, z))))


def _decisive(m):
    """Who won, shoot-out included. None if the record cannot say."""
    s = m['score']
    if s['home'] != s['away']:
        return 'HOME' if s['home'] > s['away'] else 'AWAY'
    so = m.get('shootout')
    if so and so['home'] != so['away']:
        return 'HOME' if so['home'] > so['away'] else 'AWAY'
    return None


def learn(history, rate_teams):
    """Re-derive every constant from the matches played so far.

    `rate_teams` is passed in rather than imported so that the pipeline, the
    backtest and the tests all drive the one rating function in
    scripts/team_rating.py — the single central source for what a side's
    attack and defence are worth.
    """
    prior_w = KM['prior_weight']
    params = {
        'weights': {c: prior_w.get(c, 0.0) for c in COMPONENTS},
        'attack_weight': prior_w['attack'],
        'defence_weight': prior_w['defence'],
        'compression': KM['prior_compression'],
        'level_rate': KM['prior_level_rate'],
        'learned_from': len(history),
        'decisive_used': 0,
    }
    if len(history) < KM['min_history']:
        return params

    # ── how much each gap is worth, learned with no home term ──────────────
    # A knockout result says more about the next knockout than a pool result
    # does. The model already asserts these rounds differ structurally — it
    # compresses the gap for them — so it weighs their evidence accordingly
    # rather than treating all forty-eight matches as one undifferentiated
    # pile. The multiplier is structure, like the compression, not a number
    # tuned against results.
    rel = KM['knockout_relevance']
    rows = []
    for i, m in enumerate(history):
        won = _decisive(m)
        if won is None:
            continue
        rated = rate_teams(history[:i]) if i else {}
        f = features(m['home'], m['away'], rated)
        if f is None:
            continue
        weight = rel if m['phase'] not in NON_KNOCKOUT_PHASES else 1.0
        rows.append((f, 1.0 if won == 'HOME' else 0.0, weight))
    if len(rows) >= KM['min_history']:
        w = [prior_w.get(c, 0.0) for c in COMPONENTS]
        l2, lr = KM['l2'], KM['learn_rate']
        tot = sum(r[2] for r in rows)
        for _ in range(KM['iterations']):
            g = [0.0] * len(COMPONENTS)
            for f, y, wt in rows:
                x = [f.get(f'{c}_gap', 0.0) for c in COMPONENTS]
                z = sum(wi * xi for wi, xi in zip(w, x))
                e = (_sigmoid(z) - y) * wt
                for i, xi in enumerate(x):
                    g[i] += e * xi
            w = [wi - lr * (gi / tot + l2 * wi) for wi, gi in zip(w, g)]
            # Neither gap may earn a negative weight. A negative weight says a
            # side wins BECAUSE it attacks worse, or defends worse, which no
            # mechanism supports — it is noise being fitted, and it does real
            # damage: on the gold final a learned attack weight of -0.62 was
            # cancelling the defence signal to leave the card reading exactly
            # 50%, an even call arrived at by two errors rather than by parity.
            # The learner keeps every freedom that means anything: it can still
            # drive a gap to nought when the record says it does not separate
            # sides, and it does exactly that with attack.
            w = [max(0.0, wi) for wi in w]
        params['weights'] = dict(zip(COMPONENTS, w))
        params['attack_weight'] = params['weights']['attack']
        params['defence_weight'] = params['weights']['defence']
        params['decisive_used'] = len(rows)

    # ── how far a knockout compresses a gap, and how often it stays level ──
    def margin(ms):
        return (sum(abs(m['score']['home'] - m['score']['away']) for m in ms)
                / len(ms)) if ms else None

    pool = [m for m in history if m['phase'] in NON_KNOCKOUT_PHASES]
    ko = [m for m in history if m['phase'] not in NON_KNOCKOUT_PHASES]
    mp, mk = margin(pool), margin(ko)
    if mp and mk and len(ko) >= KM['min_knockouts']:
        params['compression'] = max(0.2, min(1.0, mk / mp))
    if len(ko) >= KM['min_knockouts']:
        level = sum(1 for m in ko if m['score']['home'] == m['score']['away'])
        params['level_rate'] = max(KM['level_floor'],
                                   min(KM['level_cap'], level / len(ko)))
    return params


def features(home, away, rated):
    """The bracket matchup: each attack against the other's defence.

    Returns None when the record cannot yet describe one of the two sides —
    a gap is not guessed at.
    """
    h, a = rated.get(home), rated.get(away)
    if not h or not a:
        return None

    def comp(row, name):
        c = (row.get('components') or {}).get(name)
        return c['score'] if c else None

    out = {}
    for name in COMPONENTS:
        ch, ca = comp(h, name), comp(a, name)
        out[f'{name}_gap'] = ((ch - ca) / 100.0) if (ch is not None and ca is not None) else 0.0
    if not any(out.values()) and comp(h, 'defence') is None:
        return None
    # Kept under their old names because the drivers read from them.
    out['att_gap'] = out.get('attack_gap', 0.0)
    out['def_gap'] = out.get('defence_gap', 0.0)
    return out


def predict(f, params, evidence_n=None):
    """Advance split, regulation branch, and the reasoning behind them."""
    drivers = []
    if f is None:
        edge = 0.0
        drivers.append('the record cannot yet describe both sides — called even')
    else:
        wts = params.get('weights') or {'attack': params['attack_weight'],
                                        'defence': params['defence_weight']}
        raw = sum(wt * f.get(f'{c}_gap', 0.0) for c, wt in wts.items())
        edge = raw * params['compression']
        first = 'the first-named side' if raw > 0 else 'the second-named side'
        if abs(raw) < 1e-9:
            drivers.append('the matchup is level on this record')
        else:
            spoke = sorted(((abs(wt * f.get(f'{c}_gap', 0.0)), c) for c, wt in wts.items()),
                           reverse=True)[:2]
            named = ', '.join(f'{c.replace("_", " ")} '
                              f'{abs(f.get(f"{c}_gap", 0.0)) * 100:.0f}'
                              for size, c in spoke if size > 1e-9)
            drivers.append(
                f'{first} holds the matchup on {named or "the record"} '
                f'percentile points, compressed '
                f'{params["compression"]:.2f}x for a knockout field')

    if evidence_n is not None and evidence_n < KM['full_evidence_matches']:
        shrink = max(0.0, evidence_n / KM['full_evidence_matches'])
        edge *= shrink
        drivers.append(f'{evidence_n} match(es) of evidence — claim shrunk {shrink:.2f}x')

    level = params['level_rate'] * math.exp(-abs(edge) / KM['level_width'])
    level = max(KM['level_floor'], min(KM['level_cap'], level))
    p_home_reg = (1.0 - level) * _sigmoid(edge)
    p_away_reg = (1.0 - level) - p_home_reg
    adv_home = p_home_reg + level * KM['shootout_home_share']

    drivers.append(f'level after 60 at {level * 100:.0f}%, the shoot-out at even '
                   f"(learned from {params['learned_from']} completed matches)")

    def _share(*vals):
        out = [round(v, 4) for v in vals[:-1]]
        return out + [round(1.0 - sum(out), 4)]

    r_home, r_level, r_away = _share(p_home_reg, level, p_away_reg)
    a_home, a_away = _share(adv_home, 1.0 - adv_home)
    pick = 'HOME' if adv_home >= 0.5 else 'AWAY'
    top = max(adv_home, 1.0 - adv_home)
    return {
        'advance': {'HOME': a_home, 'AWAY': a_away},
        'regulation': {'HOME': r_home, 'LEVEL': r_level, 'AWAY': r_away},
        'prediction': pick,
        'confidence': ('high' if top >= KM['high_confidence']
                       else 'medium' if top >= KM['medium_confidence'] else 'low'),
        'drivers': drivers,
        'model_version': MODEL_VERSION,
        'learned_from': params['learned_from'],
    }


def predict_match(match, matches, rate_teams):
    """One call, the whole chain: evidence to date -> learn -> matchup -> pick.

    This is what the pipeline, the backtest and the tests all use, so a
    prediction cannot be produced two different ways.
    """
    history = evidence_before(match, matches)
    params = learn(history, rate_teams)
    rated = rate_teams(history) if history else {}
    f = features(match['home'], match['away'], rated)
    played = min(sum(1 for m in history if code in (m['home'], m['away']))
                 for code in (match['home'], match['away'])) if history else 0
    return predict(f, params, evidence_n=played)
