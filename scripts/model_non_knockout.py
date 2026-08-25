#!/usr/bin/env python3
"""NON_KNOCKOUT_MODEL_V2 — the pick rule for every match that can be drawn.

Scope, and why it is drawn where it is:

    pool + stage 2 (40 matches)  -> this model, three-way HOME/DRAW/AWAY.
    classification + knockouts   -> unchanged two-way split; level after sixty
                                    minutes goes to a shootout, so there is no
                                    draw to predict and none of this applies.

The model is a layer, not a replacement. Underneath it the ranking-points
base still produces the three probabilities exactly as before — that base is
what the app's simulation reads, so the published pick and the in-app numbers
cannot drift apart. On top of it sits one rule that the base cannot express:

    two sides within `parity_gap` live ranking points of each other, whose gap
    has closed by at least `convergence_points` since the baseline table, are
    called a draw.

The reasoning is that a gap which is *closing* says something a gap which is
merely *small* does not. Two neighbours who have always been neighbours are an
ordinary close match; two sides who arrived far apart and have converged over a
fortnight of this tournament are meeting at a genuine level, and level hockey
between level sides draws far more often than a smooth curve admits.

Two modes, selected by `mode` in model/params.json:

  mode "validated"
      The ranking-points base plus that one draw rule. Reference replay 24/36.

  mode "tournament" (the published rule set)
      Adds the five tournament rules the model author derived from the 2026
      replay: the favourite live-surge, the base-draw divergence, the
      head-to-head override, the ranking-gap band and the underdog goal
      difference. They are applied in that order — the gap band runs after the
      head-to-head and can reverse it. Reference replay 34/36.

The author's original is kept verbatim at
reference/model_v3/non_knockout_model_v2.py, and scripts/test_non_knockout_model.py
holds this port to both of its reference numbers.

Every feature is computable before push-back. Nothing here reads a score,
a table position, or anything else that only exists once the match is over.

Thresholds live in model/params.json with the rest of the model constants.
"""
import json
import os

_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

with open(os.path.join(_ROOT, 'model', 'params.json')) as _fh:
    _CONFIG = json.load(_fh)

NK = _CONFIG['non_knockout_model']
MODEL_VERSION = NK['version']
DEFAULT_MODE = NK['mode']

# The pre-push-back features the model reads. Listed here because the backtest
# and the pipeline must build the identical dict, from different directions.
FEATURES = (
    'pH', 'pD', 'pA',        # base probabilities from ranking points
    'lv_pts_gap',            # |live home points - live away points|
    'conv',                  # -(|live gap| - |baseline gap|); +ve = converged
    'fav_mov',               # favourite's live points minus its baseline points
    'und_gd',                # underdog's goal difference in this tournament so far
    'h2h_margin',            # pre-tournament head-to-head, home wins minus home losses
    'live_pred',             # the base's own argmax pick
)


def base_pick(f):
    """The base's call: whichever of the three the ranking points make likeliest."""
    if f['pH'] >= f['pD'] and f['pH'] >= f['pA']:
        return 'HOME'
    return 'AWAY' if f['pA'] >= f['pD'] else 'DRAW'


def _fav_side(f):
    return 'HOME' if f['pH'] >= f['pA'] else 'AWAY'


def _und_side(f):
    return 'AWAY' if _fav_side(f) == 'HOME' else 'HOME'


def _aligned(probs, pick):
    """Make the published distribution agree with the published pick.

    The app prints the pick beside its own probability. A card reading
    "Draw (18%)" directly above a Home bar at 55% is not a subtle
    inconsistency, it is the product contradicting itself in one sentence.
    So when the draw rule overrides the base's call, the distribution moves
    with it: the draw takes the top line by `align_lead`, and the remaining
    mass stays with home and away in the ratio the ranking points gave them.
    Order and relative strength are preserved; only the claim being asserted
    changes, which is the whole point of the override.
    """
    ph, pd, pa = probs
    if not NK.get('align_probabilities', True) or pick != 'DRAW':
        return probs
    top = max(ph, pa)
    if pd > top:
        return probs
    target = min(1.0, top + NK['align_lead'])
    rest = ph + pa
    if rest <= 0:
        return 0.0, 1.0, 0.0
    scale = (1.0 - target) / rest
    return round(ph * scale, 3), round(target, 3), round(pa * scale, 3)


def predict(f, mode=None):
    """Return the pick, the distribution that supports it, and why.

    `f` is a FEATURES dict. Returns
    {prediction, probs, confidence, drivers, model_version, mode}.
    """
    mode = mode or DEFAULT_MODE
    pred = base_pick(f)
    drivers = [f'ranking-points base -> {pred}']

    # -- the validated rule: parity reached by convergence, not by accident --
    conv = f.get('conv')
    if (conv is not None
            and f['lv_pts_gap'] <= NK['parity_gap']
            and conv >= NK['convergence_points']):
        pred = 'DRAW'
        drivers.append(
            f"within {NK['parity_gap']} ranking points and closed by "
            f"{conv:.0f} since the baseline -> DRAW")

    # -- the five tournament rules, in the order they are applied --
    if mode == 'tournament':
        t = NK['tournament_mode']
        if f.get('fav_mov') is not None and f['fav_mov'] > t['favourite_surge_points']:
            pred = 'DRAW'; drivers.append('favourite live-surge -> DRAW')
        if f['live_pred'] == 'DRAW' and conv is not None and conv < 0:
            pred = _fav_side(f); drivers.append('base=DRAW and diverged -> favourite')
        if f.get('h2h_margin') is not None and f['h2h_margin'] <= t['h2h_margin_max']:
            pred = 'HOME'; drivers.append('head-to-head -> HOME')
        lo, hi = t['gap_band']
        if lo <= f['lv_pts_gap'] <= hi:
            pred = _und_side(f); drivers.append('gap band -> underdog')
        if f.get('und_gd') is not None and f['und_gd'] <= t['underdog_gd_max']:
            pred = 'DRAW'; drivers.append('underdog goal difference -> DRAW')

    ph, pd, pa = _aligned((f['pH'], f['pD'], f['pA']), pred)
    top = max(ph, pd, pa)
    confidence = 'high' if top >= 0.60 else 'medium' if top >= 0.45 else 'low'
    return {
        'prediction': pred,
        'probs': {'HOME': ph, 'DRAW': pd, 'AWAY': pa},
        'confidence': confidence,
        'drivers': drivers,
        'model_version': MODEL_VERSION,
        'mode': mode,
    }


def build_features(base_probs, live_home, live_away, frozen_home, frozen_away,
                   und_gd=None, h2h_margin=None):
    """Assemble a FEATURES dict from the inputs each caller has to hand.

    live_*/frozen_* are raw world-ranking points — the live table for the day
    of the match, and the baseline table the series is measured from. Either
    baseline may be None for a match played before ranking capture began; the
    convergence feature is then absent rather than guessed, and the draw rule
    simply cannot fire.
    """
    ph, pd, pa = base_probs
    f = {'pH': ph, 'pD': pd, 'pA': pa,
         'und_gd': und_gd, 'h2h_margin': h2h_margin}
    f['live_pred'] = base_pick(f)
    live_gap = abs(live_home - live_away)
    f['lv_pts_gap'] = live_gap
    if frozen_home is None or frozen_away is None:
        f['conv'] = None
        f['fav_mov'] = None
        return f
    f['conv'] = -(live_gap - abs(frozen_home - frozen_away))
    fav_live, fav_frozen = ((live_home, frozen_home) if f['live_pred'] != 'AWAY'
                            and ph >= pa else (live_away, frozen_away))
    f['fav_mov'] = fav_live - fav_frozen
    return f
