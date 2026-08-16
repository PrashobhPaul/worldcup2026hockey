#!/usr/bin/env python3
"""
Hockey.AI — FIH TMS Data Pipeline
Fetches pool standings PDF from FIH Tournament Management System.
Parses with pdfplumber and commits to data/standings.json.

Runs every 30 minutes via GitHub Actions.
"""

import json
import io
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

# ── Config ─────────────────────────────────────────
MEN_COMPETITION_ID = 1866
TMS_BASE = "https://tms.fih.ch/competitions"
DATA_DIR = "data"

TEAM_CODE_MAP = {
    # Pool A
    "Netherlands":      "NED",
    "Argentina":        "ARG",
    "New Zealand":      "NZL",
    "Japan":            "JPN",
    # Pool B
    "Belgium":          "BEL",
    "France":           "FRA",
    "Germany":          "GER",
    "Malaysia":         "MAS",
    # Pool C
    "Australia":        "AUS",
    "Spain":            "ESP",
    "Ireland":          "IRL",
    "South Africa":     "RSA",
    # Pool D
    "India":            "IND",
    "England":          "ENG",
    "Pakistan":         "PAK",
    "Wales":            "WAL",
}

POOL_TEAMS = {
    "A": ["NED", "ARG", "NZL", "JPN"],
    "B": ["BEL", "FRA", "GER", "MAS"],
    "C": ["AUS", "ESP", "IRL", "RSA"],
    "D": ["IND", "ENG", "PAK", "WAL"],
}


def fetch_pdf(url: str) -> bytes:
    """Download a URL as bytes with browser-like headers."""
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; HockeyAI/1.0)",
        "Accept": "application/pdf,*/*",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read()


def parse_standings_pdf(pdf_bytes: bytes) -> dict:
    """
    Parse FIH TMS pool standings PDF.
    Returns dict: { "A": [...], "B": [...], "C": [...], "D": [...] }
    Each entry: { team, played, won, drawn, lost, gf, ga, gd, points }
    """
    try:
        import pdfplumber
    except ImportError:
        print("ERROR: pdfplumber not installed. Run: pip install pdfplumber")
        return {}

    standings = {"A": [], "B": [], "C": [], "D": []}
    current_pool = None
    pool_pattern  = re.compile(r"^Pool\s+([A-D])\s*$", re.IGNORECASE)

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines = text.split("\n")

            for line in lines:
                stripped = line.strip()
                if not stripped:
                    continue

                # Detect "Pool A" / "Pool B" etc.
                m = pool_pattern.match(stripped)
                if m:
                    current_pool = m.group(1).upper()
                    continue

                if not current_pool:
                    continue

                # Try to parse a standings row
                # Expected format: Rank Team P W D L GF GA GD Pts
                # Some PDFs include rank number; some skip it
                parts = stripped.split()
                if len(parts) < 9:
                    continue

                # Determine if first token is a rank number
                start = 0
                try:
                    int(parts[0])
                    start = 1
                except ValueError:
                    pass

                # Team name: consecutive non-numeric tokens
                name_parts = []
                idx = start
                while idx < len(parts) and not parts[idx].lstrip("-").lstrip("+").isdigit():
                    name_parts.append(parts[idx])
                    idx += 1

                if not name_parts:
                    continue

                team_name = " ".join(name_parts)
                team_code = TEAM_CODE_MAP.get(team_name)
                if not team_code:
                    # Try partial match
                    for full, code in TEAM_CODE_MAP.items():
                        if team_name.lower() in full.lower() or full.lower() in team_name.lower():
                            team_code = code
                            break
                if not team_code:
                    continue

                # Remaining must be at least 8 numbers
                nums_str = parts[idx:]
                if len(nums_str) < 8:
                    continue

                try:
                    nums = [int(x.lstrip("+")) for x in nums_str[:8]]
                except ValueError:
                    continue

                played, won, drawn, lost, gf, ga, gd, points = nums

                entry = {
                    "team":   team_code,
                    "played": played,
                    "won":    won,
                    "drawn":  drawn,
                    "lost":   lost,
                    "gf":     gf,
                    "ga":     ga,
                    "gd":     gd,
                    "points": points,
                }

                # Prevent duplicates
                if not any(e["team"] == team_code for e in standings[current_pool]):
                    standings[current_pool].append(entry)

    return standings


def ensure_all_teams(standings: dict) -> dict:
    """Fill in any missing teams with zeroed stats."""
    for pool, team_codes in POOL_TEAMS.items():
        existing = {e["team"] for e in standings.get(pool, [])}
        for code in team_codes:
            if code not in existing:
                standings.setdefault(pool, []).append({
                    "team": code, "played": 0, "won": 0, "drawn": 0,
                    "lost": 0, "gf": 0, "ga": 0, "gd": 0, "points": 0,
                })
    return standings


def sort_standings(standings: dict) -> dict:
    """Sort each pool by Pts → GD → GF."""
    for pool in standings:
        standings[pool].sort(
            key=lambda x: (x["points"], x["gd"], x["gf"]),
            reverse=True,
        )
    return standings


def update_standings() -> bool:
    url = f"{TMS_BASE}/{MEN_COMPETITION_ID}/reports/poolstandings"
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')} UTC] Fetching standings from FIH TMS…")
    print(f"  URL: {url}")

    try:
        pdf_bytes = fetch_pdf(url)
        print(f"  Downloaded {len(pdf_bytes):,} bytes")
    except Exception as e:
        print(f"  ERROR fetching PDF: {e}")
        return False

    standings = parse_standings_pdf(pdf_bytes)
    standings = ensure_all_teams(standings)
    standings = sort_standings(standings)

    total_parsed = sum(len(v) for v in standings.values())
    print(f"  Parsed {total_parsed} team entries across {len(standings)} pools")

    if total_parsed == 0:
        print("  WARNING: No data parsed. PDF format may have changed.")
        return False

    payload = {
        "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source":       "FIH TMS",
        "tournament":   "FIH Hockey World Cup 2026 (Men's)",
        "pools":        standings,
    }

    os.makedirs(DATA_DIR, exist_ok=True)
    out_path = os.path.join(DATA_DIR, "standings.json")
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)

    print(f"  ✓ Written to {out_path}")
    return True


def update_fixtures_status() -> bool:
    """
    Best-effort: attempt to infer match status from standings changes.
    For a full implementation, scrape FIH schedule page or Hockey Scores Live.
    """
    # Placeholder — extend when you find a reliable live score source
    print("  [fixtures] Skipping live score scrape (add scraper here if needed)")
    return True


if __name__ == "__main__":
    print("Hockey.AI Data Pipeline — FIH Hockey World Cup 2026 (Men's)")
    print("=" * 60)

    ok = update_standings()
    update_fixtures_status()

    print("=" * 60)
    if ok:
        print("Done.")
    else:
        print("Completed with warnings. Check PDF format if standings are empty.")
        sys.exit(1)
