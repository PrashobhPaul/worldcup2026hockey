"""
Hockey.AI — find the backend the official app reads.

Established so far, from the runner:

  * /matches/{id}/lineups/{team} was never a route. All 88 "403"s were us
    asking for something that does not exist.
  * /matches/{id}/lineups is a route, and for match 22334 it answers 404. That
    match's own page payload says home_lineup:false, away_lineup:false, so TMS
    web has no sheet recorded for it.
  * The official app shows a full sheet for that same match — starting eleven,
    substitutes with the minute each came on, staff. Its goal minutes match our
    record to the second (floored), so it is the same fixture.

Therefore the app reads something other than the TMS website. The page points
at where: its assets come from hockey-cdn.altius.live and the footer credits
AltiusRT, so the competition runs on Altius and the app almost certainly talks
to an Altius service rather than to tms.fih.ch.

Two questions, answered separately so neither result is confused for the other:

1.  Does /matches/{id}/lineups work at all? A historic match linked from the
    head-to-head table carries a "Lineup" link, so if that answers 200 the
    route is sound and 22334 simply has no sheet on the website.

2.  Which host serves the app? Candidates are tried on their own; each prints
    its status so a 404 (wrong path, real host) is distinguishable from a DNS
    failure (wrong host entirely).
"""
import http.cookiejar
import json
import os
import sys
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')
TMS = 'https://tms.fih.ch'


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def get(op, url, label, headers=None):
    h = {'User-Agent': UA, 'Accept': '*/*', **(headers or {})}
    try:
        with op.open(urllib.request.Request(url, headers=h), timeout=25) as r:
            body = r.read()
            ct = r.headers.get('Content-Type', '?')
            print(f'  [{label}] {r.status} {len(body)}B {ct}')
            return body, ct
    except urllib.error.HTTPError as e:
        print(f'  [{label}] HTTP {e.code}')
    except Exception as e:
        print(f'  [{label}] {e.__class__.__name__}: {str(e)[:80]}')
    return None, None


def main():
    op = opener()
    print('== 1. Does the /lineups route work for a match that has one? ==')
    get(op, TMS + '/competitions/1866/matches', 'warm up')
    # Historic matches linked with "Lineup" from match 22334's head-to-head.
    for mid in ('17466', '16541', '10944', '6081'):
        body, ct = get(op, f'{TMS}/matches/{mid}/lineups', f'historic {mid}',
                       {'Referer': f'{TMS}/matches/{mid}'})
        if body and b'<' in body[:200]:
            import re
            txt = re.sub(r'<[^>]+>', '\n', body.decode('utf8', 'ignore'))
            lines = [l.strip() for l in txt.split('\n') if l.strip()][:40]
            print(f'      route works — first {len(lines)} lines:')
            for l in lines:
                print(f'      | {l[:100]}')
            break

    print('\n== 2. Which host serves the app? ==')
    comp, match = '1866', os.environ.get('PROBE_LINEUP_MATCH', '22334')
    candidates = [
        f'https://hockey-api.altius.live/api/matches/{match}',
        f'https://api.altius.live/hockey/matches/{match}',
        f'https://hockey.altius.live/api/matches/{match}',
        f'https://hockey-cdn.altius.live/fih/api/matches/{match}.json',
        f'https://altiusrt.com/api/matches/{match}',
        f'https://www.altiusrt.com/api/matches/{match}',
        f'https://api.fih.hockey/matches/{match}',
        f'https://www.fih.hockey/api/matches/{match}',
        f'{TMS}/api/matches/{match}',
        f'{TMS}/api/v1/matches/{match}',
        f'{TMS}/competitions/{comp}/matches.json',
    ]
    for url in candidates:
        body, ct = get(op, url, url.split('//')[1][:58], {'Accept': 'application/json'})
        if body and ct and 'json' in ct:
            try:
                doc = json.loads(body)
                print(f'      JSON keys: {sorted(doc)[:25] if isinstance(doc, dict) else type(doc).__name__}')
            except Exception:
                print(f'      not parseable JSON: {body[:160]!r}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
