#!/usr/bin/env python3
"""As-of-then backtest of the match probability model.

Every completed match is re-scored using only the information available
before its push-back: FIH ranking points, tournament form computed from
the matches already played at that moment, and the pre-tournament
head-to-head record (current-tournament meetings excluded, exactly as
h2h_delta does). This is the harness the v3 calibration came from —
removing the v2 confidence temper (log-loss -8%) and narrowing the draw
window 700 -> 450 (Brier -5.5%), both monotone across their sweeps.

Not a CI gate: the numbers move with every completed match. Run it to
re-check calibration as the tournament grows:

    python3 scripts/backtest_model.py            # print only
    python3 scripts/backtest_model.py --publish  # also write
                                                 # public/data/model-calibration.json

--publish keeps the app's Trust page honest about the difference between
the PUBLISHED record (what the picks in the ledger actually scored — never
rewritten) and what the CURRENT model scores when replayed over the same
matches with as-of-then inputs. Two different numbers, both true, labelled.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_data import predict, form_delta, h2h_delta  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def main():
    fixtures = load('fixtures.json')['matches']
    teams = {t['code']: t for t in load('teams.json')['teams']}
    pairs = load('h2h.json')['pairs']

    done = sorted(
        [m for m in fixtures if m['status'] == 'completed' and m['score']['home'] is not None],
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

    brier = logloss = 0.0
    correct = 0
    for i, m in enumerate(done):
        pts = {}
        for code, opp in ((m['home'], m['away']), (m['away'], m['home'])):
            key = '-'.join(sorted((code, opp)))
            pts[code] = (teams[code]['fih_points']
                         + form_delta(form_before(code, i))
                         + h2h_delta(pairs.get(key), code, opp))
        ph, pd, pa = predict(pts[m['home']], pts[m['away']])
        h, a = m['score']['home'], m['score']['away']
        out = (1, 0, 0) if h > a else (0, 0, 1) if a > h else (0, 1, 0)
        probs = (ph, pd, pa)
        brier += sum((p - o) ** 2 for p, o in zip(probs, out))
        logloss -= math.log(max(1e-9, sum(p * o for p, o in zip(probs, out))))
        if max(range(3), key=lambda k: probs[k]) == out.index(1):
            correct += 1

    n = len(done)
    print(f'{n} completed matches, scored as-of-then:')
    print(f'  accuracy  {correct}/{n} = {correct / n:.0%}')
    print(f'  Brier     {brier / n:.4f}   (0.667 = uniform guessing)')
    print(f'  log-loss  {logloss / n:.4f}   (1.099 = uniform guessing)')

    if '--publish' in sys.argv and n:
        from datetime import datetime, timezone
        out_path = os.path.join(DATA, 'model-calibration.json')
        payload = {
            'matches': n,
            'correct': correct,
            'accuracy_pct': round(100 * correct / n),
            'brier': round(brier / n, 4),
            'log_loss': round(logloss / n, 4),
            'method': 'as-of-then replay: every completed match re-scored with only the form and rankings available before its own push-back',
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
