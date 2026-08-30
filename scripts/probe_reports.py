"""
Hockey.AI — the public reports namespace.

Two TMS reports are already fetched successfully by this pipeline and need no
credential: /competitions/{id}/reports/teams returns the entry lists as a PDF,
and /competitions/{id}/reports/poolstandings returns the tables. So the reports
namespace is public, and it is the obvious place to look for a team sheet —
before anything that needs a login.

What is already established, so it is not re-litigated:
  * /matches/{id}/lineups/{team} is not a route at all.
  * /matches/{id}/lineups answers 404 for every match tried, current and
    historic. It does not serve sheets on the website.
  * /api/v1/matches/{id} answers 401. That route exists and wants a credential,
    which is not something to work around.

This enumerates report names under both the match and the competition, prints
what each returns, and dumps the text of anything that comes back as a PDF.
"""
import http.cookiejar
import io
import os
import re
import sys
import urllib.request

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0 Safari/537.36')
TMS = 'https://tms.fih.ch'
COMP = '1866'

MATCH_REPORTS = [
    'matchreport', 'matchsheet', 'lineupform', 'lineup', 'lineups',
    'teamsheet', 'teamlist', 'matchofficial', 'scoresheet', 'summary',
]
# Penalty corners WON is the one FIH statistic the app cannot show: the match
# report does not carry it, and nothing may be estimated. The competition
# statistics page does publish it — 455 across the tournament, per team, with
# a conversion rate — so the report that backs that page is what this looks
# for. Names are guesses and are meant to be: the probe prints what each one
# answers, and only a report that actually returns gets parsed.
COMP_REPORTS = ['teams', 'poolstandings', 'lineups', 'matchresults', 'scorers',
                'statistics', 'cards', 'matchschedule',
                'teamstatistics', 'teamstats', 'statisticsteams',
                'penaltycorners', 'competitionstatistics', 'summary',
                'tournamentstatistics', 'goals']


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def pdf_lines(body):
    try:
        import pdfplumber
    except ImportError:
        return []
    out = []
    try:
        with pdfplumber.open(io.BytesIO(body)) as pdf:
            for page in pdf.pages:
                out += (page.extract_text() or '').split('\n')
    except Exception as e:
        out = [f'(pdf did not open: {e})']
    return [l.strip() for l in out if l.strip()]


def get(op, url, label, referer=None):
    h = {'User-Agent': UA, 'Accept': 'application/pdf,text/html,*/*'}
    if referer:
        h['Referer'] = referer
    try:
        with op.open(urllib.request.Request(url, headers=h), timeout=30) as r:
            body = r.read()
            ct = r.headers.get('Content-Type', '?')
            print(f'  [{label}] {r.status} {len(body)}B {ct}')
            return body, ct
    except urllib.error.HTTPError as e:
        print(f'  [{label}] HTTP {e.code}')
    except Exception as e:
        print(f'  [{label}] {e.__class__.__name__}: {str(e)[:70]}')
    return None, None


def main():
    match_id = os.environ.get('PROBE_LINEUP_MATCH', '22334')
    op = opener()
    get(op, f'{TMS}/competitions/{COMP}/matches', 'warm up')

    print(f'\n== Reports under match {match_id} ==')
    found = []
    for name in MATCH_REPORTS:
        url = f'{TMS}/matches/{match_id}/reports/{name}'
        body, ct = get(op, url, name, referer=f'{TMS}/matches/{match_id}')
        if body and body[:4] == b'%PDF':
            found.append((name, body))

    print(f'\n== Reports under competition {COMP} ==')
    for name in COMP_REPORTS:
        url = f'{TMS}/competitions/{COMP}/reports/{name}'
        body, ct = get(op, url, name)
        if body and body[:4] == b'%PDF' and name not in ('teams', 'poolstandings'):
            found.append((f'competition/{name}', body))

    # Which names answered is the point of the run, and reading it off the
    # dumps means inferring it from what is missing. Say it outright.
    print('\n== What answered ==')
    for label, names in (('match', MATCH_REPORTS), ('competition', COMP_REPORTS)):
        got = [n for n in names if any(f == n or f == f'competition/{n}' for f, _ in found)]
        print(f'  {label}: PDF from {", ".join(got) or "nothing"}')
        print(f'  {label}: no PDF from {", ".join(n for n in names if n not in got)}')

    for name, body in found:
        lines = pdf_lines(body)
        print(f'\n== {name}: {len(lines)} text lines ==')
        for l in lines[:120]:
            print(f'  | {l[:120]}')
    if not found:
        print('\nNo report under either namespace came back as a PDF.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
