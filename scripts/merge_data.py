#!/usr/bin/env python3
"""
Resolve conflicts in public/data/*.json between a feature branch and the
pipeline's commits on main.

The data files are generated artifacts that both sides legitimately rewrite: the
30-minute pipeline updates them on main, while a branch that changes the schema,
the schedule or the model rewrites them too. Git sees whole-file rewrites and
gives up. Every such conflict has the same correct answer, so it is written down
here once instead of being re-derived by hand each time:

  fixtures.json     pool matches from the pipeline (scores, events, statuses are
                    its job); every other fixture from the branch, which owns the
                    schedule and the ids. Tournament metadata from the pipeline.
  teams.json        the pipeline's ranks, points and stats; the branch's
                    editorial fields (seeding tier, intro) laid back on top.
  players.json      the pipeline's recomputed stats, then exactly one captain per
                    team re-derived (see normalize_captaincy in update_data.py).
  predictions.json  the branch's picks — an append-only ledger, so any row only
                    the pipeline has is kept rather than dropped.
  h2h.json          the union: each side may have harvested pairs the other has
                    not seen.
  ai-stories.json   one brief per match; the branch's wording wins, except where
                    the pipeline has upgraded an engine brief to a written story.
  data-version.json one past the higher of the two, so every client resyncs.

Team form is recomputed from the merged fixtures at the end, so the model can
never be reading a different tournament from the one the app displays.

Usage:
    python3 scripts/merge_data.py            # resolve the current conflicts
    python3 scripts/merge_data.py --check    # report, change nothing
"""
import json
import os
import subprocess
import sys

DATA = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
sys.path.insert(0, os.path.dirname(__file__))


def _stage(n, path):
    """One side of a conflict: 1=base, 2=ours (branch), 3=theirs (main)."""
    r = subprocess.run(['git', 'show', f':{n}:{path}'], capture_output=True, text=True)
    if r.returncode != 0 or not r.stdout.strip():
        return None
    return json.loads(r.stdout)


def _write(name, obj, indent=2):
    p = os.path.join(DATA, name)
    with open(p, 'w') as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def conflicted():
    r = subprocess.run(['git', 'diff', '--name-only', '--diff-filter=U'],
                       capture_output=True, text=True)
    return [p for p in r.stdout.split() if p.startswith('public/data/')]


def merge_fixtures(ours, theirs):
    """Pipeline owns played matches; the branch owns the schedule.

    Ownership follows match state, not phase: the pipeline's row wins for any
    match it has moved further along (completed beats in-play beats
    scheduled), because a result must never be un-happened by a merge. When
    both sides agree on the state, played matches stay with the pipeline and
    unplayed ones with the branch, which owns the schedule and the ids.

    One refinement: an official timeline outranks an estimated one whichever
    side carries it. A branch whose CI ran a fixed report parser can hold the
    official record for a match main's pipeline still has as estimated (D5
    after the two-column fix) — taking the pipeline row wholesale would throw
    the real scorers away.
    """
    def rank(m):
        if m.get('status') == 'completed':
            return 2
        return 1 if m.get('live_score') or m.get('status') not in (None, 'scheduled') else 0

    theirs_by = {m['id']: m for m in theirs['matches']}
    out, taken = [], 0
    for m in ours['matches']:
        t = theirs_by.get(m['id'])
        if t is None:
            out.append(m)
            continue
        ours_wins = (rank(m) > rank(t)
                     or (rank(m) == rank(t) and m.get('phase') != 'pool'))
        # Official enrichment overrides the state rule when the score agrees.
        if (t.get('enrichment') == 'official' and m.get('enrichment') != 'official'
                and m.get('score') == t.get('score') and rank(t) >= rank(m)):
            ours_wins = False
        elif (m.get('enrichment') == 'official' and t.get('enrichment') != 'official'
                and m.get('score') == t.get('score')):
            ours_wins = True
        if ours_wins:
            out.append(m)
        else:
            out.append(t); taken += 1
    # A match the branch does not carry at all is still a real fixture.
    known = {m['id'] for m in out}
    for mid, t in theirs_by.items():
        if mid not in known:
            out.append(t); taken += 1
    ours['matches'] = out
    for k in ('last_updated', 'source'):
        if k in theirs:
            ours[k] = theirs[k]
    return ours, f'{len(out)} fixtures, {taken} rows from the pipeline'


# Fields the branch owns because they are editorial, not derived. Everything
# else on a team is the pipeline's to compute.
TEAM_EDITORIAL = ('contender_tier', 'intro', 'nickname', 'color', 'flag')


def merge_teams(ours, theirs):
    mine = {t['code']: t for t in ours['teams']}
    kept = 0
    for t in theirs['teams']:
        src = mine.get(t['code'])
        if not src:
            continue
        for f in TEAM_EDITORIAL:
            if f in src and src[f] != t.get(f):
                t[f] = src[f]; kept += 1
    return theirs, f'pipeline data + {kept} editorial fields kept'


def merge_players(ours, theirs):
    """Pipeline stats, then the invariants that hold whatever either side says.

    This function returns the pipeline's file, so anything broken upstream
    arrives intact. Two things have now come back through it more than once,
    which is what makes them the driver's business rather than the producer's:

      * Assists. The FIH publishes none for this competition and no event in
        the feed carries one, so a non-zero assist is always wrong, whichever
        side it arrived on. It has been cleared three times.

      * Player ids. The client store is keyed on id, so two players sharing one
        does not read as a wrong number — it reads as a player who is not in
        the app at all. Thirteen were lost that way.

    Neither depends on which side is newer, so neither is a merge decision.
    They are simply enforced.
    """
    # The pipeline on the default branch runs whatever code the default branch
    # has, so its players.json knows only the fields that code computes. A
    # branch that adds fields — a derived position and its source, a rating
    # broken into components, starts and appearances read from the official
    # team sheets — loses every one of them the moment main's file arrives,
    # because this function returns the pipeline's file whole.
    #
    # That is not a merge decision either: a field only one side knows about
    # has no competing value to choose between. The pipeline's figures win
    # where both sides have one; a field only the branch carries is kept.
    mine = {(p.get('team'), p.get('name')): p for p in (ours or {}).get('players', [])}
    kept = 0
    for p in theirs['players']:
        was = mine.get((p.get('team'), p.get('name')))
        if not was:
            continue
        for field, value in was.items():
            if value is None or field in p and p[field] is not None:
                continue
            p[field] = value
            kept += 1

    assists = 0
    for p in theirs['players']:
        if p.get('assists'):
            p['assists'] = 0
            assists += 1

    seen, ids = set(), 0
    for p in theirs['players']:
        if p['id'] not in seen:
            seen.add(p['id'])
            continue
        seq = 1
        while f"{p['team']}_{seq:02d}" in seen:
            seq += 1
        p['id'] = f"{p['team']}_{seq:02d}"
        seen.add(p['id'])
        ids += 1

    by = {}
    for p in theirs['players']:
        by.setdefault(p['team'], []).append(p)
    fixed = 0
    for squad in by.values():
        caps = [p for p in squad if p.get('is_captain')]
        official = [p for p in caps if p.get('source') == 'fih-team-list']
        has_list = any(p.get('on_team_list') for p in squad)
        if official:
            keep = official[0]
        else:
            # The list marks nobody: the captain we carry keeps the armband,
            # provided he is actually in the official squad.
            eligible = [p for p in caps if not has_list or p.get('on_team_list')]
            keep = eligible[0] if eligible else None
        for p in squad:
            want = p is keep
            if bool(p.get('is_captain')) != want:
                p['is_captain'] = want; fixed += 1
    # Same argument one level up: a document-level key only the branch writes
    # — the reconciliation against the FIH's own statistics tables — has no
    # competing value either, so it is carried across rather than dropped.
    for key in ('official_figures_check',):
        if key in (ours or {}) and key not in theirs:
            theirs[key] = ours[key]

    notes = [f'{fixed} captain flags corrected']
    if kept:
        notes.append(f'{kept} branch-only field(s) preserved')
    if assists:
        notes.append(f'{assists} phantom assist(s) cleared')
    if ids:
        notes.append(f'{ids} duplicate id(s) resolved')
    return theirs, 'pipeline stats, ' + ', '.join(notes)


def merge_predictions(ours, theirs):
    """Append-only ledger: the branch's picks win, but nothing is dropped —
    and the bookkeeping is one-way. When the pipeline publishes a revision it
    marks the prior row superseded; a whole-file branch version of that prior
    row must not resurrect it, or the ledger ends up with two active picks
    for one match (exactly what happened to ten Stage 2 fixtures). So:
    superseded on either side sticks, and if two active rows for one match
    survive anyway, the newest published row keeps the ledger."""
    theirs_by_id = {r['id']: r for r in theirs.get('predictions', []) if r.get('id')}
    seen = set()
    for r in ours['predictions']:
        rid = r.get('id')
        if not rid:
            continue
        seen.add(rid)
        t = theirs_by_id.get(rid)
        if t and t.get('superseded') and not r.get('superseded'):
            r['superseded'] = True
            r['superseded_at'] = t.get('superseded_at')
            r['superseded_reason'] = t.get('superseded_reason')
    added = 0
    for rid, r in theirs_by_id.items():
        if rid not in seen:
            ours['predictions'].append(r); added += 1
    by_match = {}
    for r in ours['predictions']:
        if not r.get('superseded'):
            by_match.setdefault(r['matchId'], []).append(r)
    closed = 0
    for rows in by_match.values():
        if len(rows) < 2:
            continue
        rows.sort(key=lambda r: r.get('publishedAt') or '')
        for r in rows[:-1]:
            r['superseded'] = True
            r['superseded_at'] = rows[-1].get('publishedAt')
            r['superseded_reason'] = ('Ledger repair: a later revision was already published; '
                                      'this row should have been closed when it was.')
            closed += 1
    note = f'{len(ours["predictions"])} rows ({added} kept from the pipeline'
    if closed:
        note += f', {closed} stale active row(s) closed'
    return ours, note + ')'


def merge_h2h(ours, theirs):
    pairs = dict(theirs.get('pairs') or {})
    pairs.update(ours.get('pairs') or {})
    ours['pairs'] = pairs
    return ours, f'{len(pairs)} pairs (union)'


def merge_stories(ours, theirs):
    """
    One brief per match, keyed by matchId. The branch's copy wins on a clash —
    it is the side that changes how a brief reads — except where the pipeline
    has upgraded an engine brief into a written AI story, which is strictly
    more than we have. Briefs the other side alone has are kept.
    """
    ours_by = {s['matchId']: s for s in ours.get('stories') or []}
    merged = {s['matchId']: s for s in theirs.get('stories') or []}
    for mid, row in ours_by.items():
        theirs_row = merged.get(mid)
        upgraded = (theirs_row or {}).get('source') == 'ai' and row.get('source') == 'engine'
        if not upgraded:
            merged[mid] = row
    ours['stories'] = [merged[k] for k in sorted(merged)]
    return ours, f'{len(merged)} briefs'


def merge_calibration(ours, theirs):
    """Derived from the merged ledger and fixtures, so no side is authoritative:
    take the replay covering more matches (newer tournament state), then let
    the post-merge backtest republish if the merged data says otherwise."""
    pick = theirs if (theirs.get('matches', 0), theirs.get('updated_at', '')) >= \
                     (ours.get('matches', 0), ours.get('updated_at', '')) else ours
    return pick, f"{pick.get('correct')}/{pick.get('matches')} kept (recomputed post-merge)"


def merge_rankings_history(ours, theirs):
    """Union of snapshots, earliest baseline. Losing one loses a match's inputs."""
    by_at = {s['at']: s for s in (theirs.get('snapshots') or [])}
    by_at.update({s['at']: s for s in (ours.get('snapshots') or [])})
    series = [by_at[k] for k in sorted(by_at)]
    base = ours if ours.get('frozen_at', '9') <= theirs.get('frozen_at', '9') else theirs
    out = dict(base)
    out['snapshots'] = series
    return out, f'{len(series)} snapshots (union), baseline {out.get("frozen_at")}'


def merge_version(ours, theirs):
    # The fingerprint is NOT set here: it describes the whole published set,
    # and this handler sees only data-version.json. On the after-the-fact path
    # main() restamps once every file is written. On the driver path nothing
    # can — git hands each handler temporary files and updates the working
    # tree only after the last driver returns — so whoever ran `git merge`
    # restamps afterwards. The pipeline does it in update-data.yml; a local
    # merge is caught by `data_fingerprint.py --check`, which says what to run.
    v = max((ours or {}).get('version', 0), (theirs or {}).get('version', 0)) + 1
    base = theirs or ours or {}
    base['version'] = v
    return base, f'version -> {v}'


HANDLERS = {
    'fixtures.json': merge_fixtures,
    'teams.json': merge_teams,
    'players.json': merge_players,
    'predictions.json': merge_predictions,
    'h2h.json': merge_h2h,
    'ai-stories.json': merge_stories,
    'rankings-history.json': merge_rankings_history,
    'data-version.json': merge_version,
    'model-calibration.json': merge_calibration,
}
INDENT = {'fixtures.json': 1}


def driver(base_p, ours_p, theirs_p, path):
    """git merge-driver entry point: %O %A %B %P. Result must land in ours_p."""
    name = os.path.basename(path)
    fn = HANDLERS.get(name)
    if not fn:
        return 1                       # unknown file: let git conflict normally
    try:
        ours = json.load(open(ours_p))
        theirs = json.load(open(theirs_p))
    except (OSError, json.JSONDecodeError):
        return 1
    merged, note = fn(ours, theirs)
    with open(ours_p, 'w') as f:
        json.dump(merged, f, ensure_ascii=False, indent=INDENT.get(name, 2))
        f.write('\n')
    print(f'merge_data: {name}: {note}')
    return 0


def main():
    if '--driver' in sys.argv:
        a = sys.argv[sys.argv.index('--driver') + 1:]
        return driver(*a[:4]) if len(a) >= 4 else 1
    check = '--check' in sys.argv
    files = conflicted()
    if not files:
        print('No conflicted data files.')
        return 0
    print(f'Resolving {len(files)} data file(s):')
    unhandled = []
    for path in files:
        name = os.path.basename(path)
        fn = HANDLERS.get(name)
        if not fn:
            unhandled.append(path)
            print(f'  !! {name}: no rule — resolve by hand')
            continue
        ours, theirs = _stage(2, path), _stage(3, path)
        if ours is None or theirs is None:
            unhandled.append(path)
            print(f'  !! {name}: a side is missing — resolve by hand')
            continue
        merged, note = fn(ours, theirs)
        print(f'  ok {name}: {note}')
        if not check:
            _write(name, merged, INDENT.get(name, 2))
    if check or unhandled:
        return 1 if unhandled else 0

    # The model must read the same tournament the app shows.
    import update_data as ud
    fixtures = json.load(open(os.path.join(DATA, 'fixtures.json')))
    teams = json.load(open(os.path.join(DATA, 'teams.json')))
    changed = 0
    for t in teams['teams']:
        f = ud.team_form(t['code'], fixtures)
        if t.get('form') != f:
            t['form'] = f; changed += 1
    _write('teams.json', teams)
    print(f'  ok team form recomputed ({changed} changed)')

    for name in HANDLERS:
        p = os.path.join(DATA, name)
        if os.path.exists(p):
            json.load(open(p))          # refuse to stage anything unparseable

    # A merge produces content neither side published on its own, so the stamp
    # has to describe the result — otherwise a client holding the surviving
    # version number never learns the content moved underneath it.
    from data_fingerprint import stamp as stamp_fingerprint
    print(f'  ok fingerprint restamped ({stamp_fingerprint()})')
    version_path = os.path.join(DATA, 'data-version.json')
    if version_path not in files and os.path.exists(version_path):
        files = files + [version_path]

    subprocess.run(['git', 'add'] + files, check=True)
    print('Staged. Review, then commit the merge.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
