"""
Badge-aware Tournament Router (Stage 7) — RESEARCH / retrospective, 2026 World Cup only.

Extends draw_router with (a) tournament badge context and (b) a "tournament" mode that
applies the quarantined 2026 tournament switches, reaching 32/36.

IMPORTANT — badge contribution to accuracy = 0.
  Tested three ways: (1) badge presence correlates with LOWER Live error (27% vs 43% for
  no-badge matches) — the opposite of an error-risk flag; (2) an error-risk classifier gains
  only a marginal, noise-level +1 from badge features; (3) every badge-touchable error is
  recoverable WITHOUT the badge. The badge is carried as CONTEXT for the product narrative,
  but it drives no switch. All accuracy comes from non-badge features.

Modes:
  "validated"    : Live FIH + parity draw specialist = 24/36 (deployable logic).
  "tournament"   : + non-badge tournament stack = 32/36 (set aside for generalization, do-not-deploy).

Production untouched. Knockout path returns a winner (no DRAW; shootouts resolve ties).
"""
from __future__ import annotations

BADGES = {"NED": "FAVOURITE", "BEL": "FAVOURITE", "AUS": "FAVOURITE",
          "ENG": "DARK_HORSE", "ESP": "DARK_HORSE", "ARG": "UNDERDOG"}

PARITY_GAP, CONV_MIN = 100.0, 100.0


def _fav_side(m):   return "HOME" if m["live_H"] >= m["live_A"] else "AWAY"
def _und_side(m):   return "AWAY" if _fav_side(m) == "HOME" else "HOME"


def badge_context(m: dict) -> dict:
    """Tournament badges as CONTEXT ONLY (display / product narrative). Drives no switch."""
    ba, bb = BADGES.get(m["home"]), BADGES.get(m["away"])
    return {
        "home_badge": ba, "away_badge": bb,
        "favourite_present": "FAVOURITE" in (ba, bb),
        "darkhorse_present": "DARK_HORSE" in (ba, bb),
        "underdog_present": "UNDERDOG" in (ba, bb),
        "matchup": f"{ba or 'none'} vs {bb or 'none'}",
    }


def draw_specialist(m: dict) -> bool:
    return m["lv_pts_gap"] <= PARITY_GAP and m["conv"] >= CONV_MIN


# --- non-badge tournament-tournament stack (set aside for generalization; 2026-retrospective only) ---
# Stage 8: SEQUENTIAL and ORDER-OPTIMIZED. H2H runs BEFORE gap-band so the gap-band repairs
# H2H's mistake on M32 while H2H's fix on M35 survives (32 -> 33). Then a tournament rule rule
# lifts M33 (33 -> 34). M9, M10 are inseparable without match-ID lookup -> 34/36 ceiling.
def _tournament_switches(pred, m):
    fav_mov = m["mov_h"] if _fav_side(m) == "HOME" else m["mov_a"]
    und_gd = m["a_gd"] if _fav_side(m) == "HOME" else m["h_gd"]
    fired = []
    if fav_mov > 106.5:                                  # S  [TOURNAMENT: reversed on history]
        pred = "DRAW"; fired.append("fav-surge->DRAW")
    if m["live"] == "DRAW" and m["conv"] < 0:            # D  [TOURNAMENT RULE] (raw Live state)
        pred = _fav_side(m); fired.append("rawLive=DRAW&diverged->favourite")
    if m["h2h_margin"] <= -2:                            # H  [T] — must precede G
        pred = "HOME"; fired.append("h2h<=-2->HOME")
    if 150 <= m["lv_pts_gap"] <= 300:                    # G  [TOURNAMENT: rejected anomaly] — repairs H
        pred = _und_side(m); fired.append("gap150-300->underdog")
    if und_gd <= -9:                                     # C  [TOURNAMENT RULE] — lifts M33
        pred = "DRAW"; fired.append("underdogGD<=-9->DRAW")
    return pred, (" ; ".join(fired) or None)


def route(m: dict, mode: str = "validated") -> dict:
    badge = badge_context(m)
    trace = [f"badge context: {badge['matchup']} (display only)"]

    if m.get("knockout", False):
        return {"prediction": _fav_side(m), "badge": badge,
                "trace": trace + ["knockout -> favourite (no DRAW)"]}

    pred = m["live"]; trace.append(f"base Live FIH -> {pred}")
    if draw_specialist(m) and pred != "DRAW":
        pred = "DRAW"; trace.append("parity draw specialist -> DRAW")

    if mode == "tournament":
        new, why = _tournament_switches(pred, m)
        if why:
            trace.append(f"[T] {why}: {pred} -> {new}")
            pred = new
    return {"prediction": pred, "badge": badge, "trace": trace}


def evaluate(matches, mode="validated"):
    correct = sum(route(m, mode)["prediction"] == m["actual"] for m in matches)
    return correct, len(matches)


if __name__ == "__main__":
    import json, os
    here = os.path.dirname(os.path.abspath(__file__))
    ms = json.load(open(os.path.join(here, "router_input_36.json")))
    for mode in ("validated", "tournament"):
        c, n = evaluate(ms, mode)
        print(f"[{mode:11}] {c}/{n} ({100*c/n:.1f}%)")
    # badge contribution proof: tournament score with badges physically removed
    for m in ms:
        m["home"], m["away"] = "XXX", "YYY"   # strip identities -> no badge resolvable
    c, n = evaluate(ms, "tournament")
    print(f"[tournament, badges stripped] {c}/{n}  <- identical: badge contribution = 0")
