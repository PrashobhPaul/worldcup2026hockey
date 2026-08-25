"""
Prediction Router — multi-expert architecture for Hockey.AI (RESEARCH / retrospective).

    Production/FIH model ─┐
    Live FIH expert ──────┤
    Draw-layer specialist ┤──► MATCH CONTEXT ──► PREDICTION ROUTER ──► FINAL PREDICTION
                          │
    (knockout? gap? live/frozen diff? form? tournament state? draw candidate?)

Two modes:
  - "validated"     : uses ONLY signals that survived historical validation (Stages 1-5).
                      Net effect on the 36 completed matches = Live FIH (24/36). The draw
                      specialist flags genuine parity draws (which Live already catches) and
                      correctly ABSTAINS on upset draws (unpredictable from validated signals).
  - "retrospective" : additionally applies the tournament-tournament switches discovered on the
                      2026 World Cup. These are set aside for generalization (R1 = listing-order
                      artifact; gap-band = 5-match anomaly; momentum = reversed historically).
                      They exist only to show the retrospective ceiling. DO NOT DEPLOY.

Production is never modified. This module is a read-only research harness.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Literal

Pred = Literal["HOME", "DRAW", "AWAY"]


# ----------------------------------------------------------------------------- experts
def production_expert(m: dict) -> Pred:
    """Shipped model (frozen FIH + form + H2H). On the 36 it agrees with Live/Frozen 36/36."""
    return m["prod"]


def live_fih_expert(m: dict) -> Pred:
    """Live-ranking expert. This is the 24/36 baseline."""
    return m["live"]


def frozen_fih_expert(m: dict) -> Pred:
    return m["frozen"]


def favourite_side(m: dict) -> Pred:
    """The stronger side by live points — used to resolve knockouts (shootout, no draw)."""
    return m["fav_side"]


# ------------------------------------------------------------------- draw-layer specialist
# VALIDATED parity thresholds. The only draw signal that survived Stages 1-5 is genuine
# parity + convergence (Live's own p_draw already encodes this). We make it explicit here.
PARITY_GAP = 100.0     # live FIH points gap at/below which the match is "close"
CONV_MIN = 100.0       # live points must have CONVERGED toward parity (not diverged)


def draw_specialist(m: dict) -> dict:
    """Returns a draw-risk assessment from VALIDATED parity signals only.

    Fires only when the two sides are close AND the live ranking converged toward parity.
    It deliberately does NOT try to predict upset draws (weak team holding a strong one):
    Stages 1-5 proved those are not separable from wins by any validated pre-match feature.
    """
    close = m["lv_pts_gap"] <= PARITY_GAP
    converged = m["conv"] >= CONV_MIN
    parity_draw = close and converged
    return {
        "parity_draw": parity_draw,
        "draw_risk": "HIGH" if parity_draw else "LOW",
        "reason": (f"gap {m['lv_pts_gap']:.0f}<= {PARITY_GAP:.0f} and converged "
                   f"{m['conv']:+.0f}>= {CONV_MIN:.0f}") if parity_draw else "no validated parity signal",
    }


# ------------------------------------------------------------------------- match context
def match_context(m: dict) -> dict:
    spec = draw_specialist(m)
    return {
        "knockout": m.get("knockout", False),
        "fih_gap": m["lv_pts_gap"],
        "live_frozen_diff": m["conv"],          # +ve = converged toward parity
        "form_gap": m["h_gd"] - m["a_gd"],
        "stage": m.get("stage", "pool"),
        "draw_candidate": spec["parity_draw"],
        "draw_risk": spec["draw_risk"],
    }


# ------------------------------------------------------------ tournament switches
# RETROSPECTIVE ONLY. Every one of these was set aside for generalization. Kept solely to
# reproduce the 2026 retrospective ceiling. Never enable in production.
def _tournament_rules(pred: Pred, m: dict) -> tuple[Pred, str | None]:
    fav, und = m["fav_side"], ("AWAY" if m["fav_side"] == "HOME" else "HOME")
    gap = m["lv_pts_gap"]
    # A (set aside: 5-match 150-300 anomaly, p~1.8%)
    if 150 <= gap <= 300:
        return und, "TOURNAMENT-A gap-band->underdog [set aside anomaly]"
    # B (set aside: momentum mean-reversion, reversed historically)
    fav_mov = m["mov_h"] if m["fav_side"] == "HOME" else m["mov_a"]
    if fav_mov > 106.5:
        return "DRAW", "TOURNAMENT-B favourite-surge->draw [set aside, reversed on history]"
    # C (tournament rule)
    und_gd = m["a_gd"] if m["fav_side"] == "HOME" else m["h_gd"]
    if und_gd <= -9:
        return "DRAW", "TOURNAMENT-C underdog-GD->draw [tournament rule]"
    return pred, None


# ------------------------------------------------------------------------------- router
def route(m: dict, mode: str = "validated") -> dict:
    ctx = match_context(m)
    trace = []

    if ctx["knockout"]:
        # Knockouts resolve by shootout: never predict DRAW; take the favourite.
        pred = favourite_side(m)
        trace.append("knockout -> favourite (shootout resolves draws)")
        # (validated tournament-specific switches for knockouts: none survived)
        return {"prediction": pred, "context": ctx, "trace": trace}

    # -------- non-knockout: primary + Live + draw specialist + selective corrections
    pred = live_fih_expert(m)
    trace.append(f"base = Live FIH -> {pred}")

    # Draw layer: elevate DRAW only under validated parity + draw-risk.
    if ctx["draw_candidate"] and pred != "DRAW":
        pred = "DRAW"
        trace.append(f"draw specialist fired ({ctx['draw_risk']}): -> DRAW")
    elif ctx["draw_candidate"]:
        trace.append("draw specialist agrees with Live (already DRAW)")

    if mode == "retrospective":
        newpred, why = _tournament_rules(pred, m)
        if why:
            trace.append(f"{why}: {pred} -> {newpred}")
            pred = newpred

    return {"prediction": pred, "context": ctx, "trace": trace}


# --------------------------------------------------------------------------- evaluation
def evaluate(matches: list[dict], mode: str = "validated") -> dict:
    correct = 0
    rows = []
    for m in matches:
        out = route(m, mode=mode)
        ok = out["prediction"] == m["actual"]
        correct += ok
        rows.append({
            "num": m["num"], "match": f"{m['home']}-{m['away']}",
            "production": production_expert(m), "live": live_fih_expert(m),
            "draw_spec": "DRAW" if out["context"]["draw_candidate"] else "-",
            "router": out["prediction"], "actual": m["actual"], "ok": ok,
            "trace": " | ".join(out["trace"]),
        })
    return {"mode": mode, "correct": correct, "n": len(matches), "rows": rows}


if __name__ == "__main__":
    import json, os
    here = os.path.dirname(os.path.abspath(__file__))
    matches = json.load(open(os.path.join(here, "router_input_36.json")))
    for mode in ("validated", "retrospective"):
        res = evaluate(matches, mode=mode)
        print(f"\n=== ROUTER [{mode}] : {res['correct']}/{res['n']} "
              f"({100*res['correct']/res['n']:.1f}%) ===")
        for r in res["rows"]:
            if not r["ok"] or r["draw_spec"] == "DRAW":
                flag = "OK " if r["ok"] else "xx "
                print(f"  {flag}M{r['num']:<2} {r['match']:<8} "
                      f"prod={r['production']:<4} live={r['live']:<4} "
                      f"router={r['router']:<4} actual={r['actual']:<4}")
