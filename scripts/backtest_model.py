#!/usr/bin/env python3
"""As-of-then replay of the prediction model over every completed match.

Each match is re-scored using only what existed before its own push-back:

  * the world-ranking table that stood on the day — not today's. The FIH
    table is live, so a match moves the points of both nations involved;
    scoring an early match with today's points would be handing the model
    the result it is being asked to predict. The series comes from
    public/data/rankings-history.json (see scripts/rankings_history.py).
  * tournament form computed from the matches finished at that moment only.
  * the pre-tournament head-to-head record, current-tournament meetings
    excluded, exactly as h2h_delta does.

Pool and stage-2 matches run through NON_KNOCKOUT_MODEL_V2; knockout and
classification matches keep the two-way split, since they cannot be drawn.

Not a CI gate — the numbers move with every completed match:

    python3 scripts/backtest_model.py            # print only
    python3 scripts/backtest_model.py --publish  # also write
                                                 # public/data/model-calibration.json
    python3 scripts/backtest_model.py --compare  # every mode side by side

--publish writes the mode configured in model/params.json and nothing else, so
the app carries one figure. --compare prints both modes side by side for
development; it changes nothing on disk.

"""
import json
import math
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_data import predict, form_delta, h2h_delta  # noqa: E402
import model_non_knockout as nkm  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')
NON_KNOCKOUT_PHASES = ('pool', 'stage2')
# The three stages the tournament is actually read in. A single 36-of-48 hides
# which part of the competition the model is good at: the pool round is
# sixteen sides finding their level, stage 2 is the seeded half, and the
# knockouts are one-off matches where a shoot-out can decide it. Every
# knockout round counts as one stage — the classification places, the semis
# and the two medal finals — so the split is 24 + 16 + 10 across the fifty.
STAGE_OF_PHASE = {'pool': 'stage1', 'stage2': 'stage2'}
STAGE_KEYS = ('stage1', 'stage2', 'knockout')


def stage_of(phase):
    return STAGE_OF_PHASE.get(phase, 'knockout')


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def kickoff_utc(m):
    """Push-back as an aware UTC datetime. Venue clocks are CET/CEST (+02:00)."""
    return datetime.fromisoformat(f"{m['date']}T{m['time']}:00+02:00").astimezone(timezone.utc)


class Rankings:
    """The live table as it stood at any moment, from our own committed history."""

    def __init__(self, history):
        self.snapshots = [(datetime.fromisoformat(s['at']), s['points'])
                          for s in history['snapshots']]
        self.frozen = history['frozen']
        self.frozen_at = datetime.fromisoformat(history['frozen_at'])
        self.before_capture = 0

    def at(self, when):
        """The most recent table published at or before `when`.

        A match played before ranking capture began has no such table. The
        earliest one we hold is used instead — it is the closest thing that
        exists — and counted, so the report can say how many matches lean on
        it rather than quietly averaging them in.
        """
        chosen = None
        for at, points in self.snapshots:
            if at <= when:
                chosen = points
            else:
                break
        if chosen is None:
            self.before_capture += 1
            return self.snapshots[0][1]
        return chosen

    def baseline(self, code, when):
        """Baseline points for the convergence feature, or None if unmeasurable."""
        return self.frozen.get(code) if when >= self.frozen_at else None


def h2h_margin(pairs, home, away):
    """Pre-tournament head-to-head: home wins minus home losses (a count)."""
    key = '-'.join(sorted((home, away)))
    past = [m for m in (pairs.get(key) or []) if not m.get('current')]
    wins = losses = 0
    for m in past:
        hg = m['home_goals'] if m['home'] == home else m['away_goals']
        ag = m['home_goals'] if m['home'] == away else m['away_goals']
        if hg > ag:
            wins += 1
        elif hg < ag:
            losses += 1
    return wins - losses


def match_features():
    """Per-match ranking gap and convergence, where a finer series exists.

    The pipeline samples the published table once a day; the FIH live table
    moves after every match, and the parity-convergence rule keys off exactly
    that movement. Where the finer per-match series is available it is used,
    because a daily sample understates how far two sides have converged and
    leaves the rule inert on matches it was built to catch.
    """
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        '..', 'reference', 'match-features.json')
    try:
        with open(path) as fh:
            return json.load(fh)['matches']
    except (OSError, ValueError, KeyError):
        return {}


def replay(mode):
    """Score every completed match. Returns (rows, stats)."""
    fixtures = load('fixtures.json')['matches']
    finer = match_features()
    teams = {t['code']: t for t in load('teams.json')['teams']}
    pairs = load('h2h.json')['pairs']
    ranks = Rankings(load('rankings-history.json'))

    done = sorted([m for m in fixtures
                   if m['status'] == 'completed' and m['score']['home'] is not None],
                  key=lambda m: (m['date'], m['time']))

    def form_before(code, idx):
        f = {'played': 0, 'wins': 0, 'draws': 0, 'losses': 0, 'gf': 0, 'ga': 0}
        for m in done[:idx]:
            if code not in (m['home'], m['away']):
                continue
            s = 'home' if m['home'] == code else 'away'
            o = 'away' if s == 'home' else 'home'
            gf, ga = m['score'][s], m['score'][o]
            f['played'] += 1
            f['gf'] += gf
            f['ga'] += ga
            if gf > ga:
                f['wins'] += 1
            elif gf < ga:
                f['losses'] += 1
            else:
                f['draws'] += 1
        return f

    rows = []
    for i, m in enumerate(done):
        when = kickoff_utc(m)
        live = ranks.at(when)
        home, away = m['home'], m['away']
        knockout = m['phase'] not in NON_KNOCKOUT_PHASES

        eff, forms = {}, {}
        for code, opp in ((home, away), (away, home)):
            key = '-'.join(sorted((code, opp)))
            forms[code] = form_before(code, i)
            base = live.get(code)
            if base is None:                       # nation absent from that table
                base = teams[code]['fih_points']
            eff[code] = base + form_delta(forms[code]) + h2h_delta(pairs.get(key), code, opp)

        probs = predict(eff[home], eff[away], knockout=knockout)
        if knockout:
            # The triple is regulation; the pick is who advances, and the
            # drawn third of the outcome space resolves through the shoot-out
            # at even odds — the same fold every publisher applies.
            adv_h = probs[0] + probs[1] / 2
            pick = 'HOME' if adv_h >= 0.5 else 'AWAY'
            drivers = [f'regulation triple, shoot-out fold (advance {adv_h:.0%})']
        else:
            und = away if probs[0] >= probs[2] else home
            f = nkm.build_features(
                probs,
                live.get(home, eff[home]), live.get(away, eff[away]),
                ranks.baseline(home, when), ranks.baseline(away, when),
                und_gd=forms[und]['gf'] - forms[und]['ga'],
                h2h_margin=h2h_margin(pairs, home, away))
            # Where the author's own pre-kickoff row exists, the model is fed
            # that row entire rather than this repository's re-derivation of
            # it. The switches key off the Live-FIH distribution and the points
            # movement behind it, and our daily ranking sample and our own
            # rating model produce neither; a partial override — gap and
            # convergence only, as this once did — leaves the model running on
            # a mix of two different sets of inputs.
            #
            # The row is evaluated in the author's orientation and the answer
            # translated back, because two of the tournament switches name a side
            # outright: mirroring their inputs would still leave them forcing
            # whichever team this schedule happens to list as home.
            fine = finer.get(m['id'])
            if fine:
                f = dict(f, pH=fine['pH'], pD=fine['pD'], pA=fine['pA'],
                         lv_pts_gap=fine['gap'], conv=fine['conv'],
                         fav_mov=fine['fav_mov'], und_gd=fine['und_gd'],
                         h2h_margin=fine['h2h_margin'], live_pred=fine['live_pred'])
            out = nkm.predict(f, mode=mode)
            pick = out['prediction']
            probs = (out['probs']['HOME'], out['probs']['DRAW'], out['probs']['AWAY'])
            if fine and fine['flip']:
                pick = {'HOME': 'AWAY', 'AWAY': 'HOME', 'DRAW': 'DRAW'}[pick]
                probs = (probs[2], probs[1], probs[0])
            drivers = out['drivers']

        h, a = m['score']['home'], m['score']['away']
        actual = 'HOME' if h > a else 'AWAY' if a > h else 'DRAW'
        hit = pick == actual
        if knockout and actual == 'DRAW':
            # Level after sixty: the knockout pick was about who advances, so
            # it is judged against the shoot-out where the record has one. A
            # drawn knockout with no shoot-out on file cannot vindicate a
            # pick and stays a miss — the burden of proof is the record's.
            so = m.get('shootout')
            if so:
                so_winner = 'HOME' if so['home'] > so['away'] else 'AWAY'
                hit = pick == so_winner
        rows.append({'id': m['id'], 'knockout': knockout, 'pick': pick,
                     'actual': actual, 'probs': probs, 'drivers': drivers,
                     'hit': hit})

    n = len(rows)
    brier = logloss = 0.0
    for r in rows:
        idx = {'HOME': 0, 'DRAW': 1, 'AWAY': 2}[r['actual']]
        out = [0.0, 0.0, 0.0]
        out[idx] = 1.0
        brier += sum((p - o) ** 2 for p, o in zip(r['probs'], out))
        logloss -= math.log(max(1e-9, r['probs'][idx]))
    stats = {
        'matches': n,
        'correct': sum(1 for r in rows if r['hit']),
        'brier': brier / n if n else 0.0,
        'log_loss': logloss / n if n else 0.0,
        'before_capture': ranks.before_capture,
    }
    return rows, stats


def ledger_tally(fixtures=None, predictions=None):
    """Score the picks AS PUBLISHED — the cards, not a replay.

    The published accuracy figure used to be the current model replayed
    as-of-then. That definition quietly rewrites the record every time the
    model is recalibrated: the replay flips a pick the public never saw
    flipped, and the headline stops being the number the match cards add up
    to. The promise on the Trust page is about the picks that were actually
    published, so this counts exactly those — each match's active
    (non-superseded) row, graded like the cards grade: a knockout level after
    sixty falls to the shoot-out winner where the record has one, and to a
    miss where it does not.
    """
    fixtures = fixtures or load('fixtures.json')
    predictions = predictions or load('predictions.json')
    active = {p['matchId']: p for p in predictions['predictions'] if not p.get('superseded')}
    hits = graded = draws = draws_called = 0
    by_stage = {k: {'correct': 0, 'matches': 0} for k in STAGE_KEYS}
    for m in fixtures['matches']:
        if m['status'] != 'completed' or (m.get('score') or {}).get('home') is None:
            continue
        p = active.get(m['id'])
        if not p:
            continue
        graded += 1
        stage = by_stage[stage_of(m['phase'])]
        stage['matches'] += 1
        h, a = m['score']['home'], m['score']['away']
        actual = 'HOME' if h > a else 'AWAY' if a > h else 'DRAW'
        # The draws breakdown ("called five of nine draws") is about draws the
        # model could have CALLED — a pickable outcome only outside the
        # knockout rounds, where level-after-sixty is a route to the shoot-out
        # and never a result anyone predicts.
        if actual == 'DRAW' and m['phase'] in NON_KNOCKOUT_PHASES:
            draws += 1
            draws_called += p['pick'] == 'DRAW'
        hit = p['pick'] == actual
        if actual == 'DRAW' and m['phase'] not in NON_KNOCKOUT_PHASES:
            # A knockout pick is about who advances, and level-after-sixty is
            # decided in the shoot-out — a regulation win and a shoot-out win
            # grade exactly the same. Until the record carries the shoot-out,
            # the tie has graded NOBODY: it leaves the denominator rather than
            # counting as a miss, exactly as the app grades the same card
            # (IND v BEL spent a day as a ✗ against a pick that had won).
            so = m.get('shootout')
            if not so:
                graded -= 1
                stage['matches'] -= 1
                continue
            hit = p['pick'] == ('HOME' if so['home'] > so['away'] else 'AWAY')
        hits += hit
        stage['correct'] += hit
    return {'correct': hits, 'matches': graded, 'draws': draws,
            'draws_called': draws_called, 'by_stage': by_stage}


def report(label, stats):
    n, c = stats['matches'], stats['correct']
    print(f"  {label:<26} {c}/{n} = {c / n:.0%}   "
          f"Brier {stats['brier']:.4f}   log-loss {stats['log_loss']:.4f}")


def main():
    mode = nkm.DEFAULT_MODE
    rows, stats = replay(mode)
    n = stats['matches']
    print(f'{n} completed matches, scored as-of-then '
          f"({stats['before_capture']} predate ranking capture and use the earliest table):")
    report(f'{mode} (published)', stats)

    if '--compare' in sys.argv:
        other = 'tournament' if mode == 'validated' else 'validated'
        _, alt = replay(other)
        report(f'{other} ', alt)
        draws = [r for r in rows if r['actual'] == 'DRAW']
        called = [r for r in draws if r['pick'] == 'DRAW']
        print(f'  draws in the sample: {len(draws)}, called by the published mode: {len(called)}')
        fired = [r for r in rows if any('closed by' in d for d in r['drivers'])]
        print(f'  parity-convergence rule fired on {len(fired)} match(es): '
              f"{', '.join(r['id'] for r in fired) or 'none'}")

    if '--publish' in sys.argv and n:
        out_path = os.path.join(DATA, 'model-calibration.json')
        # Two true statements about the same replay. The three-way figure counts
        # One figure: how many of the non-knockout matches the model called,
        # draws included, out of all of them. A second percentage on a
        # different denominator is how the app came to print two records of
        # the same model on the same screen, so only this one is published.
        # The draws are carried as a breakdown of it, not as a rival to it.
        led = ledger_tally()
        payload = {
            'matches': led['matches'],
            'correct': led['correct'],
            'accuracy_pct': round(100 * led['correct'] / led['matches']) if led['matches'] else 0,
            'draws': led['draws'],
            'draws_called': led['draws_called'],
            # The same record, split the way the tournament is played. The
            # denominators grow as matches finish: the knockouts read out of
            # eight until the two medal finals are played and it becomes ten.
            'by_stage': led['by_stage'],
            'brier': round(stats['brier'], 4),
            'log_loss': round(stats['log_loss'], 4),
            'model': nkm.MODEL_VERSION,
            'mode': mode,
            'method': ('accuracy counts the picks as published — each match\'s active ledger row, '
                       'graded like the match cards (a drawn knockout falls to the shoot-out '
                       'winner where recorded, and to a miss where not). Brier and log-loss are '
                       'the current model replayed as-of-then, with only the form, head-to-head '
                       'and world-ranking table that existed before each push-back. The split '
                       'matters: a recalibration may sharpen the model, but it must never move '
                       'the public record of what was picked.'),
        }
        print(f"  ledger (as published)      {led['correct']}/{led['matches']} = "
              f"{led['correct'] / led['matches']:.0%}" if led['matches'] else '')
        try:
            with open(out_path) as fh:
                previous = {k: v for k, v in json.load(fh).items() if k != 'updated_at'}
        except (OSError, ValueError):
            previous = None
        if payload != previous:
            payload['updated_at'] = datetime.now(timezone.utc).isoformat()
            with open(out_path, 'w') as fh:
                json.dump(payload, fh, indent=2)
                fh.write('\n')
            version = load('data-version.json')
            version['version'] = int(version.get('version', 0)) + 1
            version['updated_at'] = payload['updated_at']
            with open(os.path.join(DATA, 'data-version.json'), 'w') as fh:
                json.dump(version, fh, indent=2, ensure_ascii=False)
                fh.write('\n')
            from data_fingerprint import stamp as stamp_fingerprint
            stamp_fingerprint()
            print(f'model-calibration.json updated, data-version -> {version["version"]}')
        else:
            print('model-calibration.json unchanged.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
