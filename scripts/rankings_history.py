#!/usr/bin/env python3
"""Recover the world-ranking time series from this repository's own history.

The FIH table the pipeline fetches is a *live* one: every completed match
exchanges points between the two nations, so a team's points on Sunday are
not the points it carried on Wednesday. Two things need that distinction:

  * the non-knockout model, whose convergence feature asks how far two sides
    have moved toward each other *since the tournament began*; and
  * any honest replay of a finished match, which must use the points that
    stood before its push-back rather than the ones today's table shows —
    the latter already contains the result being predicted.

Nothing external is consulted. Every snapshot below was committed by the
pipeline at the time it fetched it, so the series is simply read back out of
git and written to public/data/rankings-history.json for the model and the
backtest to use without needing a git checkout at runtime.

The earliest snapshot the pipeline ever committed is the baseline ("frozen").
It is not literally the eve-of-tournament table — ranking fetching started
after the first matches had been played — so the file records what it is and
when it was taken, and consumers treat matches that predate it as having no
convergence signal rather than inventing one.

Usage:
    python3 scripts/rankings_history.py            # rewrite the history file
    python3 scripts/rankings_history.py --check    # report, change nothing
"""
import json
import os
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DATA = os.path.join(ROOT, 'public', 'data')
TEAMS_PATH = 'public/data/teams.json'
OUT = 'rankings-history.json'


def _git(*args):
    return subprocess.run(['git', '-C', ROOT, *args],
                          capture_output=True, text=True, check=True).stdout


def snapshots():
    """Every distinct ranking table this repository has ever committed."""
    log = _git('log', '--format=%H|%cI', '--reverse', '--', TEAMS_PATH)
    out = []
    for line in log.splitlines():
        if not line.strip():
            continue
        sha, committed = line.split('|', 1)
        try:
            doc = json.loads(_git('show', f'{sha}:{TEAMS_PATH}'))
        except (subprocess.CalledProcessError, ValueError):
            continue
        points = {t['code']: t['fih_points'] for t in doc.get('teams', [])
                  if t.get('fih_points') is not None}
        if not points:
            continue                      # table fetched later than this commit
        # The fetch timestamp is the truth about when the table was current;
        # the commit that carried it may be hours later.
        at = doc.get('rankings_updated_at') or committed
        if out and out[-1]['points'] == points:
            out[-1]['at'] = min(out[-1]['at'], at)
            continue                      # same table re-committed; keep the first sighting
        out.append({'at': at, 'points': points})
    out.sort(key=lambda s: s['at'])
    return out


def build():
    series = snapshots()
    if not series:
        raise SystemExit('No ranking snapshot found in history.')
    return {
        'source': 'this repository: every world-ranking table the data pipeline committed, read back out of git',
        'note': ('The FIH table is live — a match moves both nations\' points — so a finished match '
                 'must be replayed with the snapshot that stood before its push-back, not today\'s. '
                 'The first entry is the baseline the convergence feature measures from; matches played '
                 'before it carry no convergence signal.'),
        'frozen_at': series[0]['at'],
        'frozen': series[0]['points'],
        'snapshots': series,
    }


def main():
    doc = build()
    path = os.path.join(DATA, OUT)
    try:
        with open(path) as fh:
            current = json.load(fh)
    except (OSError, ValueError):
        current = None
    n = len(doc['snapshots'])
    if current == doc:
        print(f'rankings-history.json already current ({n} snapshots).')
        return 0
    if '--check' in sys.argv:
        print(f'rankings-history.json would change ({n} snapshots, '
              f"baseline {doc['frozen_at']}).")
        return 0
    with open(path, 'w') as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write('\n')
    print(f"rankings-history.json written: {n} snapshots, baseline {doc['frozen_at']}, "
          f"{len(doc['frozen'])} teams.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
