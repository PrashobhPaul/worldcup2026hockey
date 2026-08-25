"""
Hockey.AI — find out how the official line-ups are actually served.

The TMS match page links a line-up per side, and every one of those links
answers 403 to our fetcher. The official FIH app shows the same line-ups in
full — starting eleven, substitutes with the minute each came on, team staff —
so the data exists and is served to somebody. What follows is an attempt to
find out to whom, rather than another guess.

Three things are tried, in order of how likely they are to be the answer:

1.  A session. TMS is a session-based application and our fetcher keeps no
    cookies at all, so every request arrives as a stranger. This warms up on
    the competition and match pages first, keeping whatever is set, and then
    asks for the line-up as a browser would.

2.  A header matrix. A 403 on a partial is often a same-origin check, an
    XHR-only check, or an Accept negotiation. Each combination is tried on its
    own so the answer is attributable to one header rather than to a bundle.

3.  The page's own wiring. Whatever the browser calls to fill that tab is
    written in the match page. The raw HTML is searched for it — script
    sources, data attributes, fetch/ajax URLs and any other path containing
    "lineup" — because reading the page beats guessing at endpoints.

Run: PROBE_LINEUP_MATCH=22334 python3 scripts/probe_lineups.py
"""
import http.cookiejar
import json
import os
import re
import sys
import urllib.request

HOST = 'https://tms.fih.ch'
COMPETITION = HOST + '/competitions/1866'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')


def opener_with_cookies():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


def get(op, url, headers, label):
    req = urllib.request.Request(url, headers=headers)
    try:
        with op.open(req, timeout=45) as resp:
            body = resp.read()
            print(f'  [{label}] {resp.status} {len(body)} bytes '
                  f'{resp.headers.get("Content-Type", "?")}')
            return body
    except urllib.error.HTTPError as e:
        print(f'  [{label}] HTTP {e.code} {e.reason}')
        return None
    except Exception as e:
        print(f'  [{label}] {e.__class__.__name__}: {e}')
        return None


def main():
    match_id = os.environ.get('PROBE_LINEUP_MATCH', '22334')
    op, jar = opener_with_cookies()
    base = {'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9'}
    html = {'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'}

    print(f'== 1. Warm up a session on the competition and match pages ==')
    get(op, COMPETITION + '/matches', {**base, **html}, 'matches page')
    page = get(op, f'{HOST}/matches/{match_id}', {**base, **html, 'Referer': COMPETITION + '/matches'},
               f'match {match_id}')
    print(f'  cookies now held: {[c.name for c in jar] or "none"}')

    if not page:
        print('  the match page itself did not come back — nothing further to try.')
        return 1
    text = page.decode('utf8', 'ignore')

    print('\n== 2. Read the page for how the line-up tab is filled ==')
    seen = set()
    for m in re.finditer(r'[^\s"\'<>()]*lineup[^\s"\'<>()]*', text, re.I):
        frag = m.group(0)
        if frag in seen:
            continue
        seen.add(frag)
        if len(seen) <= 40:
            print(f'  path| {frag[:140]}')
    for tag, attr in (('script', 'src'), ('link', 'href')):
        for m in re.finditer(rf'<{tag}[^>]+{attr}="([^"]+)"', text, re.I):
            src = m.group(1)
            if any(k in src.lower() for k in ('match', 'lineup', 'app', 'bundle', 'main')):
                print(f'  {tag}| {src[:140]}')
    for m in re.finditer(r'data-[a-z-]*url[a-z-]*="([^"]+)"', text, re.I):
        print(f'  data| {m.group(1)[:140]}')
    # Any absolute API host the page talks to that is not TMS itself.
    for m in set(re.findall(r'https?://[a-z0-9.-]*(?:api|altius|fih)[a-z0-9.-]*/[^\s"\'<>]*', text, re.I)):
        print(f'  host| {m[:140]}')

    # The page embeds its own state as JSON in an attribute — the signature of
    # an Inertia application on a Laravel back end. If that is what this is,
    # the same URLs answer with pure JSON when asked to, and there is nothing
    # to scrape at all.
    print('\n== 3. The page state embedded in the HTML ==')
    blob = re.search(r'data-page="([^"]+)"', text)
    if blob:
        import html as _html
        try:
            payload = json.loads(_html.unescape(blob.group(1)))
            print(f'  data-page found. component={payload.get("component")!r}')
            print(f'  top-level keys: {sorted(payload.keys())}')
            props = payload.get('props') or {}
            print(f'  props keys: {sorted(props.keys())[:40]}')
            for k, v in props.items():
                if isinstance(v, dict):
                    print(f'    {k}: dict({sorted(v.keys())[:18]})')
                elif isinstance(v, list):
                    print(f'    {k}: list[{len(v)}]'
                          + (f' first={sorted(v[0].keys())[:14]}' if v and isinstance(v[0], dict) else ''))
                else:
                    print(f'    {k}: {str(v)[:70]}')
        except Exception as e:
            print(f'  data-page present but did not parse: {e}')
    else:
        print('  no data-page attribute; not an Inertia page.')

    referer = f'{HOST}/matches/{match_id}'
    # The link the page actually carries has no team segment. Ours had one,
    # which is why all eighty-eight answered 403: we were asking for a route
    # that does not exist.
    target = f'{HOST}/matches/{match_id}/lineups'

    print(f'\n== 4. Ask for {target} ==')
    attempts = [
        ('browser page', {**base, **html, 'Referer': referer}),
        ('inertia json', {**base, 'Accept': 'text/html, application/xhtml+xml',
                          'Referer': referer, 'X-Inertia': 'true',
                          'X-Inertia-Version': (payload or {}).get('version', '') if blob else ''}),
        ('xhr', {**base, 'Accept': 'text/html, */*; q=0.01', 'Referer': referer,
                 'X-Requested-With': 'XMLHttpRequest'}),
        ('json', {**base, 'Accept': 'application/json', 'Referer': referer}),
    ]
    for label, headers in attempts:
        body = get(op, target, {k: v for k, v in headers.items() if v != ''}, label)
        if not body:
            continue
        raw = body.decode('utf8', 'ignore')
        inner = re.search(r'data-page="([^"]+)"', raw)
        if inner:
            import html as _html
            try:
                pl = json.loads(_html.unescape(inner.group(1)))
                pr = pl.get('props') or {}
                print(f'      component={pl.get("component")!r} props={sorted(pr.keys())[:30]}')
                for k, v in pr.items():
                    if isinstance(v, list) and v and isinstance(v[0], dict):
                        print(f'      {k}: list[{len(v)}] keys={sorted(v[0].keys())[:16]}')
                        print(f'        first row: {json.dumps(v[0], ensure_ascii=False)[:400]}')
                    elif isinstance(v, dict):
                        print(f'      {k}: dict keys={sorted(v.keys())[:16]}')
                return 0
            except Exception as e:
                print(f'      inner data-page did not parse: {e}')
        lines = [l.strip() for l in re.sub(r'<[^>]+>', '\n', raw).split('\n')]
        lines = [l for l in lines if l][:80]
        print(f'      first {len(lines)} text lines:')
        for l in lines:
            print(f'      | {l[:110]}')
        return 0

    print('\n== 5. Nearby paths ==')
    for path in (f'/matches/{match_id}/lineups.json',
                 f'/matches/{match_id}.json',
                 f'/matches/{match_id}/reports/lineupform'):
        get(op, HOST + path, {**base, **html, 'Referer': referer}, path)
    return 1


if __name__ == '__main__':
    sys.exit(main())
