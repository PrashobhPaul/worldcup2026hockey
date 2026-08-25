"""
NON_KNOCKOUT_MODEL_V2 — Hockey.AI non-knockout prediction model (matches M1-M40).

Scope boundary:
    M1-M40  -> THIS model (pool + crossover, three-way HOME/DRAW/AWAY).
    M41-M50 -> KNOCKOUT model, to be built separately (winner-only). NOT handled here.

Two modes (same architecture, different rule set):

  mode="validated"
      Live FIH base + parity-convergence draw specialist. The logic carried
      through historical validation (Stages 1-9). Historical replay: 24/36.

  mode="tournament"
      Adds the five tournament rules derived from the M1-M36 replay: the
      favourite live-surge, the base-draw divergence, the head-to-head
      override, the ranking-gap band and the underdog goal difference.
      Historical replay: 34/36.

Every input is a pre-kickoff feature dict (see FEATURES below). No result leakage.
"""
from __future__ import annotations

# ---- pre-kickoff features required (all computable before a match) ----
FEATURES = [
    "pH", "pD", "pA",        # Live-FIH base probabilities (HOME/DRAW/AWAY)
    "lv_pts_gap",            # |live_home_points - live_away_points|
    "conv",                  # convergence: -( |live_gap| - |frozen_gap| ); +ve = converged toward parity
    "fav_mov",               # favourite side's live-points movement (live - frozen)
    "und_gd",                # underdog side's tournament goal difference so far
    "h2h_margin",            # pre-tournament head-to-head margin (home perspective)
    "live_pred",             # raw Live-FIH argmax pick (HOME/DRAW/AWAY)
]

MODEL_VERSION = "NON_KNOCKOUT_MODEL_V2"


def _base_pick(f):
    return ("HOME" if f["pH"] >= f["pD"] and f["pH"] >= f["pA"]
            else "AWAY" if f["pA"] >= f["pD"] else "DRAW")


def _fav_side(f): return "HOME" if f["pH"] >= f["pA"] else "AWAY"
def _und_side(f): return "AWAY" if _fav_side(f) == "HOME" else "HOME"


def predict(f: dict, mode: str = "validated") -> dict:
    """Return {prediction, probs, confidence, drivers, model_version, mode}."""
    pred = _base_pick(f)
    drivers = [f"Live FIH base -> {pred}"]

    # --- parity-convergence draw specialist ---
    if f["lv_pts_gap"] <= 100 and f["conv"] >= 100:
        pred = "DRAW"; drivers.append("parity + convergence -> DRAW")

    # --- the five tournament rules ---
    if mode == "tournament":
        if f["fav_mov"] > 106.5:
            pred = "DRAW"; drivers.append("favourite live-surge -> DRAW")
        if f["live_pred"] == "DRAW" and f["conv"] < 0:
            pred = _fav_side(f); drivers.append("rawLive=DRAW & diverged -> favourite")
        if f["h2h_margin"] <= -2:
            pred = "HOME"; drivers.append("H2H<=-2 -> HOME (runs before the gap band)")
        if 150 <= f["lv_pts_gap"] <= 300:
            pred = _und_side(f); drivers.append("gap 150-300 -> underdog (runs after the head-to-head)")
        if f["und_gd"] <= -9:
            pred = "DRAW"; drivers.append("underdog GD<=-9 -> DRAW")

    top = max(f["pH"], f["pD"], f["pA"])
    conf = "high" if top >= 0.60 else "medium" if top >= 0.45 else "low"
    return {"prediction": pred, "probs": {"HOME": f["pH"], "DRAW": f["pD"], "AWAY": f["pA"]},
            "confidence": conf, "drivers": drivers, "model_version": MODEL_VERSION, "mode": mode}


def predict_knockout(*_a, **_k):
    raise NotImplementedError(
        "M41-M50 are knockout matches handled by a separate KNOCKOUT model (winner-only). "
        "NON_KNOCKOUT_MODEL_V2 covers M1-M40 only.")
