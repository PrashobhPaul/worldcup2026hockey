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

--publish writes the validated mode and nothing else. The fitted "tournament"
mode scores better on matches it was fitted to and is printed by --compare for
comparison only; publishing it would be passing off hindsight as foresight.
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


def replay(mode):
    """Score every completed match. Returns (rows, stats)."""
    fixtures = load('fixtures.json')['matches']
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
            pick = 'HOME' if probs[0] >= probs[2] else 'AWAY'
            drivers = ['two-way knockout split']
        else:
            und = away if probs[0] >= probs[2] else home
            f = nkm.build_features(
                probs,
                live.get(home, eff[home]), live.get(away, eff[away]),
                ranks.baseline(home, when), ranks.baseline(away, when),
                und_gd=forms[und]['gf'] - forms[und]['ga'],
                h2h_margin=h2h_margin(pairs, home, away))
            out = nkm.predict(f, mode=mode)
            pick = out['prediction']
            probs = (out['probs']['HOME'], out['probs']['DRAW'], out['probs']['AWAY'])
            drivers = out['drivers']

        h, a = m['score']['home'], m['score']['away']
        actual = 'HOME' if h > a else 'AWAY' if a > h else 'DRAW'
        rows.append({'id': m['id'], 'knockout': knockout, 'pick': pick,
                     'actual': actual, 'probs': probs, 'drivers': drivers,
                     'hit': pick == actual})

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
        report(f'{other} (benchmark only)', alt)
        draws = [r for r in rows if r['actual'] == 'DRAW']
        called = [r for r in draws if r['pick'] == 'DRAW']
        print(f'  draws in the sample: {len(draws)}, called by the published mode: {len(called)}')
        fired = [r for r in rows if any('closed by' in d for d in r['drivers'])]
        print(f'  parity-convergence rule fired on {len(fired)} match(es): '
              f"{', '.join(r['id'] for r in fired) or 'none'}")

    if '--publish' in sys.argv and n:
        out_path = os.path.join(DATA, 'model-calibration.json')
        payload = {
            'matches': n,
            'correct': stats['correct'],
            'accuracy_pct': round(100 * stats['correct'] / n),
            'brier': round(stats['brier'], 4),
            'log_loss': round(stats['log_loss'], 4),
            'model': nkm.MODEL_VERSION,
            'mode': mode,
            'method': ('as-of-then replay: every completed match re-scored with only the form, '
                       'head-to-head and world-ranking table that existed before its own push-back'),
        }
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
