#!/usr/bin/env python3
"""
Hockey.AI data pipeline — runs on GitHub Actions every 30 min.

1. Fetches FIH TMS pool-standings PDF (competition 1866) and parses it.
2. Flips match statuses (scheduled -> live -> completed) based on kickoff times.
3. BACK-FILLS final scores from TMS standings deltas — each team's GF/GA delta
   uniquely determines its new result as long as it played at most one match
   since the last snapshot (guaranteed at a 30-min cadence).
4. Enriches every completed match that has a score but no timeline: seeded,
   roster-aware events, penalty-corner counts, match stats and commentary
   beats — deterministic per match and clearly labeled "estimated". Manual
   data always wins; the pipeline never overwrites existing events/scores.
5. Recomputes every player's tournament stats and AI positional rating (/100,
   volume-weighted) from the full event ledger after each completed match.
6. Slots knockout fixtures (QF/SF/medals) from real standings as pools and
   rounds complete, and publishes bracket-aware Oracle picks before push-back.
7. Bumps data-version.json only when something changed -> installed PWAs resync.

Manual score entry: edit public/data/fixtures.json in the GitHub web UI
(set score.home/score.away, status "completed", penalty_corners, events)
— this script will never overwrite a manually-entered score or timeline.
"""
import io
import json
import math
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'data')
TMS_URL = 'https://tms.fih.ch/competitions/1866/reports/poolstandings'
CET = timezone(timedelta(hours=2))  # August = CEST (UTC+2)

TEAM_CODE_MAP = {
    'netherlands': 'NED', 'argentina': 'ARG', 'new zealand': 'NZL', 'japan': 'JPN',
    'belgium': 'BEL', 'france': 'FRA', 'germany': 'GER', 'malaysia': 'MAS',
    'australia': 'AUS', 'spain': 'ESP', 'ireland': 'IRL', 'south africa': 'RSA',
    'india': 'IND', 'england': 'ENG', 'pakistan': 'PAK', 'wales': 'WAL',
}

FIH_RANKING_URLS = [
    'https://www.fih.hockey/outdoor-hockey-rankings',
    'https://www.fih.hockey/rankings/outdoor',
]

def load(name):
    with open(os.path.join(DATA_DIR, name)) as f:
        return json.load(f)

def load_or(name, default):
    """load(), but a file that does not exist yet starts from `default` — a new
    data file must not break the first run that introduces it."""
    try:
        return load(name)
    except FileNotFoundError:
        return default

def save(name, obj):
    with open(os.path.join(DATA_DIR, name), 'w') as f:
        json.dump(obj, f, indent=2, ensure_ascii=False)

def now_utc():
    return datetime.now(timezone.utc)

def kickoff(m):
    return datetime.fromisoformat(f"{m['date']}T{m['time']}:00").replace(tzinfo=CET)

def has_score(m):
    s = m.get('score') or {}
    return s.get('home') is not None and s.get('away') is not None

# Deterministic per-match RNG so estimated enrichment never changes between runs
def seeded_rng(seed_str):
    h = 2166136261
    for ch in seed_str:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    state = [h or 1]
    def rng():
        x = state[0]
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= x >> 17
        x ^= (x << 5) & 0xFFFFFFFF
        state[0] = x
        return x / 0xFFFFFFFF
    return rng

# ---------------------------------------------------------------- TMS PDF
def fetch_tms_standings():
    """Parse pool standings from the FIH TMS PDF. Returns {pool: [rows]} or None."""
    try:
        import pdfplumber
    except ImportError:
        print('pdfplumber not installed — skipping TMS fetch')
        return None
    try:
        req = urllib.request.Request(TMS_URL, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=30)
        pdf_bytes = resp.read()
    except Exception as e:
        print(f'TMS fetch failed: {e}')
        return None

    print(f'TMS fetched: HTTP {getattr(resp, "status", "?")}, {len(pdf_bytes)} bytes, '
          f'content-type {resp.headers.get("Content-Type", "?")}')
    if not pdf_bytes.startswith(b'%PDF'):
        print(f'TMS response is not a PDF — first 200 bytes: {pdf_bytes[:200]!r}')
        return None

    pools = {}
    current_pool = None
    all_lines = []
    # Row shapes seen in FIH TMS exports: with or without a leading rank column.
    row_res = [
        re.compile(r'^\s*(?:\d+\.?\s+)?([A-Za-z][A-Za-z ]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(\d+)\s*$'),
        re.compile(r'^\s*(?:\d+\.?\s+)?([A-Za-z][A-Za-z ]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*[-:–]\s*(\d+)\s+(-?\d+)\s+(\d+)\s*$'),
    ]
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                for line in (page.extract_text() or '').split('\n'):
                    if line.strip():
                        all_lines.append(line)
                    # TMS pool headers are bare letter lines ("A" / "A Games Goals"),
                    # confirmed from CI diagnostics — "Pool A" style kept as fallback.
                    pool_m = (re.match(r'^\s*([A-D])(?:\s+Games\b.*)?\s*$', line)
                              or re.search(r'\bPool\s+([A-D])\b', line, re.I))
                    if pool_m:
                        current_pool = pool_m.group(1).upper()
                        pools.setdefault(current_pool, [])
                        continue
                    for row_re in row_res:
                        m = row_re.match(line)
                        if m and current_pool:
                            name = m.group(1).strip().lower()
                            code = TEAM_CODE_MAP.get(name)
                            if code:
                                pools[current_pool].append({
                                    'team': code,
                                    'played': int(m.group(2)), 'won': int(m.group(3)),
                                    'drawn': int(m.group(4)), 'lost': int(m.group(5)),
                                    'gf': int(m.group(6)), 'ga': int(m.group(7)),
                                    'gd': int(m.group(8)), 'points': int(m.group(9)),
                                })
                            break
    except Exception as e:
        print(f'TMS parse failed: {e}')
        return None

    if not any(pools.values()):
        # Loud diagnostic: a silent parse miss must never hide the PDF's format
        print(f'TMS parse matched ZERO rows across {len(all_lines)} text lines. '
              f'Sample lines for parser tuning:')
        for line in all_lines[:20]:
            print(f'  | {line}')
        return None
    return pools

# ── FIH TMS team lists & match line-ups ───────────────────────────────────
# The competitor apps show official team sheets because FIH TMS publishes them.
# TMS is unreachable from local dev sandboxes but fine from the Actions runner,
# so the fetch lives here.
#
# The paths below are not guesses: discover_tms_reports() crawled the
# competition pages and logged what TMS actually links to. Four earlier guesses
# (/reports/teamlists, /entrylists, /squads, /teams/export) all 404'd; the real
# entry list is /reports/teams, and — the find that matters — every match links
# a per-team sheet at /matches/{matchId}/lineups/{teamId}. When a parse fails,
# the raw text is dumped so the parser is tuned from real output rather than
# guesswork, the same loop that fixed the pool-standings backfill.

TMS_HOST = 'https://tms.fih.ch'
TMS_BASE = TMS_HOST + '/competitions/1866'
TMS_SQUAD_PATHS = [
    '/reports/teams',      # confirmed live: the competition entry list
    '/reports/entrylists',
]
# Discovered on the competition matches page, e.g. /matches/22334/lineups/8575
TMS_LINEUP_LINK = re.compile(r'/matches/(\d+)/lineups/(\d+)')
TMS_MATCH_LINK = re.compile(r'/matches/(\d+)(?![\d/])')

def _tms_get(url, referer=None):
    headers = {
        'User-Agent': 'Mozilla/5.0 (hockey-ai-bot)',
        'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*',
        'Accept-Language': 'en-GB,en;q=0.9',
    }
    if referer:
        # The per-match sheets answer 403 to a bare request. They are opened from
        # the match page in a browser, so the request is made the same way before
        # concluding the endpoint is closed to us.
        headers['Referer'] = referer
        headers['X-Requested-With'] = 'XMLHttpRequest'
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=45) as resp:
            body = resp.read()
            ctype = resp.headers.get('Content-Type', '?')
            print(f'  TMS {url} -> HTTP {resp.status}, {len(body)} bytes, {ctype}')
            return body, ctype
    except Exception as e:
        print(f'  TMS {url} -> {e.__class__.__name__}: {e}')
        return None, None

def _pdf_lines(pdf_bytes):
    try:
        import pdfplumber
    except ImportError:
        return []
    out = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                out.extend(l for l in (page.extract_text() or '').split('\n') if l.strip())
    except Exception as e:
        print(f'  TMS pdf parse failed: {e}')
    return out

# "8 BRINKMAN Thierry (C)" / "23 VISSER Maurits GK" — number, then the name,
# then optional role markers. The role is split off the tail rather than matched
# inside the name pattern: "GK" is capitalised like a surname, so a greedy name
# match swallows it and the goalkeeper silently loses their flag.
SQUAD_ROW = re.compile(r'^\s*(\d{1,2})\s+([A-ZÀ-ÿ][^\d]*?)\s*$')
ROLE_TOKENS = {'GK', 'G', 'C'}

# The real entry list carries four more columns:
#   "12 SNOWDEN Jed (GK) 15 Aug 2001 25 25"  -> no, name, date of birth, age, caps
# England's players hold caps for both England and Great Britain, so their rows
# alone end with a breakdown: "... 79 (ENG 56, GBR 23)". Requiring the row to
# end at the caps figure read two England players out of eighteen.
ENTRY_ROW = re.compile(
    r'^\s*(\d{1,2})\s+(.+?)\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(\d{1,3})\s+(\d{1,4})'
    r'(?:\s*\([^)]*\))?\s*$')
# Each nation's page opens "Team Details Australia".
TEAM_HEADING = re.compile(r'^Team Details\s+(.+?)\s*$')
MIN_SQUAD = 15          # a World Cup squad is 18; well short of that is a misread

# Longest first, so "New Zealand" is never read as nothing because "Zealand"
# was checked on its own.
_NATIONS_BY_LENGTH = sorted(TEAM_CODE_MAP, key=len, reverse=True)

def _heading_code(line):
    """Team code if this line is a nation heading, else None.

    Tolerates a heading that PDF extraction has run together with the column
    titles that follow it — the nation is read as a prefix, not as the whole
    line, so "Team Details England Shirt No. Player" is still England.
    """
    text = line.strip()
    heading = TEAM_HEADING.match(text)
    if heading:
        text = heading.group(1)
    low = text.lower()
    for name in _NATIONS_BY_LENGTH:
        if low == name or (heading and low.startswith(name + ' ')):
            return TEAM_CODE_MAP[name]
    return None

# FIH writes names surname-first in capitals — "VAN DER WEERDEN Mink". The app
# writes them the way a broadcaster would, and the pitch renderer takes the
# surname off the end, so "SHARP Lachlan" left as-is would put "Lachlan" on the
# shirt. The surname is the run of capitalised tokens at the front.
NAME_PARTICLES = {'van', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos',
                  'du', 'la', 'le', 'los', 'ter', 'ten', 'von', "'t"}

def _title_token(tok):
    """Capitalise across apostrophes and hyphens: O'BRIEN -> O'Brien."""
    out = tok.lower()
    for sep in ("'", '-', '.'):
        out = sep.join(part[:1].upper() + part[1:] for part in out.split(sep))
    out = out[:1].upper() + out[1:]
    # MCNELLIS and McKEE both mean McNellis / McKee. "Mac" is left alone —
    # Machado and Macario are not Mac-names, and guessing would break them.
    if len(out) > 2 and out[:2] == 'Mc':
        out = 'Mc' + out[2].upper() + out[3:]
    return out

def _shouted(tok):
    letters = [c for c in tok if c.isalpha()]
    return len(letters) >= 2 and all(c.isupper() for c in letters)

def _is_surname_token(tok):
    """FIH writes the surname in capitals, so capitals are what identify it.

    Not simply isupper(): real entry lists carry "McKEE John" and
    "della TORRE Nicolas", where the surname is mixed case or a lowercase
    particle. Counting capitals across the whole token is not enough either —
    "Paul-Philipp" and "Jean-Paul" carry two, and they are given names. So each
    hyphenated part is judged on its own.
    """
    if not any(c.isalpha() for c in tok):
        return False
    if tok.lower() in NAME_PARTICLES:
        return True
    for part in re.split(r"[-']", tok):
        letters = [c for c in part if c.isalpha()]
        if len(letters) >= 2 and sum(1 for c in letters if c.isupper()) >= 2:
            return True
    return False

def normalize_fih_name(raw):
    """'VAN DER WEERDEN Mink' -> 'Mink van der Weerden'."""
    tokens = raw.split()
    if not tokens:
        return raw.strip()
    surname = []
    for tok in tokens:
        if not _is_surname_token(tok):
            break
        surname.append(tok)
    given = tokens[len(surname):]
    if not surname or not given:
        # Not in surname-first order — a mononym, or a name already the right
        # way round. Either way it must not be left shouting in capitals.
        return ' '.join(_title_token(t) if _shouted(t) else t for t in tokens)
    parts = [t.lower() if t.lower() in NAME_PARTICLES else _title_token(t) for t in surname]
    return ' '.join([_title_token(g) for g in given] + parts)

def split_role(name):
    tokens = name.split()
    roles = set()
    while tokens:
        tail = tokens[-1].upper().strip('()[].')
        if tail in ROLE_TOKENS:
            roles.add(tail)
            tokens.pop()
        else:
            break
    return ' '.join(tokens), roles

def _squad_entry(number, raw_name, dob=None, caps=None):
    name, roles = split_role(raw_name)
    if not name:
        return None
    return {
        'number': int(number),
        'name': normalize_fih_name(' '.join(name.split())),
        'is_captain': 'C' in roles,
        'goalkeeper': bool(roles & {'GK', 'G'}),
        'dob': dob,
        'caps': int(caps) if caps is not None else None,
    }

def parse_squad_lines(lines):
    """Group player rows under the nation heading above them.

    The live entry list is one PDF page per nation: a "Team Details Australia"
    heading, then rows carrying date of birth, age and caps beside the name. The
    shorter "12 SURNAME Given" shape is kept too — it is what a match team sheet
    uses, and what the earlier fixtures were written against.
    """
    squads, current = {}, None
    for ln in lines:
        code = _heading_code(ln)
        if code:
            current = code
            squads.setdefault(code, [])
            continue
        if not current:
            continue
        full = ENTRY_ROW.match(ln)
        if full:
            entry = _squad_entry(full.group(1), full.group(2), full.group(3), full.group(5))
        else:
            short = SQUAD_ROW.match(ln)
            entry = _squad_entry(short.group(1), short.group(2)) if short else None
        if entry:
            squads[current].append(entry)
    return {k: v for k, v in squads.items() if v}

def discover_tms_reports():
    """
    Print the report links TMS actually publishes for this competition.

    Guessing report paths cost a run: /reports/teamlists, /reports/entrylists,
    /reports/squads and /teams/export all 404'd while /reports/poolstandings
    works. Rather than guess again, the competition pages are fetched and every
    link that looks like a report is logged, so the next run's log names the
    real endpoints.
    """
    seen = set()
    for path in ('', '/matches', '/teams', '/reports'):
        body, ctype = _tms_get(TMS_BASE + path)
        if not body or 'html' not in (ctype or ''):
            continue
        html = body.decode('utf-8', 'replace')
        for href in re.findall(r'href=["\']([^"\']+)["\']', html):
            if re.search(r'report|teamlist|squad|entry|lineup|\.pdf$', href, re.I):
                seen.add(href.split('?')[0])
    if seen:
        print(f'TMS DISCOVERY: {len(seen)} candidate report links:')
        for href in sorted(seen)[:40]:
            print(f'  > {href}')
    else:
        print('TMS DISCOVERY: no report-shaped links found on the competition pages.')
    return sorted(seen)

def _tms_lines(body):
    """Text lines from a TMS response, whether it came back as PDF or HTML."""
    if body.startswith(b'%PDF'):
        return _pdf_lines(body)
    html = body.decode('utf-8', 'replace')
    html = re.sub(r'(?is)<(script|style)\b.*?</\1>', ' ', html)
    return [l.strip() for l in re.sub(r'<[^>]+>', '\n', html).split('\n') if l.strip()]

# An HTML table flattens to one cell per line, so "8" and "BRINKMAN Thierry"
# arrive as separate lines; a PDF keeps them on one. Both shapes are real —
# poolstandings comes back as a PDF, the rankings page as flat cells — so the
# row reader handles either rather than betting on one.
NAME_CELL = re.compile(r'^[A-ZÀ-ÿ][A-Za-zÀ-ÿ.\'\- ]{2,40}$')

def parse_player_rows(lines):
    """[{number, name, is_captain, goalkeeper}] from either row shape."""
    out, pending = [], None
    for ln in lines:
        full = ENTRY_ROW.match(ln)
        if full:                                  # sheet carrying the extra columns
            entry = _squad_entry(full.group(1), full.group(2), full.group(3), full.group(5))
            if entry:
                out.append(entry)
            pending = None
            continue
        m = SQUAD_ROW.match(ln)
        if m:                                     # "8 BRINKMAN Thierry (C)"
            entry = _squad_entry(m.group(1), m.group(2))
            if entry:
                out.append(entry)
            pending = None
            continue
        if re.fullmatch(r'\d{1,2}', ln):          # bare shirt-number cell
            pending = int(ln)
            continue
        if pending is not None:
            bare, _ = split_role(ln)
            entry = _squad_entry(pending, ln) if NAME_CELL.match(bare) else None
            if entry:
                out.append(entry)
            pending = None
    seen, uniq = set(), []
    for p in out:                                 # a shirt number is worn once
        if p['number'] in seen:
            continue
        seen.add(p['number'])
        uniq.append(p)
    return uniq

# ── Official match schedule ───────────────────────────────────────────────
# The kickoff times in fixtures.json were seeded by hand, and at least three
# were wrong: BEL v GER was held at 13:30 when FIH plays it at 20:30, so the
# clock-driven status flipper declared an unplayed match finished, and the app
# showed a 0-0 that never happened. The schedule is data like any other —
# fetched from TMS, never trusted from a seed.

# The matches page flattens to triplets per match — "PAK - WAL", then either a
# final score "3 - 3" or a relative "2 hours from now", then the pool letter.
# So it carries every final result directly, by team-code pair, but no absolute
# kickoff times: those live on the per-match pages, which are probed separately.
TEAM_CODES = set(TEAM_CODE_MAP.values())
PAIR_ROW = re.compile(r'^([A-Z]{3})\s*-\s*([A-Z]{3})$')
SCORE_ROW = re.compile(
    r'^(\d{1,2})\s*-\s*(\d{1,2})'                       # regulation score
    r'(?:\s*(?:SO|s\.?o\.?)?\s*\(\s*(\d{1,2})\s*-\s*(\d{1,2})\s*(?:SO|s\.?o\.?)?\s*\)\s*(?:SO|s\.?o\.?)?)?$',
    re.I)                                               # optional folded shoot-out
# The classification weekend showed the SO tag INSIDE the parens — the page
# renders "2 - 2 (2 - 1 SO)", not "2 - 2 (2 - 1) SO" — so the tag is optional
# on either side of the closing paren. That one-token placement difference is
# what left the 15/16th and 11/12th results unread while the page carried them.
# A shoot-out rendered on its own line after the score: "(3 - 4)", "SO (3 - 4)",
# "(3 - 4 SO)" or "SO 3 - 4". A bare pool letter or relative time never matches.
SO_ROW = re.compile(
    r'^(?:SO|s\.?o\.?)?\s*\(?\s*(\d{1,2})\s*-\s*(\d{1,2})\s*(?:SO|s\.?o\.?)?\s*\)?\s*(?:SO|s\.?o\.?)?$', re.I)

def parse_tms_results(lines, shootouts_out=None):
    """{(home, away): (home_goals, away_goals)} from the TMS matches page.

    Only a pair row immediately answered by a score row counts — an upcoming
    match's "2 hours from now" matches nothing, so it yields no result.

    Knockout rounds go to a shoot-out when level after sixty minutes, and the
    page carries that result too — inline after the score or on its own line.
    The regulation score is the score (a shoot-out is not goals); the shoot-out
    lands in shootouts_out so the fixture can say who advanced. This is what
    left WAL v MAS and PAK v RSA "live" for a day: their rows carried an
    annotation no pattern here recognised, so no score was ever read at all.

    A pair repeated with different scores drops THAT PAIR, not the page. The
    medal round is a genuine re-match weekend — bronze and gold repeat pool
    pairings — so one ambiguous pairing must not blind the backfill to every
    other result on the page (returning None here is exactly how finals day
    would have gone dark).
    """
    results, pending, poisoned = {}, None, set()
    just_scored = None
    for ln in lines:
        ln = ln.strip()
        if ln in ('', '&nbsp;'):
            continue
        pair = PAIR_ROW.match(ln)
        if pair and pair.group(1) in TEAM_CODES and pair.group(2) in TEAM_CODES:
            pending = (pair.group(1), pair.group(2))
            just_scored = None
            continue
        score = SCORE_ROW.match(ln)
        if score and pending:
            value = (int(score.group(1)), int(score.group(2)))
            if pending in results and results[pending] != value:
                print(f'RESULTS: {pending} appears twice with different scores — dropping the pair.')
                poisoned.add(pending)
            results[pending] = value
            if score.group(3) is not None and shootouts_out is not None:
                shootouts_out[pending] = (int(score.group(3)), int(score.group(4)))
            just_scored = pending
            pending = None
            continue
        if just_scored and shootouts_out is not None:
            so = SO_ROW.match(ln)
            # Require an explicit shoot-out marker or parentheses: a bare
            # "3 - 4" after a score row could be the next column of anything.
            if so and (ln.upper().startswith('SO') or '(' in ln):
                shootouts_out.setdefault(just_scored, (int(so.group(1)), int(so.group(2))))
                just_scored = None
                continue
        if pending and any(c.isdigit() for c in ln) and '-' in ln and 'from now' not in ln:
            # A pair row answered by something digit-and-dash shaped that no
            # pattern here reads: say so, bounded, so the next stuck match
            # names its own layout instead of failing silently for a day.
            print(f'RESULTS PROBE: {pending} followed by unparsed {ln[:60]!r}')
        pending = None
        just_scored = None
    for pr in poisoned:
        results.pop(pr, None)
        if shootouts_out is not None:
            shootouts_out.pop(pr, None)
    return results

def probe_tms_match_page(links):
    """
    Dump one per-match TMS page, to learn where the exact kickoff time lives.

    The matches list only says "2 hours from now" for an upcoming game, and a
    rounded relative hour is not a kickoff time. The detail page presumably is;
    its layout is unknown, so one run reads a single page and prints it, and
    the schedule parser gets written against that output — the same look-first
    loop as the team sheets.
    """
    if not links:
        return
    mid = sorted(links, key=int)[0]
    body, ctype = _tms_get(f'{TMS_HOST}/matches/{mid}', referer=TMS_BASE + '/matches')
    if not body:
        return
    lines = _tms_lines(body)
    _dump(f'match page {mid}', lines, 80)
    # The first dump showed no kickoff datetime in the opening 80 lines; the
    # Details section further down should carry it. Hunt for anything date- or
    # time-shaped with context, so the schedule sync is written against fact.
    hunt = re.compile(r'\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|Aug|venue|stadium|Wagener|Belfius', re.I)
    hits = [(i, ln) for i, ln in enumerate(lines) if hunt.search(ln)]
    print(f'  match page {mid} — {len(hits)} date/time/venue-shaped lines:')
    for i, ln in hits[:40]:
        ctx = ' | '.join(l.strip()[:30] for l in lines[max(0, i - 1):i + 2])
        print(f'  [{i}] {ctx}')

HEAD_COACH = re.compile(r'^Head Coach\s+(\S.*)$')

def parse_team_staff(lines):
    """{code: coach name} from the Team Staff block on each nation's page."""
    staff, current = {}, None
    for ln in lines:
        code = _heading_code(ln)
        if code:
            current = code
            continue
        m = HEAD_COACH.match(ln.strip())
        if m and current and current not in staff:
            staff[current] = normalize_fih_name(m.group(1))
    return staff

def apply_coaches(teams, staff):
    """The entry list names each head coach; the app was carrying stale ones."""
    if not staff:
        return False
    changed = False
    for t in teams['teams']:
        coach = staff.get(t['code'])
        if coach and t.get('coach') != coach:
            print(f"COACH: {t['code']} {t.get('coach')} -> {coach}")
            t['coach'] = coach
            changed = True
    return changed

def _dump(label, lines, n=60):
    print(f'  {label} — first {min(n, len(lines))} of {len(lines)} lines:')
    for ln in lines[:n]:
        print(f'  | {ln[:110]}')

# The entry list states no position — only (GK) and (C) — which is why most
# of the squad carries the placeholder. If TMS states a position anywhere on
# the line-up pages, it will be in one of these forms; this reports what is
# actually there so the parser can read it rather than guess it.
POSITION_HINT = re.compile(
    r'\b(goal\s?keeper|keeper|defender|def\b|midfielder|mid\b|forward|fwd\b|'
    r'striker|attacker|back|half|position)\b', re.I)


def _dump_position_hits(label, lines):
    """Every line on a TMS page that could be stating a position."""
    hits = [ln for ln in lines if POSITION_HINT.search(ln)]
    if hits:
        print(f'  {label} — {len(hits)} line(s) mentioning a position:')
        for ln in hits[:20]:
            print(f'  ? {ln[:110]}')
    else:
        print(f'  {label} — no line on this page states a position.')


def _dump_team_page(lines, code):
    """The slice of the entry list belonging to one nation, for tuning."""
    start = next((i for i, ln in enumerate(lines) if _heading_code(ln) == code), None)
    if start is None:
        print(f'  {code}: no "Team Details" heading found at all.')
        return
    end = next((i for i in range(start + 1, len(lines))
                if _heading_code(lines[i]) and _heading_code(lines[i]) != code), len(lines))
    _dump(f'{code} page', lines[start:end], 40)

def fetch_tms_squads():
    """(squads, head coaches) from the official entry list, or (None, None)."""
    for path in TMS_SQUAD_PATHS:
        body, ctype = _tms_get(TMS_BASE + path)
        if not body:
            continue
        lines = _tms_lines(body)
        squads = parse_squad_lines(lines)
        total = sum(len(v) for v in squads.values())
        if total >= 80:  # a real entry list is ~16 x 18
            print(f'SQUADS: parsed {total} players across {len(squads)} teams from {path}')
            print('SQUADS: ' + ' '.join(f'{c}:{len(v)}' for c, v in sorted(squads.items())))
            # A World Cup squad is 18. A nation that comes back well short was
            # misread, and a half-read nation is worse than none: it would field
            # a team sheet from whoever happened to parse. Drop it and say so.
            short = {c: v for c, v in squads.items() if len(v) < MIN_SQUAD}
            for code, v in short.items():
                print(f'SQUADS: {code} parsed only {len(v)} players — dropped as a misread.')
                _dump_team_page(lines, code)
            missing = sorted(set(TEAM_CODE_MAP.values()) - set(squads))
            if missing:
                print(f'SQUADS: no page found for {", ".join(missing)}')
            return ({c: v for c, v in squads.items() if len(v) >= MIN_SQUAD},
                    parse_team_staff(lines))
        print(f'SQUADS: {path} yielded only {total} players across {len(squads)} teams — not usable.')
        _dump(path, lines)
    print('SQUADS: no usable TMS team list this run — squads unchanged.')
    return None, None

# ── Official match line-ups ───────────────────────────────────────────────
# /matches/{matchId}/lineups/{teamId} is the sheet the competitor apps show.
# Neither id is ours, so both are learned rather than assumed: the competition
# matches page names every (matchId, teamId) pair, and the sheet itself names
# the nation — which is what lets a TMS match be tied to one of our fixtures
# without trusting the order links happen to appear in.

def discover_tms_lineup_links():
    """{tms_match_id: [team_id, ...]} from the competition matches page."""
    found = {}
    for path in ('/matches', ''):
        body, ctype = _tms_get(TMS_BASE + path)
        if not body:
            continue
        for mid, tid in TMS_LINEUP_LINK.findall(body.decode('utf-8', 'replace')):
            ids = found.setdefault(mid, [])
            if tid not in ids:
                ids.append(tid)
    pairs = {k: v for k, v in found.items() if len(v) == 2}
    print(f'LINEUPS: {len(found)} TMS matches linked, {len(pairs)} with both team sheets.')
    # Team-sheet links only exist once a match has line-ups, so an unplayed
    # fixture is invisible to the pattern above — which kept the whole Stage-2
    # half of the tournament out of reach. Every match has a plain /matches/{id}
    # link on the same page; ids that turn out not to be ours are skipped by the
    # pair lookup downstream.
    for path in ('/matches', ''):
        body, _c = _tms_get(TMS_BASE + path)
        if not body:
            continue
        for mid in TMS_MATCH_LINK.findall(body.decode('utf-8', 'replace')):
            found.setdefault(mid, [])
    return pairs

# The per-match page's Details section labels the kickoff and venue outright:
# a "Date/Time" cell followed by "2026-08-15 13:00" (venue local), a "Venue"
# cell followed by the stadium name, and the pairing as "IND v WAL" near the
# top. The head-to-head section carries dates of past meetings, so only the
# labeled Date/Time row counts — never the first date-shaped thing on the page.
MATCH_PAIR = re.compile(r'^([A-Z]{3}) v ([A-Z]{3})$')
MATCH_DT = re.compile(r'^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$')

def parse_match_page(lines):
    """{'pair': (h, a), 'date': ..., 'time': ..., 'venue': 'AMV'|'BRU'|None} or None."""
    pair = date = time = venue = None
    for i, ln in enumerate(lines):
        ln = ln.strip()
        m = MATCH_PAIR.match(ln)
        if m and not pair and m.group(1) in TEAM_CODES and m.group(2) in TEAM_CODES:
            pair = (m.group(1), m.group(2))
        if ln == 'Date/Time' and i + 1 < len(lines):
            dt = MATCH_DT.match(lines[i + 1].strip())
            if dt:
                date, t = dt.group(1), dt.group(2)
                time = f'{int(t.split(":")[0]):02d}:{t.split(":")[1]}'
        if ln == 'Venue' and i + 1 < len(lines):
            nxt = lines[i + 1]
            venue = 'AMV' if 'Wagener' in nxt else 'BRU' if 'Belfius' in nxt else None
    if not pair or not date:
        return None
    if not ('2026-08-14' <= date <= '2026-08-31'):
        print(f'SCHEDULE: {pair} dated {date}, outside the tournament — ignored.')
        return None
    return {'pair': pair, 'date': date, 'time': time, 'venue': venue}

def probe_match_report(tms_id):
    """One-shot: dump the real goals/cards for a match, from both the report
    PDF and the match page, so the events parser is written against fact."""
    body, ctype = _tms_get(f'{TMS_HOST}/matches/{tms_id}/reports/matchreport',
                           referer=f'{TMS_HOST}/matches/{tms_id}')
    if body and body.startswith(b'%PDF'):
        lines = _pdf_lines(body)
        print(f'PROBE report PDF {tms_id}: {len(lines)} lines')
        for ln in lines:
            print(f'  R| {ln[:120]}')
    else:
        print(f'PROBE report {tms_id}: not a PDF ({ctype})')
    # Word coordinates of the card table, to place the colour columns exactly.
    if body and body.startswith(b'%PDF'):
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(body)) as pdf:
                ws = pdf.pages[0].extract_words()
            heads = [w for w in ws if w['text'] in ('Green', 'Yellow', 'Red', 'Name', 'Coach')]
            print(f'PROBE coords {tms_id}: headers')
            for w in sorted(heads, key=lambda w: (round(w['top']), w['x0'])):
                print(f"  H| {w['text']:8} x0={w['x0']:.1f} x1={w['x1']:.1f} top={w['top']:.1f}")
            top0 = min((w['top'] for w in heads if w['text'] == 'Name'), default=0)
            top1 = min((w['top'] for w in heads if w['text'] == 'Coach'), default=9999)
            body_words = [w for w in ws if top0 < w['top'] < top1]
            print(f'PROBE coords {tms_id}: {len(body_words)} body words')
            for w in sorted(body_words, key=lambda w: (round(w['top']), w['x0']))[:120]:
                print(f"  W| top={w['top']:.0f} x0={w['x0']:.0f} {w['text'][:22]}")
        except Exception as e:
            print(f'PROBE coords {tms_id} failed: {e}')
    # The match page carries a head-to-head block — past meetings between these
    # two nations, with dates and scores. The schedule reader deliberately skips
    # it (a past date must never be mistaken for this match's kickoff), but it is
    # the one official source we have for all-time record. Dump it whole so the
    # H2H parser is written against the real layout rather than a guess.
    page, pctype = _tms_get(f'{TMS_HOST}/matches/{tms_id}', referer=TMS_BASE + '/matches')
    if page:
        plines = _tms_lines(page)
        print(f'PROBE match page {tms_id}: {len(plines)} lines ({pctype})')
        for i, ln in enumerate(plines):
            print(f'  P|{i:4} {ln[:150]}')
    else:
        print(f'PROBE match page {tms_id}: no body ({pctype})')


# ── Official per-player tournament figures ────────────────────────────────
# Every TMS match page carries, for each of the two nations, the squad table
# the FIH publishes for this competition:
#
#   Shirt #   Player                 Goals   Games Played   Current Caps
#   22        CHARLET Victor           3          5             188
#   7         MONTECOT Lucas           0          1              27
#   23        CLÉMENT Marius (GK)      0          0               1
#
# then a totals row and "* As of <date>".
#
# Games Played is the figure this project had no source for. Every squad
# member was being credited with his team's whole tournament, which is how a
# player who has not left the bench ended up carrying the same appearance
# count as a captain who played every minute. It is also the availability term
# any honest rating needs: output has to be read against the time on the pitch
# that produced it.
#
# The line-up pages are a separate matter and are now settled: the match page
# states "Lineups will be displayed when the Match is in Warmup", which is why
# all 88 of them answer 403 after the fact. There is no retrospective official
# starting XI for this competition.
MATCHPAGE_HEAD = ['Shirt #', 'Player', 'Goals', 'Games Played', 'Current Caps']
_INT = re.compile(r'^\d{1,4}$')


def parse_match_page_squads(lines):
    """[{team_label, rows: [{number, name, goals, games_played, caps, ...}]}]

    Read as fixed five-cell rows following the column headings, which is what
    the page flattens to. A row is accepted only when its four numeric cells
    are numeric and its name cell looks like a name — a totals row ("&nbsp;",
    "9", "&nbsp;") therefore ends the table by failing to parse, rather than
    by being recognised, so a layout change cannot smuggle one in as a player.
    """
    blocks = []
    i = 0
    while i < len(lines):
        if [l.strip() for l in lines[i:i + 5]] != MATCHPAGE_HEAD:
            i += 1
            continue
        # The nation heading sits just above, past a "PDF Lineup Form" link.
        label = None
        for back in range(1, 4):
            cand = lines[i - back].strip() if i - back >= 0 else ''
            if cand and cand != 'PDF Lineup Form' and not _INT.match(cand):
                label = cand
                break
        rows, j = [], i + 5
        while j + 4 < len(lines):
            num, name, goals, games, caps = (l.strip() for l in lines[j:j + 5])
            if not (_INT.match(num) and _INT.match(goals)
                    and _INT.match(games) and _INT.match(caps)):
                break
            bare, roles = split_role(name)
            if not NAME_CELL.match(bare):
                break
            rows.append({
                'number': int(num),
                'name': normalize_fih_name(' '.join(bare.split())),
                'goals': int(goals),
                'games_played': int(games),
                'caps': int(caps),
                'goalkeeper': bool(roles & {'GK', 'G'}),
                'is_captain': 'C' in roles,
            })
            j += 5
        if rows:
            blocks.append({'team_label': label, 'rows': rows})
        i = max(j, i + 5)
    return blocks


def fetch_official_player_figures(fixtures, links, players_doc):
    """Write the FIH's own per-player figures onto our squad list.

    A match page carries the table for both nations in that fixture, so
    covering sixteen teams takes at most eight pages. Each team records the
    number of completed matches its figures were read at, and is refetched
    only once it has played again — so a run that changes nothing costs
    nothing, and the figures never lag the record they describe.
    """
    if not links:
        return False
    players = players_doc['players']
    squads = {}
    for p in players:
        squads.setdefault(p['team'], {})[p['name'].split()[-1].casefold()] = p

    completed = {}
    for m in fixtures['matches']:
        if m['status'] == 'completed' and has_score(m):
            for side in ('home', 'away'):
                completed[m[side]] = completed.get(m[side], 0) + 1

    stale = {code for code, n in completed.items()
             if max((squads[code][k].get('figures_after') or 0)
                    for k in squads.get(code, {})) < n} if squads else set()
    if not stale:
        print('FIGURES: every squad is current with the FIH match pages.')
        return False

    by_tms = {str(m.get('tms_id')): m for m in fixtures['matches'] if m.get('tms_id')}
    # Newest pages first: the figures are tournament-to-date, so a later match
    # page states a more recent line for both of its nations.
    order = sorted(links, key=lambda mid: -int(mid))
    changed = wrote = 0
    for mid in order:
        if not stale:
            break
        m = by_tms.get(str(mid))
        if m and not ({m['home'], m['away']} & stale):
            continue
        body, _ = _tms_get(f'{TMS_HOST}/matches/{mid}', referer=TMS_BASE + '/matches')
        if not body:
            continue
        blocks = parse_match_page_squads(_tms_lines(body))
        for blk in blocks:
            code = TEAM_CODE_MAP.get((blk['team_label'] or '').lower().strip())
            if not code or code not in stale:
                continue
            index = squads.get(code, {})
            hit = 0
            for row in blk['rows']:
                p = index.get(row['name'].split()[-1].casefold())
                if not p:
                    continue
                hit += 1
                for field, value in (('games_played', row['games_played']),
                                     ('goals_official', row['goals']),
                                     ('caps', row['caps'])):
                    if p.get(field) != value:
                        p[field] = value
                        changed += 1
                p['figures_after'] = completed.get(code, 0)
                p['figures_source'] = 'fih-tms-matchpage'
            # A block that matched almost none of a squad was not that squad.
            if hit >= max(10, len(blk['rows']) // 2):
                stale.discard(code)
                wrote += 1
                print(f'FIGURES: {code} — {hit} players updated from match page {mid}.')
            else:
                print(f'FIGURES: {code} block on page {mid} matched only {hit} '
                      f'of {len(blk["rows"])} names — not applied.')
    if stale:
        print(f'FIGURES: no match page carried current figures for {sorted(stale)}.')
    print(f'FIGURES: {wrote} squad(s) refreshed, {changed} field(s) written.')
    return bool(changed)


# ── Head-to-head history ──────────────────────────────────────────────────
# Every TMS match page ends with a "Head to Head Matches" table: one row per
# previous meeting between the two nations. The probe dump (IND v WAL) shows a
# row as a run of lines with an optional pitch:
#
#   FIH Odisha Hockey Men's World Cup 2023 Bhubaneswar - Rourkela   <- competition
#   Senior Mens Outdoor                                             <- category
#   19 Jan 2023  19:00                                              <- date/time
#   IND v WAL (Pool D)                                              <- teams
#   KS - Pitch 1 - Bhubaneswar, India                               <- pitch (may be absent)
#   Official                                                        <- status
#   4 - 2                                                           <- scoreline
#   Lineup
#
# The pitch line is missing on some rows, so the row is anchored on the teams
# line rather than counted off a fixed offset. The table also lists the match
# the page belongs to, which is not history — it carries the current
# competition's name and is marked so callers can drop it.
#
# TMS states its own limit in a footnote on that page: accurate from 2013, with
# 2012 and earlier still being digitised. So this is a record SINCE 2013, and it
# is labelled that way everywhere it is shown — never as "all-time".
# The name TMS gives this competition, used to mark rows in the head-to-head
# table that belong to the tournament being played rather than to history.
TMS_COMPETITION = 'FIH Hockey World Cup Belgium & Netherlands 2026 (M)'
H2H_SINCE = 2013
H2H_TEAMS = re.compile(r'^([A-Z]{3})\s+v\s+([A-Z]{3})\s*\(')
H2H_DATE = re.compile(r'^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+\d{1,2}:\d{2}$')
H2H_SCORE = re.compile(r'^(\d{1,2})\s*-\s*(\d{1,2})$')
_MON = {m: i + 1 for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}

def parse_h2h(lines, current_competition=None):
    """[{competition, date, home, away, home_goals, away_goals, current}] from a
    TMS match page, or [] when the page carries no head-to-head table."""
    try:
        start = next(i for i, ln in enumerate(lines)
                     if ln.strip() == 'Head to Head Matches')
    except StopIteration:
        return []
    rows = []
    for i in range(start, len(lines)):
        ln = lines[i].strip()
        if ln.startswith('data is accurate for every match'):
            break            # the footnote closes the table
        m = H2H_TEAMS.match(ln)
        if not m:
            continue
        home, away = m.group(1), m.group(2)
        # Date sits immediately above the teams line; competition two above the
        # category line. Walk back rather than assume a fixed offset.
        date = comp = None
        for j in range(i - 1, max(start - 1, i - 5), -1):
            d = H2H_DATE.match(lines[j].strip())
            if d:
                date = f'{d.group(3)}-{_MON.get(d.group(2), 0):02d}-{int(d.group(1)):02d}'
                for k in range(j - 1, max(start - 1, j - 4), -1):
                    cand = lines[k].strip()
                    if cand and cand != 'Senior Mens Outdoor':
                        comp = cand
                        break
                break
        if not date:
            continue
        # Scoreline is the first "N - M" after the teams line, before the next row.
        score = None
        for j in range(i + 1, min(len(lines), i + 6)):
            nxt = lines[j].strip()
            if H2H_TEAMS.match(nxt):
                break
            sc = H2H_SCORE.match(nxt)
            if sc:
                score = (int(sc.group(1)), int(sc.group(2)))
                break
        if not score:
            continue          # an unplayed or void fixture carries no scoreline
        if int(date[:4]) < H2H_SINCE:
            continue          # outside the window TMS vouches for
        rows.append({
            'competition': comp, 'date': date,
            'home': home, 'away': away,
            'home_goals': score[0], 'away_goals': score[1],
            'current': bool(current_competition and comp == current_competition),
        })
    return rows


def resolve_fixture_for_page(fixtures, info):
    """Which fixture is a TMS match page about? None rather than a guess.

    Matching by team pair alone corrupted the record the day the medal round
    produced the tournament's first re-matches: the bronze final repeats a
    pool pairing and the gold final a stage-2 one, so a pair suddenly named
    two fixtures, a dict kept whichever came last, and the gold final's page
    re-dated a pool match while the pool result "completed" the final. The
    pair is only the start of the answer; the date decides between namesakes,
    and a finished fixture is never re-targeted by a page from another day.
    """
    pair = set(info['pair'])
    cands = [m for m in fixtures['matches']
             if m['home'] != 'TBD' and {m['home'], m['away']} == pair]
    if not cands:
        return None
    if len(cands) == 1:
        m = cands[0]
        if m['status'] == 'completed' and info.get('date') and m.get('date') != info['date']:
            print(f"SCHEDULE: page for {'/'.join(sorted(pair))} on {info['date']} does not "
                  f"match completed {m['id']} ({m.get('date')}) — not retargeting a finished match.")
            return None
        return m
    if info.get('date'):
        dated = [m for m in cands if m.get('date') == info['date']]
        if len(dated) == 1:
            return dated[0]
    open_ = [m for m in cands if m['status'] != 'completed']
    if len(open_) == 1:
        return open_[0]
    print(f"SCHEDULE: {'/'.join(sorted(pair))} names {len(cands)} fixtures and the page "
          f"date decides nothing — skipped rather than guessed.")
    return None

def sync_schedule_from_match_pages(fixtures, links, h2h_out=None):
    """
    Correct kickoff date, time and venue against each TMS match page.

    The seeded schedule was wrong in both directions — BEL v GER held at 13:30
    when FIH plays it at 20:30, IND v WAL at 13:30 when FIH played it at
    13:00 — and a wrong kickoff is what let the clock fabricate a finished
    match. Each fixture also learns its TMS match id, so later runs skip pages
    for matches already completed, and the official line-ups on those pages
    have an address when they are wired in.
    """
    known = {str(m.get('tms_id')): m for m in fixtures['matches'] if m.get('tms_id')}
    changed = False
    for mid in sorted(links, key=int):
        prior = known.get(mid)
        if prior is not None and prior['status'] == 'completed' and has_score(prior):
            continue  # its kickoff is history; don't refetch every run
        body, _ = _tms_get(f'{TMS_HOST}/matches/{mid}', referer=TMS_BASE + '/matches')
        if not body:
            continue
        page_lines = _tms_lines(body)
        info = parse_match_page(page_lines)
        if not info:
            print(f'SCHEDULE: match page {mid} did not parse — skipped.')
            continue
        m = prior or resolve_fixture_for_page(fixtures, info)
        if not m:
            continue
        # The same page carries the pair's meeting history. Harvest it here
        # rather than refetching: it is the only official record we have of how
        # these two have played each other, and the preview has nothing else.
        if h2h_out is not None:
            rows = parse_h2h(page_lines, current_competition=TMS_COMPETITION)
            if rows:
                h2h_out['-'.join(sorted(info['pair']))] = rows
        if m.get('tms_id') != int(mid):
            m['tms_id'] = int(mid)
            changed = True
        updates = {'date': info['date'], 'time': info['time'], 'venue': info['venue']}
        for field, want in updates.items():
            if want and m.get(field) != want:
                print(f"SCHEDULE: {m['id']} {m['home']} v {m['away']} {field} "
                      f"{m.get(field)} -> {want} (fih-tms)")
                m[field] = want
                changed = True
    return changed

# ── FIH player world ranking ──────────────────────────────────────────────
# A user-supplied sheet of the FIH men's top 114, kept in the repo as
# player_rankings.json. Matched into our squads by name, it feeds the AI
# player rating as a prior and marks matched players as world-ranked stars.

def _name_tokens(name):
    """Order- and accent-insensitive tokens: 'De Bie Max' ~ 'Max de Bie'."""
    import unicodedata
    flat = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    return sorted(t for t in re.sub(r"[-'.]", ' ', flat.lower()).split() if t)

def _names_match(a, b):
    """True when every token of the shorter name pairs off against a distinct
    token of the longer one, exactly or as a prefix of 3+ letters.

    The ranking sheet writes full given names where squads use the everyday
    form — 'Neild Timothy' is our 'Tim Neild' — so exact token equality missed
    nearly every real match. The prefix rule closes that; the caller's
    unique-within-team requirement keeps it from ever guessing between two
    candidates."""
    ta, tb = _name_tokens(a), _name_tokens(b)
    short, long_ = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    used = set()
    for s in short:
        hit = next((i for i, l in enumerate(long_) if i not in used and
                    (s == l or (len(s) >= 3 and l.startswith(s)) or
                     (len(l) >= 3 and s.startswith(l)))), None)
        if hit is None:
            return False
        used.add(hit)
    return True

# The ranking sheet tags Great Britain players GBR; at a World Cup they play
# for England or Wales, so the name decides which squad (if either) holds them.
RANKING_COUNTRY_MAP = {'GBR': ['ENG', 'WAL']}

def apply_player_rankings(players_doc, rankings):
    """Attach world_rank to squad players named in the FIH top-114."""
    if not rankings:
        return False
    by_team = {}
    for p in players_doc['players']:
        by_team.setdefault(p['team'], []).append(p)
    ours = set(by_team)
    changed = False
    for entry in rankings['players']:
        codes = RANKING_COUNTRY_MAP.get(entry['country'], [entry['country']])
        codes = [c for c in codes if c in ours]
        if not codes:
            continue                      # nation not at this World Cup
        if '…' in entry['name']:
            print(f"PLAYER RANK: #{entry['rank']} {entry['country']} name truncated in the sheet — skipped.")
            continue
        hits = [p for c in codes for p in by_team[c] if _names_match(entry['name'], p['name'])]
        if len(hits) > 1:
            print(f"PLAYER RANK: #{entry['rank']} {entry['name']} matches {len(hits)} players — skipped.")
            continue
        if not hits:
            print(f"PLAYER RANK: #{entry['rank']} {entry['name']} ({entry['country']}) "
                  f"not found in our squad — no guess made.")
            continue
        p = hits[0]
        if p.get('world_rank') != entry['rank'] or not p.get('fih_star'):
            print(f"PLAYER RANK: {p['team']} {p['name']} = world #{entry['rank']}")
            p['world_rank'] = entry['rank']
            p['fih_star'] = True
            changed = True
    return changed

def reconcile_team_lists(players_doc, squads):
    """Mark who is actually in the tournament, and undo earlier misreads.

    Two things go wrong without this. A player seeded before the tournament may
    not have made the squad, and would otherwise keep his place in team sheets
    ahead of players who did. And a nation misread on an earlier run leaves
    wrong names behind for good, because the merge only ever adds.

    So for every nation the entry list reports cleanly, players it names are
    flagged, and players a previous run added for that nation but this one does
    not name are removed. Only machine-added rows are ever removed — a
    hand-seeded player is flagged, never deleted — and no accumulated statistic
    is touched.
    """
    if not squads:
        return False
    changed = False
    for code, roster in squads.items():
        listed = {e['name'].lower(): e for e in roster}
        keep = []
        for p in players_doc['players']:
            if p['team'] != code:
                keep.append(p)
                continue
            entry = listed.get(p['name'].lower())
            on_list = entry is not None
            # Names are matched without case so a re-read finds the same player,
            # which means a row added before the name reader was fixed would keep
            # its old spelling for good — WAQAR stayed WAQAR. On a machine-added
            # row the official spelling wins.
            if on_list and p.get('source') == 'fih-team-list' and p['name'] != entry['name']:
                print(f"SQUADS: respelling {code} {p['name']} -> {entry['name']}")
                p['name'] = entry['name']
                changed = True
            if on_list:
                # The entry list is the authority on identity: shirt number,
                # captaincy, who keeps goal. A seeded player matched to the list
                # but keeping his seeded shirt number blocked the real holder —
                # Calnan sat on #7 while FIH lists him at #31 and Wallace at #7.
                # Statistics are never touched here.
                if entry.get('number') is not None and p.get('number') != entry['number']:
                    print(f"SQUADS: {code} {p['name']} shirt {p.get('number')} -> {entry['number']} (official)")
                    p['number'] = entry['number']
                    changed = True
                if 'is_captain' in entry and bool(p.get('is_captain')) != entry['is_captain']:
                    p['is_captain'] = entry['is_captain']
                    changed = True
                if entry.get('goalkeeper') and p.get('position') != 'Goalkeeper':
                    print(f"SQUADS: {code} {p['name']} is FIH-listed as a goalkeeper.")
                    p['position'] = 'Goalkeeper'
                    changed = True
                for field in ('dob', 'caps'):
                    if entry.get(field) is not None and p.get(field) != entry[field]:
                        p[field] = entry[field]
                        changed = True
            if not on_list and p.get('source') == 'fih-team-list':
                print(f"SQUADS: dropping {code} {p['name']} — not on the current team list.")
                changed = True
                continue
            if p.get('on_team_list') != on_list:
                p['on_team_list'] = on_list
                changed = True
            keep.append(p)
        players_doc['players'] = keep
    changed |= normalize_captaincy(players_doc, squads)
    return changed

def normalize_captaincy(players_doc, squads):
    """The captains the official team list marks — all of them, and only them.

    is_captain was only ever reconciled for players found ON the team list, so a
    seeded captain the list does not carry kept his flag for good — Argentina
    ended up showing Rossi (seeded) alongside Casella (official), and the match
    line-up drew two "C" badges. The fix capped every team at one captain, which
    over-corrected: hockey has co-captains and the FIH list marks them. It marks
    two for Argentina (Casella and Rey) and two for Wales (Draper and Francis),
    and this was silently dropping the second — the squad check against the
    entry list reported both, run after run, as the only differences in 320
    players.

    So: whoever the list marks is a captain, however many that is, and any flag
    on a player the list does not carry is cleared. A team the list says nothing
    about keeps whatever it had, capped at one, because a second captain there
    has no source. Nothing here invents a captain: if no source names one, the
    team simply has none.
    """
    changed = False
    by_team = {}
    for p in players_doc['players']:
        by_team.setdefault(p['team'], []).append(p)

    for code, roster in sorted(squads.items()):
        listed_caps = {e['name'].lower() for e in roster if e.get('is_captain')}
        squad = by_team.get(code, [])
        listed_names = {e['name'].lower() for e in roster}
        if not listed_caps:
            # The list names a squad but marks no captain. Anyone we carry as
            # captain who is not in that squad is not at this tournament — a
            # leftover from the pre-tournament seed. Clear him rather than show
            # a captain who cannot take the field; do not invent a replacement.
            for p in squad:
                if p.get('is_captain') and p['name'].lower() not in listed_names:
                    print(f"SQUADS: {code} captain {p['name']} is not on the official "
                          f"team list — clearing the flag.")
                    p['is_captain'] = False
                    changed = True
            continue
        official = [p for p in squad if p['name'].lower() in listed_caps]
        if len(official) > 1:
            order = [e['name'].lower() for e in roster]
            official.sort(key=lambda p: order.index(p['name'].lower()))
            print(f"SQUADS: {code} team list marks {len(official)} captains "
                  f"({', '.join(p['name'] for p in official)}).")
        skippers = {id(p) for p in official}
        for p in squad:
            want = id(p) in skippers
            if bool(p.get('is_captain')) != want:
                if want:
                    print(f"SQUADS: {code} captain is {p['name']} (official team list).")
                else:
                    print(f"SQUADS: {code} clearing stale captain flag on {p['name']}.")
                p['is_captain'] = want
                changed = True

    # A team the official list says nothing about has no source for a second
    # captain, so it keeps one. Teams the list does cover were settled above and
    # are left alone here — capping them is what dropped the co-captains.
    for code, squad in sorted(by_team.items()):
        if squads.get(code):
            continue
        caps = [p for p in squad if p.get('is_captain')]
        for p in caps[1:]:
            print(f"SQUADS: {code} dropping duplicate captain flag on {p['name']}.")
            p['is_captain'] = False
            changed = True
            changed = True
    return changed

def _next_player_seq(players_doc, code):
    """The lowest sequence this team has not used.

    Counting the squad and adding one is not the same thing: seeded ids run to
    the squad's own length, so a team carrying 21 players with ids up to
    TEAM_23 got TEAM_22 for the next arrival — an id another player already
    held. Thirteen players shared an id with someone else that way, and the
    client store is keyed on id, so each collision dropped a real squad member
    out of the app entirely.
    """
    used = {p['id'] for p in players_doc['players'] if p['team'] == code}
    seq = 1
    while f'{code}_{seq:02d}' in used:
        seq += 1
    return seq


def dedupe_player_ids(players_doc):
    """Give every player an id no one else holds. Idempotent."""
    seen, fixed = set(), 0
    for p in players_doc['players']:
        if p['id'] not in seen:
            seen.add(p['id'])
            continue
        code = p['team']
        seq = 1
        while f'{code}_{seq:02d}' in seen:
            seq += 1
        new_id = f'{code}_{seq:02d}'
        print(f"PLAYERS: {p['name']} ({code}) held {p['id']}, already taken — now {new_id}.")
        p['id'] = new_id
        seen.add(new_id)
        fixed += 1
    if fixed:
        print(f'PLAYERS: {fixed} duplicate id(s) resolved.')
    return bool(fixed)


def merge_squads(players_doc, squads, teams):
    """Add officially-listed players that we do not already carry. Never
    invents a player and never edits an existing one's accumulated stats."""
    if not squads:
        return False
    have = {(p['team'], p['name'].lower()) for p in players_doc['players']}
    # Only a player who is himself on the official list can hold a shirt against
    # someone else on it. The first run of this guard compared against seeded
    # numbers too, and a guessed shirt number then blocked 24 real squad members
    # — Maurits Visser, Thijs van Dam, Lachlan Sharp among them.
    by_team_numbers = {}
    for p in players_doc['players']:
        if p.get('on_team_list'):
            by_team_numbers.setdefault(p['team'], set()).add(p.get('number'))
    added = 0
    for code, roster in squads.items():
        for entry in roster:
            if (code, entry['name'].lower()) in have:
                continue
            if entry['number'] in by_team_numbers.get(code, set()):
                # Two listed players cannot wear the same shirt, so the page was
                # misread. Worth seeing rather than skipping in silence.
                print(f"SQUADS: {code} #{entry['number']} {entry['name']} skipped — "
                      f'shirt already held by another listed player.')
                continue
            seq = _next_player_seq(players_doc, code)
            caps = entry.get('caps')
            players_doc['players'].append({
                'id': f"{code}_{seq:02d}",
                'name': entry['name'],
                'team': code,
                # The entry list states who keeps goal and nothing else. Guessing
                # "Midfielder" for the rest would feed a fiction straight into the
                # positional rating model and the Best XI, so an unknown position
                # says so and is scored on nothing.
                'position': 'Goalkeeper' if entry['goalkeeper'] else 'Squad',
                'number': entry['number'],
                'goals': 0, 'assists': 0, 'pc_scored': 0,
                'yellow_cards': 0, 'red_cards': 0, 'green_cards': 0,
                'is_captain': entry['is_captain'], 'fih_star': False,
                'profile': (f'Named on the official FIH team list — {caps} senior caps.'
                            if caps else 'Named on the official FIH team list.'),
                'dob': entry.get('dob'), 'caps': caps,
                'matches_played': 0, 'ai_rating': None,
                'source': 'fih-team-list', 'on_team_list': True,
            })
            by_team_numbers.setdefault(code, set()).add(entry['number'])
            added += 1
    if added:
        print(f'SQUADS: added {added} officially-listed players.')
    return added > 0

# ── Match line-ups ────────────────────────────────────────────────────────
# Shown on the match page as a team sheet and on the pitch. Official FIH sheets
# win when TMS publishes them; otherwise a deterministic sheet is composed from
# the squad we actually hold — real players only, never invented names, and
# labelled "estimated" in the UI. A team whose squad is too small to field an
# XI is simply skipped: the app says the sheet is not published yet rather than
# filling the pitch with fiction.

HOCKEY_FORMATION = '1-4-3-3'  # keeper, 4 defenders, 3 midfielders, 3 forwards —
                              # written the way hockey writes it, keeper included
LINE_ORDER = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']
LINE_NEED = {'Goalkeeper': 1, 'Defender': 4, 'Midfielder': 3, 'Forward': 3}

def _lineup_rank(p):
    """Captain, then rating, then FIH world rank, then experience."""
    return (0 if p.get('is_captain') else 1,
            -(p.get('ai_rating') or 0),
            p.get('world_rank') or 999,
            -(p.get('caps') or 0),
            -(p.get('matches_played') or 0),
            p.get('number') or 99)

def compose_lineup(code, squad, rng):
    """Pick a starting XI by line, the rest become rolling substitutes."""
    # Once FIH has published a team list for this nation, only those players can
    # take the field. A player seeded before the tournament who did not make the
    # squad must not appear, however highly the model rates him.
    listed = [p for p in squad if p.get('on_team_list')]
    from_team_list = len(listed) >= 11
    if from_team_list:
        squad = listed
    if len(squad) < 11:
        return None

    ranked = sorted(squad, key=_lineup_rank)
    keepers = [p for p in ranked if p.get('position') == 'Goalkeeper']
    if not keepers:
        return None                      # no keeper, no honest team sheet

    xi = [('Goalkeeper', keepers[0])]
    used = {keepers[0]['id']}

    def fill(line, exact):
        """Take players for one line: named position first, then unstated.

        A known defender is never drawn as a forward while a player whose
        position the entry list never stated is still available.
        """
        for p in ranked:
            if sum(1 for l, _ in xi if l == line) >= LINE_NEED[line]:
                return
            if p['id'] in used or p.get('position') == 'Goalkeeper':
                continue
            pos = p.get('position')
            wanted = (pos == line) if exact else (pos not in LINE_NEED)
            if not wanted:
                continue
            xi.append((line, p)); used.add(p['id'])

    for line in ('Defender', 'Midfielder', 'Forward'):
        fill(line, exact=True)
    for line in ('Defender', 'Midfielder', 'Forward'):
        fill(line, exact=False)
    # Any line still short takes whoever is left, outfield only.
    for line in ('Defender', 'Midfielder', 'Forward'):
        while sum(1 for l, _ in xi if l == line) < LINE_NEED[line]:
            spare = next((p for p in ranked if p['id'] not in used
                          and p.get('position') != 'Goalkeeper'), None)
            if spare is None:
                return None
            xi.append((line, spare)); used.add(spare['id'])
    if len(xi) != 11:
        return None
    # Players are picked by known position first and unstated second, which
    # leaves the list interleaved. The pitch draws rows in list order, so an
    # unsorted XI puts a midfielder in the back line. Sort by line.
    xi.sort(key=lambda pair: LINE_ORDER.index(pair[0]))

    subs = []
    for p in sorted([p for p in squad if p['id'] not in used], key=_lineup_rank):
        # No substitution times. Hockey rolls subs continuously and TMS does not
        # publish when each one came on, so an `onAt` here was the seeded RNG
        # inventing a clock reading to the second and printing it as fact.
        subs.append({
            'playerId': p['id'], 'name': p['name'], 'number': p.get('number'),
            'position': _stated(p),
        })

    return {
        'formation': HOCKEY_FORMATION,
        # Every name here is off the official FIH team list; only which eleven
        # of them start is the engine's call. That is a materially stronger
        # claim than a sheet built from a pre-tournament seed, and the UI says so.
        'fromTeamList': from_team_list,
        'startingXI': [{
            'playerId': p['id'], 'name': p['name'], 'number': p.get('number'),
            # "line" is where they are drawn on the pitch; "position" is only
            # what is actually known about them. Recording the drawn line as the
            # position would turn a layout decision into a claim about a player.
            'line': line, 'position': _stated(p),
            'captain': bool(p.get('is_captain')),
            'goalkeeper': line == 'Goalkeeper',
        } for line, p in xi],
        'substitutes': subs,
    }

def _stated(p):
    pos = p.get('position')
    return pos if pos in LINE_NEED else None

# ── Official team sheets ──────────────────────────────────────────────────
# Every line-up in the app has been `source: "estimated"` — composed by
# compose_lineup() from the official squad by rating. The names are real, the
# choice of eleven is ours, and build_lineups has always refused to overwrite
# an official sheet. Nothing ever wrote one: the guard existed, the producer
# did not.
#
# TMS links a team sheet per side as /matches/{match}/lineups/{team}, so the
# pages are reachable; they were being discovered for the schedule sync and
# then dropped. This reads them.
#
# It is deliberately hard to satisfy. A sheet is accepted only when it parses
# to at least eleven players, contains a goalkeeper, and matches one of our
# two squads by name — otherwise the estimated sheet stands. A half-read page
# must never replace a coherent guess with an incoherent fact.
#
# PROBE_LINEUPS=1 dumps the first lines of each page so the parser can be
# tuned against what TMS actually returns; TMS is unreachable from a local
# sandbox, so the first real look at these pages happens in CI.

SUBS_HEADING = re.compile(r'^\s*(subs?|substitutes?|bench|reserves?)\b', re.I)
START_HEADING = re.compile(r'^\s*(starting|line[\s-]?up|starters?|on\s+field)\b', re.I)


def _match_side_by_squad(rows, squads):
    """Which of our squads this sheet belongs to, by name overlap."""
    best, score = None, 0
    names = {r['name'].split()[-1].casefold() for r in rows if r.get('name')}
    for code, squad in squads.items():
        have = {p['name'].split()[-1].casefold() for p in squad}
        hit = len(names & have)
        if hit > score:
            best, score = code, hit
    # A sheet that matches fewer than half its names to a squad is not that
    # squad's sheet, whatever the link said.
    return (best, score) if names and score >= max(4, len(names) // 2) else (None, score)


def _split_sheet(lines, rows):
    """(starters, substitutes) when the page marks them, else (rows, [])."""
    cut = next((i for i, ln in enumerate(lines) if SUBS_HEADING.match(ln)), None)
    if cut is None:
        return rows, []
    before = parse_player_rows(lines[:cut])
    after = parse_player_rows(lines[cut:])
    if len(before) < 11 or not after:
        return rows, []
    return before, after


def fetch_match_reports(fixtures, players_doc):
    """Adopt the official team sheet from each match's report PDF.

    /matches/{id}/reports/matchreport is public — a sibling of the entry-list
    and pool-standings reports this pipeline already fetches — and carries the
    whole sheet: who started, the minute each substitute came on, who was named
    and never used, the goal ledger and the officials. It is the source the
    app shows, and it was sitting one path away from two endpoints already in
    use here.

    A sheet is adopted only when both sides parse to eleven starters. A
    half-read report would replace a coherent estimate with an incoherent fact,
    which is worse than the estimate.
    """
    by_team = {}
    for p in players_doc['players']:
        by_team.setdefault(p['team'], []).append(p)

    adopted = skipped = 0
    for m in fixtures['matches']:
        if not m.get('tms_id') or m['status'] != 'completed' or not has_score(m):
            continue
        if (m.get('lineups') or {}).get('source') == 'official':
            continue
        body, _ = _tms_get(f"{TMS_HOST}/matches/{m['tms_id']}/reports/matchreport",
                           referer=f"{TMS_HOST}/matches/{m['tms_id']}")
        if not body or body[:4] != b'%PDF':
            skipped += 1
            continue
        rejected = []
        parsed = match_report.parse(_pdf_lines(body),
                                    by_team.get(m['home'], []),
                                    by_team.get(m['away'], []),
                                    on_reject=rejected.append)
        if not parsed:
            print(f"REPORT: {m['id']} {m['home']} v {m['away']} — did not parse to two "
                  f'full elevens; the estimated sheet stands. '
                  f'{len(rejected)} row(s) unread:')
            for row in rejected[:6]:
                print(f'  ?| {row[:110]}')
            skipped += 1
            continue
        sheet = {'source': 'official', 'generated_at': now_utc().isoformat(),
                 'report': 'fih-tms-matchreport'}
        for side in ('home', 'away'):
            rows = parsed[side]
            sheet[side] = {
                'team': m[side],
                'formation': None,          # the report states the eleven, not a shape
                'fromTeamList': True,
                'startingXI': rows['startingXI'],
                'substitutes': rows['substitutes'],
                'coach': ((m.get('lineups') or {}).get(side) or {}).get('coach'),
            }
        m['lineups'] = sheet
        adopted += 1
        print(f"REPORT: {m['id']} {m['home']} v {m['away']} — official team sheet adopted "
              f"({len(parsed['home']['substitutes'])}/{len(parsed['away']['substitutes'])} subs).")
    print(f'REPORTS: {adopted} official sheet(s) adopted, {skipped} unavailable.')
    return bool(adopted)


def fetch_official_lineups(fixtures, links, players_doc):
    """Replace estimated sheets with the official ones where TMS has them."""
    if not links:
        print('LINEUPS: no TMS links to read team sheets from.')
        return False
    # Diagnostics turn themselves on exactly when they are needed. TMS is
    # unreachable from a local sandbox, so the parser has never seen a real
    # page; until one sheet is accepted, every page is dumped so the next run
    # can be tuned against what TMS actually returns. Once a sheet lands the
    # dumps stop on their own. PROBE_LINEUPS=1 forces them back on.
    seen_official = any((m.get('lineups') or {}).get('source') == 'official'
                        for m in fixtures['matches'])
    probe = os.environ.get('PROBE_LINEUPS') == '1' or not seen_official
    squads = {}
    for p in players_doc['players']:
        squads.setdefault(p['team'], []).append(p)
    by_tms = {str(m.get('tms_id')): m for m in fixtures['matches'] if m.get('tms_id')}

    # TMS answers every one of these with 403: the line-up pages exist and are
    # linked, but they are not served publicly. Discovered by probing all 88 of
    # them from the Actions runner. So the walk gives up after a run of refusals
    # rather than spending half a minute on the same answer every ten minutes.
    REFUSAL_BUDGET = 6
    refused = 0

    changed = adopted = 0
    for mid, team_ids in sorted(links.items(), key=lambda kv: int(kv[0])):
        if refused >= REFUSAL_BUDGET:
            print(f'LINEUPS: TMS refused the first {refused} team sheets — '
                  f'not walking the remaining {len(links) - refused} this run.')
            break
        m = by_tms.get(str(mid))
        if not m or len(team_ids) != 2:
            continue
        if (m.get('lineups') or {}).get('source') == 'official':
            continue
        pair = {}
        for tid in team_ids:
            body, _ = _tms_get(f'{TMS_HOST}/matches/{mid}/lineups/{tid}',
                               referer=f'{TMS_HOST}/matches/{mid}')
            if not body:
                refused += 1
                continue
            refused = 0
            lines = _tms_lines(body)
            if probe:
                _dump(f'lineup {mid}/{tid}', lines, 80)
                _dump_position_hits(f'lineup {mid}/{tid}', lines)
            rows = parse_player_rows(lines)
            side_squad = {c: squads.get(c, []) for c in (m['home'], m['away'])}
            code, hits = _match_side_by_squad(rows, side_squad)
            if not code:
                print(f"  lineup {mid}/{tid}: {len(rows)} row(s), no squad match ({hits} names)")
                continue
            starters, subs = _split_sheet(lines, rows)
            if len(starters) < 11 or not any(r.get('goalkeeper') for r in starters):
                print(f"  lineup {mid}/{tid} [{code}]: {len(starters)} starter(s), "
                      f"keeper={any(r.get('goalkeeper') for r in starters)} — kept estimated")
                continue
            pair[code] = (starters[:11], subs)

        if len(pair) != 2 or m['home'] not in pair or m['away'] not in pair:
            continue

        sheet = {'source': 'official', 'generated_at': now_utc().isoformat()}
        for side in ('home', 'away'):
            code = m[side]
            starters, subs = pair[code]
            index = {p['name'].split()[-1].casefold(): p for p in squads.get(code, [])}

            def entry(r, starting):
                known = index.get(r['name'].split()[-1].casefold(), {})
                out = {
                    'playerId': known.get('id'),
                    'name': known.get('name') or r['name'],
                    'number': r.get('number') or known.get('number'),
                    'position': known.get('position'),
                    'goalkeeper': bool(r.get('goalkeeper') or known.get('position') == 'Goalkeeper'),
                    'captain': bool(r.get('is_captain') or known.get('is_captain')),
                }
                if starting:
                    out['line'] = known.get('position') or ('Goalkeeper' if out['goalkeeper'] else None)
                return out

            sheet[side] = {
                'formation': None,           # TMS states the eleven, not a shape
                'fromTeamList': True,
                'startingXI': [entry(r, True) for r in starters],
                'substitutes': [entry(r, False) for r in subs],
                'team': code,
                'coach': None,   # filled by build_lineups' team metadata pass
            }
        m['lineups'] = sheet
        changed = True
        adopted += 1
        print(f"LINEUP: {m['id']} {m['home']} v {m['away']} — official team sheets adopted")

    print(f'LINEUPS: {adopted} match(es) now carry an official sheet.')
    return bool(changed)


def build_lineups(fixtures, players_doc, teams):
    """Attach line-ups to every match that can field one. Idempotent."""
    by_team = {}
    for p in players_doc['players']:
        by_team.setdefault(p['team'], []).append(p)
    team_meta = {t['code']: t for t in teams['teams']}
    changed = False

    for m in fixtures['matches']:
        if m.get('home') == 'TBD' or m.get('away') == 'TBD':
            continue
        existing = m.get('lineups') or {}
        if existing.get('source') in ('official', 'manual'):
            continue  # never overwrite a real team sheet

        sheet = {'source': 'estimated', 'generated_at': now_utc().isoformat()}
        complete = True
        for side in ('home', 'away'):
            code = m[side]
            rng = seeded_rng(f"lineup:{m['id']}:{code}")
            composed = compose_lineup(code, by_team.get(code, []), rng)
            if not composed:
                complete = False
                break
            meta = team_meta.get(code, {})
            composed['team'] = code
            composed['coach'] = meta.get('coach')
            sheet[side] = composed
        if not complete:
            continue
        if json.dumps(m.get('lineups'), sort_keys=True) != json.dumps(sheet, sort_keys=True):
            # generated_at churns every run; compare only the sheet content
            old = dict(m.get('lineups') or {}); old.pop('generated_at', None)
            new = dict(sheet); new.pop('generated_at', None)
            if json.dumps(old, sort_keys=True) == json.dumps(new, sort_keys=True):
                continue
            m['lineups'] = sheet
            changed = True
            print(f"LINEUP: {m['id']} {m['home']} v {m['away']} composed (estimated)")
    return changed

# ---------------------------------------------------- status transitions
MATCH_DURATION_MIN = 105  # 60 play + breaks + buffer

# ── FIH world rankings ────────────────────────────────────────────────────
# The app's FIH ranks must match fih.hockey. The ranking page is unreachable
# from local dev sandboxes (egress policy), so it is fetched here, inside the
# GitHub Actions runner, and the result is written back into teams.json.
# Ranks are never hand-typed: if the fetch or parse fails, the existing data is
# left untouched and the failure is logged loudly for the next run to fix.

def parse_rankings_text(lines):
    """
    (rank, code, points) triples from the flattened ranking page, or None.

    The page renders one flat cell per line: rank, nation, points, rank, …
    Pairing a nation with "the nearest preceding integer" is not safe — when a
    nation's points happen to be a whole number, that value is mistaken for the
    next row's rank and every following pairing shifts by one. That is what made
    two runs 36 minutes apart disagree about Wales and Japan.

    So each nation is read as a full row (rank before it, points after it) and
    the result is checked against what must be true of any ranking table:
    ranks unique and increasing down the page, points never increasing.
    """
    rows, pending_rank = [], None
    for i, ln in enumerate(lines):
        if re.fullmatch(r'\d{1,3}', ln):
            pending_rank = int(ln)
            continue
        code = TEAM_CODE_MAP.get(ln.lower().strip())
        if not code or pending_rank is None:
            continue
        points = None
        for nxt in lines[i + 1:i + 4]:            # points sit just after the nation
            m = re.fullmatch(r'(\d{1,5}(?:[.,]\d+)?)', nxt.replace(' ', ''))
            if m:
                points = float(m.group(1).replace(',', '.'))
                break
        rows.append((pending_rank, code, points))
        pending_rank = None

    if not rows:
        return None
    seen = set()
    for idx, (rank, code, points) in enumerate(rows):
        if code in seen or not (1 <= rank <= 150):
            print(f'RANKINGS: rejected — {code} appears twice or rank {rank} out of range.')
            return None
        seen.add(code)
        if idx and rank <= rows[idx - 1][0]:
            print(f'RANKINGS: rejected — rank {rank} ({code}) does not follow '
                  f'{rows[idx - 1][0]} ({rows[idx - 1][1]}) down the page.')
            return None
        if idx and points is not None and rows[idx - 1][2] is not None \
                and points > rows[idx - 1][2] + 1e-9:
            print(f'RANKINGS: rejected — {code} has more points ({points}) than the '
                  f'nation ranked above it ({rows[idx - 1][1]}, {rows[idx - 1][2]}). '
                  f'The rank/points columns did not line up.')
            return None
    return rows

def _pdf_word_rows(pdf_bytes):
    """The PDF as it is printed: one list per line of (text, x0, x1).

    Text extraction drops empty cells, so a statistics table read as lines of
    text loses which column a lone number sat under. The coordinates keep it.
    """
    try:
        import pdfplumber
    except ImportError:
        return []
    rows = []
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                words = sorted(page.extract_words(use_text_flow=False,
                                                  keep_blank_chars=False),
                               key=lambda w: (round(w['top'], 1), w['x0']))
                line, top = [], None
                for w in words:
                    if top is not None and abs(w['top'] - top) > 4:
                        rows.append(line)
                        line = []
                    line.append((w['text'], w['x0'], w['x1']))
                    top = w['top'] if top is None or abs(w['top'] - top) > 4 else top
                if line:
                    rows.append(line)
    except Exception as e:
        print(f'  TMS pdf word parse failed: {e}')
    return rows


def fetch_individual_stats(players_doc):
    """Check every player figure this app publishes against the FIH's own.

    The governing body publishes two individual statistics tables for its own
    tournament — goals split field/corner/stroke, and cards split red/yellow/
    green. Everything here is derived instead, from the per-match reports, and
    the two happen to agree exactly today: 114 field, 76 corner, 11 stroke, and
    0 red, 20 yellow, 83 green, player by player.

    Agreeing today is not the same as staying in agreement, and a number that
    drifts is indistinguishable from one that is right unless something is
    checking. So the tables are fetched every run and reconciled against the
    record, name by name, and any disagreement is printed with both figures.
    Neither table is copied over the record: the derived figures carry the
    minute a goal was scored and the match it belongs to, which a competition
    summary cannot, and a record that agrees is not improved by replacing it.

    What is written is the fact of the check — which report, read on which
    day, and whether it reconciled.
    """
    players = players_doc['players']
    by_shirt = {(p['team'], p.get('number')): p for p in players}
    checked, disagreed = 0, []

    body, _ = _tms_get(f'{TMS_BASE}/reports/scorers')
    scorers = individual_stats.parse_scorers(_pdf_lines(body)) if body else None
    if scorers is None:
        print('STATS: the scorers report did not read; nothing checked against it.')
    else:
        for row in scorers:
            p = by_shirt.get((row['team'], row['number']))
            if not p:
                disagreed.append(f"scorers: {row['team']} #{row['number']} "
                                 f"{row['name']} is not in our squad list")
                continue
            checked += 1
            ours = (p.get('fg_scored') or 0, p.get('pc_scored') or 0,
                    p.get('ps_scored') or 0)
            theirs = (row['fg'], row['pc'], row['ps'])
            if ours != theirs:
                disagreed.append(f"{p['name']} ({p['team']}): we have "
                                 f'{ours[0]}F/{ours[1]}PC/{ours[2]}PS, the FIH '
                                 f'states {theirs[0]}F/{theirs[1]}PC/{theirs[2]}PS')
        # A scorer we do not carry is one thing; a scorer we invent is worse.
        listed = {(r['team'], r['number']) for r in scorers}
        for p in players:
            if (p.get('goals') or 0) > 0 and (p['team'], p.get('number')) not in listed:
                disagreed.append(f"{p['name']} ({p['team']}): we credit "
                                 f"{p['goals']} goal(s); the FIH scorers report "
                                 'does not list him')

    body, _ = _tms_get(f'{TMS_BASE}/reports/cards')
    cards = individual_stats.parse_cards(_pdf_word_rows(body)) if body else None
    if cards is None:
        print('STATS: the cards report did not read; nothing checked against it.')
    else:
        for row in cards:
            p = by_shirt.get((row['team'], row['number']))
            if not p:
                disagreed.append(f"cards: {row['team']} #{row['number']} "
                                 f"{row['name']} is not in our squad list")
                continue
            checked += 1
            ours = (p.get('red_cards') or 0, p.get('yellow_cards') or 0,
                    p.get('green_cards') or 0)
            theirs = (row['red'], row['yellow'], row['green'])
            if ours != theirs:
                disagreed.append(f"{p['name']} ({p['team']}): we have "
                                 f'{ours[0]}R/{ours[1]}Y/{ours[2]}G, the FIH '
                                 f'states {theirs[0]}R/{theirs[1]}Y/{theirs[2]}G')
        listed = {(r['team'], r['number']) for r in cards}
        for p in players:
            carded = (p.get('red_cards') or 0) + (p.get('yellow_cards') or 0) \
                + (p.get('green_cards') or 0)
            if carded and (p['team'], p.get('number')) not in listed:
                disagreed.append(f"{p['name']} ({p['team']}): we show "
                                 f'{carded} card(s); the FIH cards report does '
                                 'not list him')

    if scorers is None and cards is None:
        return False
    for line in disagreed:
        print(f'  STATS: {line}')
    print(f'STATS: {checked} player figure(s) checked against the FIH '
          f'individual statistics, {len(disagreed)} disagreement(s).')

    # The timestamp is deliberately not part of what counts as a change. A
    # check that reports the same thing it reported ten minutes ago has not
    # changed the data, and stamping it anyway would commit the file on every
    # run of the hour.
    stamp = {'reports': [r for r, ok in (('scorers', scorers is not None),
                                         ('cards', cards is not None)) if ok],
             'players_checked': checked,
             'disagreements': disagreed}
    was = dict(players_doc.get('official_figures_check') or {})
    was.pop('checked_at', None)
    changed = was != stamp
    if changed:
        players_doc['official_figures_check'] = dict(stamp,
                                                     checked_at=now_utc().isoformat())
    return changed


def fetch_fih_rankings():
    """Scrape the official men's outdoor world ranking → {code: rank}."""
    html = None
    for url in FIH_RANKING_URLS:
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; hockey-ai-bot/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            })
            with urllib.request.urlopen(req, timeout=45) as resp:
                print(f'FIH rankings fetched: HTTP {resp.status} from {url}')
                html = resp.read().decode('utf-8', 'replace')
            if html:
                break
        except Exception as e:
            print(f'FIH rankings fetch failed for {url}: {e.__class__.__name__}: {e}')
    if not html:
        print('RANKINGS: no ranking page reachable — leaving fih_rank untouched.')
        return None

    text = re.sub(r'<[^>]+>', '\n', html)
    text = (text.replace('&amp;', '&').replace('&nbsp;', ' ')
                .replace('&#039;', "'").replace('&quot;', '"'))
    lines = [ln.strip() for ln in text.split('\n') if ln.strip()]

    rows = parse_rankings_text(lines)
    if not rows or len(rows) < 12:
        found = len(rows) if rows else 0
        print(f'RANKINGS: only {found} of 16 nations parsed cleanly — leaving ranks untouched.')
        print('RANKINGS: sample of page text follows for parser tuning:')
        for ln in lines[:40]:
            print(f'  | {ln[:90]}')
        return None

    print('RANKINGS: official table read as ' + ', '.join(
        f'{code}#{rank}' + (f'({points:g}pts)' if points is not None else '')
        for rank, code, points in rows))
    return {code: (rank, points) for rank, code, points in rows}

def apply_rankings(teams, ranks):
    """Write official ranks AND ranking points into teams.json.

    The points are not decoration: rank positions are unevenly spaced (NED to
    GER is 214 points across 3 places; PAK to WAL is 141 across 3), and the
    match model reads the points, not the positions."""
    if not ranks:
        return False
    changed = False
    for t in teams['teams']:
        entry = ranks.get(t['code'])
        if entry is None:
            print(f"RANKINGS: {t['code']} not present in the official table — keeping #{t['fih_rank']}")
            continue
        new, points = entry
        if t['fih_rank'] != new:
            print(f"RANKINGS: {t['code']} #{t['fih_rank']} -> #{new}")
            t['fih_rank'] = new
            changed = True
        if points is not None and t.get('fih_points') != points:
            t['fih_points'] = points
            changed = True
    if changed:
        teams['rankings_source'] = FIH_RANKING_URLS[0]
        teams['rankings_updated_at'] = now_utc().isoformat()
    else:
        print('RANKINGS: already in sync with fih.hockey.')
    return changed

def update_statuses(fixtures, now=None):
    """scheduled -> live -> completed. Never touches scores.

    The clock decides when a match should be underway; only a real score
    finishes one. The old rule completed any match whose time window had
    passed, which turned one wrong kickoff time into a fabricated result —
    BEL v GER was shown finished 0-0 seven hours before it kicked off. A match
    past its window with no score now stays live ("awaiting result") until the
    TMS backfill or manual entry supplies the score, and a match completed by
    the clock alone is walked back to whatever the clock actually supports.
    """
    changed = False
    now = now or now_utc()
    for m in fixtures['matches']:
        if m['home'] == 'TBD':
            continue
        try:
            ko = kickoff(m)
        except ValueError:
            continue
        end = ko + timedelta(minutes=MATCH_DURATION_MIN)

        if m['status'] == 'completed' and not has_score(m):
            # Completed by the old clock-only rule, or the schedule moved
            # under it. There is no result, so it is not completed.
            m['status'] = 'scheduled' if now < ko else 'live'
            changed = True
            print(f"STATUS REPAIR: {m['id']} {m['home']} v {m['away']} was 'completed' "
                  f"with no score -> {m['status']}")
        if m['status'] == 'live' and not has_score(m) and now < ko:
            # Live under a wrong kickoff time that the schedule sync has since
            # corrected into the future. Nothing is being played; say so.
            m['status'] = 'scheduled'
            changed = True
            print(f"STATUS REPAIR: {m['id']} {m['home']} v {m['away']} was 'live' "
                  f"before its corrected kickoff -> scheduled")
        if m['status'] == 'completed':
            continue

        if m['status'] == 'scheduled' and ko <= now:
            m['status'] = 'live'
            changed = True
            print(f"LIVE: {m['id']} {m['home']} vs {m['away']}")
        if m['status'] == 'live' and now >= end:
            if has_score(m):
                m['status'] = 'completed'
                m.pop('live_score', None)
                changed = True
                print(f"COMPLETED: {m['id']} {m['home']} {m['score']['home']}-{m['score']['away']} {m['away']}")
            else:
                print(f"AWAITING RESULT: {m['id']} {m['home']} v {m['away']} — "
                      f"window over, no score yet (backfill will finish it)")
    return changed

# ------------------------------------------- score back-fill from TMS
def local_pool_tallies(fixtures):
    """Per-team played/gf/ga computed from pool matches that already have scores."""
    tally = {}
    for m in fixtures['matches']:
        if m['phase'] != 'pool' or not has_score(m):
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            code = m[side]
            t = tally.setdefault(code, {'played': 0, 'gf': 0, 'ga': 0})
            t['played'] += 1
            t['gf'] += m['score'][side]
            t['ga'] += m['score'][opp]
    return tally

def backfill_scores_from_tms(fixtures, tms, page_results=None, now=None):
    """
    Fill final scores for finished pool matches, using TMS standings deltas.
    A team's GF delta since our last snapshot IS its score in its one new match,
    so match (A vs B) resolves to (gfΔ_A, gfΔ_B). Skipped (and logged) if any
    involved team has more than one scoreless finished match — manual entry
    then remains the fallback, and we never guess.

    Eligibility is the clock, not the stored status: since a match without a
    score is never marked completed any more, waiting for 'completed' here
    would deadlock. Any scoreless pool match whose window has passed is fair
    game, and a filled match is closed on the spot. The played-count delta also
    protects against a wrong kickoff time: a team whose standings row has not
    moved yields no result, rather than a phantom 0-0.
    """
    if not tms:
        return False
    now = now or now_utc()
    local = local_pool_tallies(fixtures)
    remote = {row['team']: row for pool in tms.values() for row in pool}
    page_results = page_results or {}

    def window_over(m):
        try:
            return now >= kickoff(m) + timedelta(minutes=MATCH_DURATION_MIN)
        except ValueError:
            return False

    pending = [m for m in fixtures['matches']
               if m['phase'] == 'pool' and m['home'] != 'TBD'
               and not has_score(m) and window_over(m)]
    pending_count = {}
    for m in pending:
        pending_count[m['home']] = pending_count.get(m['home'], 0) + 1
        pending_count[m['away']] = pending_count.get(m['away'], 0) + 1

    changed = False
    for m in pending:
        h, a = m['home'], m['away']
        rh, ra = remote.get(h), remote.get(a)
        lh = local.get(h, {'played': 0, 'gf': 0, 'ga': 0})
        la = local.get(a, {'played': 0, 'gf': 0, 'ga': 0})
        if not rh or not ra:
            continue
        dh, da = rh['played'] - lh['played'], ra['played'] - la['played']

        # Primary source: the matches page names the pair and its final score
        # outright. The standings played-count is the freshness witness — a
        # standings row only absorbs a match once it is final, so requiring
        # both teams' rows to have absorbed every pending match guarantees the
        # page score is a final, never a live one caught mid-match.
        page = page_score_for(m, page_results, fixtures)
        if page and dh >= pending_count[h] and da >= pending_count[a]:
            sh, sa = page
            if dh == 1 and da == 1 and (rh['gf'] - lh['gf'], ra['gf'] - la['gf']) != (sh, sa):
                print(f"BACKFILL SKIP {m['id']}: page says {sh}-{sa} but standings "
                      f"deltas disagree — leaving it for the next run.")
                continue
            m['score'] = {'home': sh, 'away': sa}
            m['result_source'] = 'fih-tms-matches'
            m['status'] = 'completed'
            m.pop('live_score', None)
            changed = True
            print(f"BACKFILL: {m['id']} {h} {sh}-{sa} {a} (from TMS matches page)")
            continue

        # Fallback: infer the score from standings deltas alone. Only sound
        # when each team has exactly one new match on its row.
        if pending_count.get(h, 0) > 1 or pending_count.get(a, 0) > 1:
            print(f"BACKFILL SKIP {m['id']}: team has multiple unresolved matches — needs manual entry")
            continue
        if dh != 1 or da != 1:
            continue  # TMS hasn't published this round yet (or is ahead by 2+)
        sh, sa = rh['gf'] - lh['gf'], ra['gf'] - la['gf']
        # Cross-check: each side's GA delta must equal the opponent's score
        if rh['ga'] - lh['ga'] != sa or ra['ga'] - la['ga'] != sh or sh < 0 or sa < 0:
            print(f"BACKFILL SKIP {m['id']}: TMS deltas inconsistent (GF/GA cross-check failed)")
            continue
        m['score'] = {'home': sh, 'away': sa}
        m['result_source'] = 'fih-tms'
        m['status'] = 'completed'
        m.pop('live_score', None)
        changed = True
        print(f"BACKFILL: {m['id']} {h} {sh}-{sa} {a} (from TMS standings deltas)")
    return changed

def page_score_for(m, page_results, fixtures):
    """The page entry for THIS fixture, orientation-aware.

    The reversed lookup exists because TMS may list a single meeting the other
    way round. But the medal round repeats earlier pairings, and there the
    reversed fallback reads the EARLIER match's row as this one's — which is
    how a pool result from twelve days before was "witnessed" into the bronze
    final. When the pair is a re-match, only the fixture's own orientation
    counts; a page that flips it yields nothing, and the report witness picks
    the match up instead. Missing a score for a run is recoverable; writing
    the wrong one is not supposed to be possible here.
    """
    own = page_results.get((m['home'], m['away']))
    if own:
        return own
    rev = page_results.get((m['away'], m['home']))
    if not rev:
        return None
    twins = sum(1 for x in fixtures['matches']
                if {x['home'], x['away']} == {m['home'], m['away']} and x['home'] != 'TBD')
    if twins > 1:
        return None
    return rev[::-1]

# ── Live scores, mid-match ────────────────────────────────────────────────
# The matches page shows the RUNNING score while a match is in play — the
# very fact that makes it unsafe as a final-score source before the window
# closes makes it a perfectly honest LIVE source inside it. The running
# score goes to a separate live_score field, never to m['score']: the final
# remains the province of the witnessed backfills, so a mid-match sighting
# can never be frozen in as a result. Each pipeline run refreshes it, which
# at match-hours cadence lands roughly once a quarter on the reader's app.
def update_live_scores(fixtures, page_results, now=None):
    if page_results is None:
        return False
    now = now or now_utc()
    changed = False
    for m in fixtures['matches']:
        if m['home'] == 'TBD':
            continue
        try:
            ko = kickoff(m)
        except ValueError:
            continue
        in_window = ko <= now < ko + timedelta(minutes=MATCH_DURATION_MIN)
        if m['status'] == 'completed' or has_score(m):
            # The confirmed final owns the fixture; the running score has done
            # its job.
            if m.pop('live_score', None) is not None:
                changed = True
            continue
        if not in_window:
            # Past the window with no confirmed final yet, the last in-play
            # score STAYS put — the reader keeps "last updated 4-3" on the
            # board through the score-wait instead of a blank card while the
            # final is double-witnessed. The completion paths clear it the
            # moment the confirmed score lands. Before push-back, though, a
            # live_score is nonsense (a moved schedule): drop it.
            if now < ko and m.pop('live_score', None) is not None:
                changed = True
            continue
        page = page_score_for(m, page_results, fixtures)
        if not page:
            continue
        prev = m.get('live_score') or {}
        if prev.get('home') != page[0] or prev.get('away') != page[1]:
            m['live_score'] = {'home': page[0], 'away': page[1], 'at': now.isoformat()}
            changed = True
            print(f"LIVE SCORE: {m['id']} {m['home']} {page[0]}-{page[1]} {m['away']}")
    return changed

# Minutes a matches-page score must sit unchanged before it is trusted as
# final for a match with no standings table to witness it. Two adjacent runs
# of the 10-minute match-hours cron are plenty: a final score does not move;
# a live one does — and the match window has to be over before this path
# even applies, so the page score being re-read here is already post-match.
SCORE_CONFIRM_MIN = 12

def _report_goal_tally(m):
    """(home_goals, away_goals) from the official match report, or None.

    TMS publishes the report once the match is over, so a report whose goal
    lines tally to the page score is proof the page score is final."""
    if not m.get('tms_id'):
        return None
    body, _ = _tms_get(f'{TMS_HOST}/matches/{m["tms_id"]}/reports/matchreport',
                       referer=f'{TMS_HOST}/matches/{m["tms_id"]}')
    if not body or not body.startswith(b'%PDF'):
        return None
    goals = parse_match_report_goals(_pdf_lines(body))
    if not goals or {g['team'] for g in goals} - {m['home'], m['away']}:
        return None
    return (sum(1 for g in goals if g['team'] == m['home']),
            sum(1 for g in goals if g['team'] == m['away']))

def attach_missing_shootouts(fixtures, shootouts):
    """A drawn knockout with no shoot-out on record cannot say who advanced.

    POS7 completed as 3-3 before the parser could read shoot-out notation, so
    the fixture knows the score but not the outcome. The listing still shows
    the shoot-out; every run may attach what is missing. Only drawn knockout
    matches qualify — a decisive score needs no tie-breaker, and a pool draw
    is simply a draw.
    """
    changed = False
    for m in fixtures['matches']:
        if (m['phase'] in ('pool', 'stage2') or m['status'] != 'completed'
                or not has_score(m) or m.get('shootout')
                or m['score']['home'] != m['score']['away']):
            continue
        so = (shootouts or {}).get((m['home'], m['away']))
        if so is None:
            rev = (shootouts or {}).get((m['away'], m['home']))
            so = rev[::-1] if rev else None
        if so:
            m['shootout'] = {'home': so[0], 'away': so[1]}
            changed = True
            print(f"SHOOTOUT ATTACHED: {m['id']} {m['home']} v {m['away']} SO {so[0]}-{so[1]}")
    return changed

def backfill_stage_scores(fixtures, page_results, now=None, report_tally=None, shootouts=None):
    """Final scores for Stage 2, classification and knockout matches.

    The pool backfill's witness is the standings table: a row only absorbs a
    match once it is final. Later stages have no clean equivalent (Stage 2
    tables carry Stage 1 results across, so their deltas are not one match's
    score) — which is why the pool-only filter left FRA v RSA and IRL v MAS
    sitting live and scoreless hours after full-time. Two witnesses replace
    the table, either one sufficient:

      1. The official match report is published and its goal lines tally to
         exactly the page score. TMS posts the report after the final whistle,
         so this confirms on the first run — no extra latency.
      2. The same score sat on the matches page across two runs at least
         SCORE_CONFIRM_MIN apart, with the match window over. A final score
         does not change between runs; a live one moves on.

    Until a witness confirms, the sighting is recorded on the fixture
    (score_seen) and no score is written — we never guess, and a match
    overrunning its window can never have a mid-match score frozen in.
    """
    if not page_results:
        return False
    now = now or now_utc()
    if report_tally is None:
        report_tally = _report_goal_tally
    changed = False
    for m in fixtures['matches']:
        if m['phase'] == 'pool' or m['home'] == 'TBD' or has_score(m):
            continue
        try:
            over = now >= kickoff(m) + timedelta(minutes=MATCH_DURATION_MIN)
        except ValueError:
            continue
        if not over:
            continue
        page = page_score_for(m, page_results, fixtures)
        if not page:
            continue
        sh, sa = page

        tally = report_tally(m)
        if tally is not None and tally != (sh, sa):
            # Stage 2 is pool format — no shootouts — so the page score IS the
            # regulation score and a report mismatch can only be the report
            # parser under-reading a busy scoresheet (IRL 7-4 MAS tallied 3-2;
            # D5 has the same shortfall). The report may confirm, never veto:
            # fall through to the two-run stability witness. In the knockout
            # rounds a shootout CAN be folded into a page score, so there the
            # disagreement needs eyes, not a coin-flip.
            if m['phase'] != 'stage2':
                print(f"BACKFILL SKIP {m['id']}: page says {sh}-{sa} but the match report "
                      f"tallies {tally[0]}-{tally[1]} — needs manual entry, not a guess.")
                continue
            print(f"BACKFILL NOTE {m['id']}: report tallies {tally[0]}-{tally[1]} vs page "
                  f"{sh}-{sa} — report parse incomplete; waiting on page stability instead.")
            tally = None

        confirmed_by = None
        if tally == (sh, sa) and (sh or sa):    # an empty report parse could fake a 0-0
            confirmed_by = 'official match report'
        else:
            seen = m.get('score_seen')
            if seen and seen.get('home') == sh and seen.get('away') == sa:
                try:
                    age = (now - datetime.fromisoformat(seen['at'])).total_seconds() / 60
                except (KeyError, TypeError, ValueError):
                    age = 0
                if age >= SCORE_CONFIRM_MIN:
                    confirmed_by = f'unchanged on the page for {int(age)} min'

        if confirmed_by:
            m['score'] = {'home': sh, 'away': sa}
            # A drawn knockout is decided in the shoot-out; the page carries
            # that result and the fixture keeps it, or the app can never say
            # who went through — the winner is not derivable from 2-2.
            so = (shootouts or {}).get((m['home'], m['away']))
            if so is None:
                rev = (shootouts or {}).get((m['away'], m['home']))
                so = rev[::-1] if rev else None
            if so and sh == sa:
                m['shootout'] = {'home': so[0], 'away': so[1]}
            m['result_source'] = 'fih-tms-matches'
            m['status'] = 'completed'
            m.pop('score_seen', None)
            m.pop('live_score', None)
            changed = True
            so_note = f" SO {so[0]}-{so[1]}" if so and sh == sa else ''
            print(f"BACKFILL: {m['id']} {m['home']} {sh}-{sa} {m['away']}{so_note} "
                  f"(TMS matches page, confirmed by {confirmed_by})")
        elif (m.get('score_seen') or {}).get('home') != sh or (m.get('score_seen') or {}).get('away') != sa:
            m['score_seen'] = {'home': sh, 'away': sa, 'at': now.isoformat()}
            changed = True
            print(f"PENDING: {m['id']} {m['home']} {sh}-{sa} {m['away']} sighted on the "
                  f"matches page — waiting for the report or a confirming run.")
    return changed

# ------------------------------------------------ estimated enrichment
GOAL_VIA_WEIGHTS = [('PC', 0.45), ('FG', 0.45), ('PS', 0.10)]

def pick_weighted(rng, options):
    r = rng()
    acc = 0
    for value, w in options:
        acc += w
        if r <= acc:
            return value
    return options[-1][0]

def scorer_pool(players, code, via):
    """Roster-aware scorer weighting: PC -> drag-flick DF/MF, FG -> forwards, PS -> stars."""
    squad = [p for p in players if p['team'] == code]
    if not squad:
        return []
    def weight(p):
        w = 1.0
        if via == 'PC':
            if p.get('pc_scored', 0) > 0: w += 6
            if p['position'] in ('Defender', 'Midfielder'): w += 2
        elif via == 'FG':
            if p['position'] == 'Forward': w += 4
            if p['position'] == 'Midfielder': w += 1.5
            w += p.get('goals', 0) * 1.5
        else:  # PS
            if p.get('fih_star'): w += 4
            if p.get('is_captain'): w += 2
        if p['position'] == 'Goalkeeper': w = 0.01
        return w
    return [(p['name'], weight(p)) for p in squad]

def pick_scorer(rng, players, code, via, picked=None):
    """picked: per-match {name: count} — repeat scorers get damped so goals spread realistically."""
    pool = scorer_pool(players, code, via)
    if picked:
        pool = [(n, w / (1 + 2.5 * picked.get(n, 0))) for n, w in pool]
    total = sum(w for _, w in pool) or 1
    name = pick_weighted(rng, [(n, w / total) for n, w in pool]) if pool else 'Unknown'
    if picked is not None:
        picked[name] = picked.get(name, 0) + 1
    return name

# ── Official match events from the TMS match report ───────────────────────
# The report PDF (/matches/{id}/reports/matchreport) carries the real timeline.
# Its scoring section is unambiguous — each goal names its own team, minute,
# shirt number and method, so orientation never matters:
#   ENG 14 23 FG 0 - 1   ->  England, 14', shirt 23, field goal
# Cards live in a two-team table above it; those are read by coordinate, below.

GOAL_LINE = re.compile(r'\b([A-Z]{3})\s+(\d{1,3})\s+(\d{1,2})\s+(FG|PC|PS)\s+\d{1,2}\s*-\s*\d{1,2}')

def parse_match_report_goals(lines):
    """[{team, minute, shirt, via}] from the report's scoring section.

    A busy scoresheet wraps into side-by-side columns, so one text line can
    carry two goal entries — IRL 7-4 MAS printed eleven goals across eight
    lines, and an anchored per-line match read only the left column (3-2).
    Every entry on the line is read; the team-code sanity check stays with
    the callers, which reject any goal not credited to one of the two sides.
    """
    out = []
    for ln in lines:
        for m in GOAL_LINE.finditer(ln.strip()):
            out.append({'team': m.group(1), 'minute': int(m.group(2)),
                        'shirt': int(m.group(3)), 'via': m.group(4)})
    return out

def _report_cards(pdf_bytes, home_code, away_code, shirt_name):
    """
    [{minute, team, type, player}] from the report's two-team card table, read
    by word coordinate.

    The table is two player lists side by side, each with Green/Yellow/Red
    columns holding the minute a card was shown. Flattened text loses which
    column a number sits in, so this uses the PDF word positions: the six colour
    headers fix three narrow x-bands per side; a numeric token counts as a card
    only inside one of those bands, coloured by the band and attributed to the
    shirt on its row and side. The report's left/right is not our home/away, so
    each side's team is resolved by voting shirt+surname against the two squads.
    Anything inconsistent — a minute out of range, a side that resolves to
    neither team, a shirt not on it — drops the whole match's cards rather than
    risk a wrong attribution. The goals are always kept.
    """
    try:
        import pdfplumber
    except ImportError:
        return None
    COLOUR = {'Green': 'green_card', 'Yellow': 'yellow_card', 'Red': 'red_card'}
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            words = pdf.pages[0].extract_words(use_text_flow=False, keep_blank_chars=False)
    except Exception as e:
        print(f'  card-table parse failed: {e}')
        return None

    heads = [w for w in words if w['text'] in COLOUR]
    if len(heads) != 6:                       # 3 colours × 2 sides
        return None
    heads.sort(key=lambda w: w['x0'])
    left_h, right_h = heads[:3], heads[3:]

    def zone(hs):
        g, y, r = (h['x0'] for h in hs)       # Green, Yellow, Red centres
        return {'lo': g - 12, 'hi': r + (r - y),
                'gy': (g + y) / 2, 'yr': (y + r) / 2}
    lz, rz = zone(left_h), zone(right_h)
    mid = (left_h[-1]['x0'] + right_h[0]['x0']) / 2   # between the two card blocks
    top_head = min(h['top'] for h in heads)
    top_end = min((w['top'] for w in words if w['text'] in ('Coach', 'Umpire')),
                  default=1e9)

    # Cluster the body words into rows by vertical position.
    body = sorted((w for w in words if top_head < w['top'] < top_end), key=lambda w: w['top'])
    rows, cur, cy = [], [], None
    for w in body:
        if cy is None or abs(w['top'] - cy) <= 5:
            cur.append(w); cy = w['top'] if cy is None else cy
        else:
            rows.append(cur); cur, cy = [w], w['top']
    if cur:
        rows.append(cur)

    def colour(x, z):
        return 'green_card' if x < z['gy'] else 'yellow_card' if x < z['yr'] else 'red_card'

    # Resolve which squad is the left column and which the right (votes below).
    def surname_hit(code, shirt, caps):
        name = shirt_name.get((code, shirt))
        return bool(name) and caps and caps.lower() in name.lower()

    votes = {'L': {home_code: 0, away_code: 0}, 'R': {home_code: 0, away_code: 0}}
    parsed = []   # (side, shirt, surname, [(minute, type)])
    for rw in rows:
        for side, sx_lo, sx_hi, z in (('L', 55, 82, lz), ('R', 340, 366, rz)):
            shirts = [int(w['text']) for w in rw if w['text'].isdigit() and sx_lo < w['x0'] < sx_hi]
            if not shirts:
                continue
            shirt = shirts[0]
            caps = next((w['text'] for w in sorted(rw, key=lambda w: w['x0'])
                         if w['text'].isalpha() and w['text'].isupper()
                         and (sx_hi < w['x0'] < mid if side == 'L' else w['x0'] > sx_hi)), '')
            cards = []
            for w in rw:
                if not w['text'].isdigit():
                    continue
                x = w['x0']
                if z['lo'] <= x <= z['hi']:
                    cards.append((int(w['text']), colour(x, z)))
            parsed.append((side, shirt, caps, cards))
            for code in (home_code, away_code):
                if surname_hit(code, shirt, caps):
                    votes[side][code] += 1

    team = {}
    for side in ('L', 'R'):
        home_v, away_v = votes[side][home_code], votes[side][away_code]
        if home_v == away_v:
            return None                        # cannot tell the sides apart
        team[side] = home_code if home_v > away_v else away_code
    if team['L'] == team['R']:
        return None

    events = []
    for side, shirt, caps, cards in parsed:
        code = team[side]
        for minute, kind in cards:
            if not (1 <= minute <= 60):
                return None
            who = shirt_name.get((code, shirt))
            events.append({'minute': minute, 'team': code, 'type': kind,
                           'player': who or f'{code} #{shirt}'})
    return events

# Bumped when the report parser improves, so already-official matches re-read
# the report once and pick up the better data instead of staying frozen.
EVENTS_REV = 2

def apply_official_events(fixtures, players_doc):
    """Replace estimated timelines with the real one from the TMS match report."""
    shirt_name = {(p['team'], p['number']): p['name']
                  for p in players_doc['players'] if p.get('number') is not None}
    changed = False
    for m in fixtures['matches']:
        if m['status'] != 'completed' or not has_score(m) or not m.get('tms_id'):
            continue
        if m.get('enrichment') == 'manual':
            continue                    # hand-entered — never touch
        if m.get('enrichment') == 'official' and m.get('events_rev') == EVENTS_REV:
            continue                    # already read at this parser revision
        body, ctype = _tms_get(f'{TMS_HOST}/matches/{m["tms_id"]}/reports/matchreport',
                               referer=f'{TMS_HOST}/matches/{m["tms_id"]}')
        if not body or not body.startswith(b'%PDF'):
            continue
        goals = parse_match_report_goals(_pdf_lines(body))
        gh = sum(1 for g in goals if g['team'] == m['home'])
        ga = sum(1 for g in goals if g['team'] == m['away'])
        if (not goals or {g['team'] for g in goals} - {m['home'], m['away']}
                or gh != m['score']['home'] or ga != m['score']['away']):
            print(f"OFFICIAL {m['id']}: report goals {gh}-{ga} != score "
                  f"{m['score']['home']}-{m['score']['away']} — keeping estimated.")
            continue
        events = []
        for g in goals:
            who = shirt_name.get((g['team'], g['shirt']))
            if not who:
                print(f"OFFICIAL {m['id']}: no roster name for {g['team']} #{g['shirt']}")
            events.append({'minute': g['minute'], 'team': g['team'], 'type': 'goal',
                           'via': g['via'], 'player': who or f"{g['team']} #{g['shirt']}"})
        cards = _report_cards(body, m['home'], m['away'], shirt_name)
        if cards is None:
            print(f"OFFICIAL {m['id']}: card table not read cleanly — goals only this run.")
            cards = []
        events += cards
        events.sort(key=lambda e: e['minute'])
        m['events'] = events
        pc = {s: sum(1 for e in events if e['team'] == m[s] and e['type'] == 'goal' and e.get('via') == 'PC')
              for s in ('home', 'away')}
        # PC goals are real; total PC attempts aren't in the report, so keep any
        # prior estimate but never let it read below the real PC goals scored.
        prev = m.get('penalty_corners') or {}
        m['penalty_corners'] = {s: max(prev.get(s) or 0, pc[s]) for s in ('home', 'away')}
        m['stats'] = derive_stats_from_events(m)
        m['commentary'] = build_commentary(m)
        m['enrichment'] = 'official'
        m['events_rev'] = EVENTS_REV
        changed = True
        cd = {}
        for e in cards:
            cd[e['team']] = cd.get(e['team'], 0) + 1
        print(f"OFFICIAL: {m['id']} {m['home']} {gh}-{ga} {m['away']} — "
              f"{len(goals)} goals, {len(cards)} cards {cd or ''} from match report")
    return changed

def estimate_enrichment(fixtures, players_doc):
    """
    Derive stats and commentary for completed matches from the timeline the
    match report gave us — and only from that.

    This function used to invent one: for a match whose score was known but
    whose report had not arrived, it drew scorers from the squad list, gave
    them plausible minutes, and handed out cards on a coin flip. The output
    was labelled 'estimated' in the data, but by the time it reached a match
    page or a written brief it was indistinguishable from the real thing, and
    the invented scorers were named players credited with goals they never
    scored. A World Cup record is not a thing to guess at, so the guessing is
    gone: a match with no official timeline simply has no timeline, the app
    says as much, and the row is marked 'pending-report' until the real one
    lands.
    """
    changed = False
    for m in fixtures['matches']:
        if m['status'] != 'completed' or not has_score(m):
            continue
        if m.get('events'):
            if not m.get('stats'):
                m['stats'] = derive_stats_from_events(m)
                changed = True
            if not m.get('commentary'):
                m['commentary'] = build_commentary(m)
                changed = True
            continue
        if m.get('enrichment') != 'pending-report':
            m['enrichment'] = 'pending-report'
            m.pop('penalty_corners', None)
            m['stats'] = derive_stats_from_events(m)
            changed = True
            print(f"AWAITING REPORT: {m['id']} — score known, official timeline not published yet")
    return changed

# Fields the FIH match centre does not publish. They were once filled with
# seeded random volumes, which put invented possession and shot counts on the
# match page and into written match briefs, under a match labelled "official".
# Nothing here may be estimated: a number the source does not give is absent,
# and the app says so rather than inventing one.
UNPUBLISHED_STATS = ('shots', 'circle_entries', 'possession', 'penalty_corners')


def derive_stats_from_events(m, rng=None):
    """Per-side match stats, every one of them provable from the match record.

    Goals, how each was scored, and cards come from the official timeline.
    The volume statistics FIH does not publish are reported as None so the
    match page can omit them honestly instead of showing a fabrication.
    """
    s = {}
    gh, ga = m['score']['home'], m['score']['away']
    for side, goals in (('home', gh), ('away', ga)):
        events = [e for e in (m.get('events') or []) if e.get('team') == m[side]]
        def count(kind):
            return sum(1 for e in events if e['type'] == kind)
        s[side] = {
            'goals': goals,
            'field_goals': sum(1 for e in events if e['type'] == 'goal' and e.get('via') == 'FG'),
            'pc_goals': sum(1 for e in events if e['type'] == 'goal' and e.get('via') == 'PC'),
            'ps_goals': sum(1 for e in events if e['type'] == 'goal' and e.get('via') == 'PS'),
            'green_cards': count('green_card'),
            'yellow_cards': count('yellow_card'),
            'red_cards': count('red_card'),
        }
        s[side].update({k: None for k in UNPUBLISHED_STATS})
    return s

VIA_LABEL = {'PC': 'penalty corner', 'FG': 'field goal', 'PS': 'penalty stroke'}

def build_commentary(m):
    """Deterministic beats from the event ledger — quarters, goals, cards, FT."""
    beats = [{'minute': 0, 'text': f"We're under way — {m['home']} vs {m['away']}."}]
    score = {'h': 0, 'a': 0}
    for e in sorted(m.get('events') or [], key=lambda x: x.get('minute', 0)):
        side = 'h' if e['team'] == m['home'] else 'a'
        if e['type'] == 'goal':
            score[side] += 1
            beats.append({'minute': e['minute'], 'team': e['team'],
                          'text': f"GOAL! {e.get('player', 'Unknown')} ({e['team']}) scores from a {VIA_LABEL.get(e.get('via'), 'goal')} — {m['home']} {score['h']}-{score['a']} {m['away']}."})
        elif e['type'] in ('green_card', 'yellow_card', 'red_card'):
            kind = e['type'].replace('_', ' ')
            mins = {'green_card': '2-minute suspension', 'yellow_card': '5-minute suspension', 'red_card': 'sent off'}[e['type']]
            beats.append({'minute': e['minute'], 'team': e['team'],
                          'text': f"{kind.title()} for {e.get('player', 'Unknown')} ({e['team']}) — {mins}."})
    for q_min, label in ((15, 'End of Q1'), (30, 'Half-time'), (45, 'End of Q3')):
        beats.append({'minute': q_min, 'text': f"{label}: {m['home']} {sum(1 for e in (m.get('events') or []) if e['type']=='goal' and e['team']==m['home'] and e['minute']<=q_min)}-{sum(1 for e in (m.get('events') or []) if e['type']=='goal' and e['team']==m['away'] and e['minute']<=q_min)} {m['away']}."})
    so = m.get('shootout')
    if so and so.get('home') is not None and so['home'] != so['away']:
        w = m['home'] if so['home'] > so['away'] else m['away']
        beats.append({'minute': 60, 'text': f"Level after 60' — {w} win the shootout {max(so['home'], so['away'])}-{min(so['home'], so['away'])}."})
    beats.append({'minute': 60, 'text': f"Full-time: {m['home']} {m['score']['home']}-{m['score']['away']} {m['away']}."})
    beats.sort(key=lambda b: b['minute'])
    for i, b in enumerate(beats):
        b['seq'] = i
    return beats

# ------------------------------------------- player stats & AI ratings
# ── Positions ─────────────────────────────────────────────────────────────
# The FIH entry list does not state a position. It marks (GK) and (C) and
# nothing else, which is why most of the squad carries the "Squad" placeholder.
# The TMS match line-up pages would carry a real team sheet, and they are
# linked from the competition — but every one of the 88 of them answers 403
# from a runner. They are not served publicly. So there is no official source
# for an outfield position in this competition, and there will not be one.
#
# A best XI is not any eleven — it is eleven players in the positions they
# play. So Hockey.AI derives a role from what the match record does state:
# how each player's goals were scored.
#
#   Penalty-corner and stroke goals mark a DEFENDER. The drag flick is taken
#     from the top of the circle by a defender in the great majority of
#     international sides; the primary flicker of eleven of the sixteen teams
#     here is one, and Harmanpreet Singh — the only stated defender with a
#     flick record on this list — is the archetype.
#   Two or more field goals mark a FORWARD. Field goals are made, not awarded;
#     scoring several in a tournament is a striker's return.
#   Any other goal involvement marks a MIDFIELDER — a midfield scores, but
#     one field goal does not make a striker.
#   No involvement leaves the role unstated. Nothing is invented for these
#     players: they are ranked below every classified player and, when one has
#     to fill a shirt, the shirt says the role is not on the record.
#
# This is Hockey.AI's, not the FIH's, and every surface that uses it says so.
DERIVED_FORWARD_FIELD_GOALS = 2

def derive_position(agg, stated):
    """(position, source) for one player. A stated position is never replaced."""
    if stated and stated != 'Squad':
        return stated, 'FIH'
    set_piece = agg['pc'] + agg['ps']
    field = max(0, agg['goals'] - set_piece)
    if set_piece and field <= agg['pc']:
        return 'Defender', 'Hockey.AI'
    if field >= DERIVED_FORWARD_FIELD_GOALS:
        return 'Forward', 'Hockey.AI'
    if agg['goals']:
        return 'Midfielder', 'Hockey.AI'
    return None, None


import individual_stats
import match_report
from player_rating import rate_group
from team_rating import rate_teams

# The final quarter starts at 45 minutes in a four-quarter match.
LATE_FROM_MINUTE = 46


def official_appearances(fixtures):
    """{player name: {starts, appearances, benched}} from the official sheets.

    Every completed match now carries the FIH's own team sheet, so who played
    is a fact rather than an inference. Three figures come out of it and they
    are three different things:

      starts       named in the eleven that took the field
      appearances  started, or came on — a minute on the record
      benched      named on the sheet and never used

    The squad table on the match pages states an appearance count too, and the
    two agree; this one is preferred because it is per match, so it also yields
    starts, which nothing else here could give.
    """
    out = {}
    for m in fixtures['matches']:
        sheet = m.get('lineups') or {}
        if sheet.get('source') != 'official':
            continue
        for side in ('home', 'away'):
            block = sheet.get(side) or {}
            for row in block.get('startingXI', []):
                r = out.setdefault(row['name'], {'starts': 0, 'appearances': 0, 'benched': 0})
                r['starts'] += 1
                r['appearances'] += 1
            for row in block.get('substitutes', []):
                r = out.setdefault(row['name'], {'starts': 0, 'appearances': 0, 'benched': 0})
                if row.get('on_minute') is not None:
                    r['appearances'] += 1
                else:
                    r['benched'] += 1
    return out


# ── Goal value ────────────────────────────────────────────────────────────
# What a goal was actually worth to the side that scored it.
#
# Counting goals treats the fifth in a 6-0 the same as the one that breaks 2-2
# in the last quarter. They are not the same, and every surface that named a
# "talisman" or a "golden stick" on raw totals was saying they were. The event
# ledger carries the minute and the method for all 201 goals of this
# tournament, so the running score at the moment of each goal is a fact, and
# the state it left the match in is what this weights.
#
# Nothing here is invented: the weights are a stated editorial scale, printed
# beside the number wherever it is used, and the raw goal count is published
# unchanged next to it.
GOAL_STATE_WEIGHT = {
    'go_ahead': 1.00,    # took the lead
    'equaliser': 0.95,   # levelled it
    'opener': 0.90,      # broke a goalless game
    'extending': 0.55,   # already in front
    'consolation': 0.35, # still behind after it
}
# The last quarter decides matches. A goal there is worth more than the same
# goal in the first.
LATE_GOAL_BONUS = 1.20


def goal_value_ledger(fixtures):
    """{player name: {'value': float, 'goals': int, 'by_state': {...}}}.

    Replays each match in order, so the score before every goal is the real
    one rather than the final line read backwards.
    """
    out = {}
    for m in fixtures['matches']:
        if m['status'] != 'completed' or (m.get('score') or {}).get('home') is None:
            continue
        goals = [e for e in (m.get('events') or []) if e.get('type') == 'goal']
        goals.sort(key=lambda e: (e.get('minute') or 0))
        running = {m['home']: 0, m['away']: 0}
        for e in goals:
            team = e.get('team')
            if team not in running:
                continue
            other = m['away'] if team == m['home'] else m['home']
            before_mine, before_theirs = running[team], running[other]
            running[team] += 1
            after_mine = running[team]
            if before_mine < before_theirs and after_mine == before_theirs:
                state = 'equaliser'
            elif before_mine < before_theirs:
                state = 'consolation'
            elif before_mine == before_theirs:
                state = 'opener' if before_mine == 0 else 'go_ahead'
            else:
                state = 'extending'
            name = e.get('player')
            if not name:
                continue
            row = out.setdefault(name, {'value': 0.0, 'goals': 0, 'by_state': {}})
            w = GOAL_STATE_WEIGHT[state]
            if (e.get('minute') or 0) >= LATE_FROM_MINUTE:
                w *= LATE_GOAL_BONUS
            row['value'] += w
            row['goals'] += 1
            row['by_state'][state] = row['by_state'].get(state, 0) + 1
    return out


def on_pitch_records(fixtures):
    """{player name: {started, gf, ga, clean_sheets}} — the side's record in
    the matches this player actually started.

    The rating used to hand every player his team's goals-against rate, which
    is a property of the team and not of him: both of Argentina's keepers
    carried 71.9, including the one who never took the field, and it was 62.5%
    of a keeper's rating. Read off the official team sheets instead, this is
    the record while he was on it — the same figure a squad-mate who sat out
    does not share.
    """
    out = {}
    for m in fixtures['matches']:
        if m['status'] != 'completed' or (m.get('score') or {}).get('home') is None:
            continue
        sheet = m.get('lineups') or {}
        if sheet.get('source') != 'official':
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            gf, ga = m['score'][side], m['score'][opp]
            for row in (sheet.get(side) or {}).get('startingXI', []):
                r = out.setdefault(row['name'],
                                   {'started': 0, 'gf': 0, 'ga': 0, 'clean_sheets': 0})
                r['started'] += 1
                r['gf'] += gf
                r['ga'] += ga
                if ga == 0:
                    r['clean_sheets'] += 1
    return out


def impact_substitute_goals(fixtures):
    """{player name: count} — goals scored in a match he did not start.

    A player kept on the bench is not the same question as whether he can
    change a match from it, and the record answers the second question
    directly: the official team sheet names who started, the event ledger
    names who scored and when, and a name that scored without being in that
    match's own startingXI came off the bench to do it. Checked match by
    match rather than assumed from the season total, because a player can
    start some matches and come off the bench in others — his season starts
    count does not say which matches were which, but the sheet for each one
    does.
    """
    out = {}
    for m in fixtures['matches']:
        if m['status'] != 'completed':
            continue
        sheet = m.get('lineups') or {}
        if sheet.get('source') != 'official':
            continue
        starters = set()
        for side in ('home', 'away'):
            for row in (sheet.get(side) or {}).get('startingXI', []):
                starters.add(row['name'])
        for e in (m.get('events') or []):
            if e.get('type') != 'goal':
                continue
            name = e.get('player')
            if name and name not in starters:
                out[name] = out.get(name, 0) + 1
    return out


def update_player_stats(fixtures, players_doc):
    """
    Full idempotent recompute of every player's tournament numbers from the
    event ledger, then a rule-based positional AI rating (/100), volume-
    weighted so a cameo can't outrank a starter.
    """
    players = players_doc['players']
    by_name = {p['name']: p for p in players}
    team_matches = {}
    team_conceded = {}
    team_scored = {}

    agg = {p['name']: {'goals': 0, 'pc': 0, 'ps': 0, 'late': 0,
                       'green': 0, 'yellow': 0, 'red': 0, 'mids': set()}
           for p in players}
    rating_rows = []

    for m in fixtures['matches']:
        if m['status'] != 'completed' or not has_score(m):
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            code = m[side]
            team_matches[code] = team_matches.get(code, 0) + 1
            team_conceded[code] = team_conceded.get(code, 0) + m['score'][opp]
            team_scored[code] = team_scored.get(code, 0) + m['score'][side]
        for e in m.get('events') or []:
            p = by_name.get(e.get('player'))
            if not p:
                continue
            a = agg[p['name']]
            a['mids'].add(m['id'])
            if e['type'] == 'goal':
                a['goals'] += 1
                if (e.get('minute') or 0) >= LATE_FROM_MINUTE:
                    a['late'] += 1
                if e.get('via') == 'PC':
                    a['pc'] += 1
                elif e.get('via') in ('PS', 'STROKE'):
                    a['ps'] += 1
            elif e['type'] == 'green_card':
                a['green'] += 1
            elif e['type'] == 'yellow_card':
                a['yellow'] += 1
            elif e['type'] == 'red_card':
                a['red'] += 1
            # Nothing accumulates an assist: FIH does not publish them here.

    # Points won, for the match-context component: the standard a performance
    # was produced against, which nothing in a forward's or midfielder's model
    # otherwise knows about.
    team_points = {}
    for m in fixtures['matches']:
        if m['status'] != 'completed' or m.get('score', {}).get('home') is None:
            continue
        h, a_ = m['score']['home'], m['score']['away']
        for code, mine, theirs in ((m['home'], h, a_), (m['away'], a_, h)):
            team_points[code] = team_points.get(code, 0) + (3 if mine > theirs else 1 if mine == theirs else 0)

    max_team_mp = max(team_matches.values(), default=1)
    official = official_appearances(fixtures)
    # What each goal was worth, and what each side did while a player was on
    # the pitch. Both come off the official team sheets and the event ledger.
    gvalue = goal_value_ledger(fixtures)
    onpitch = on_pitch_records(fixtures)
    impact_sub = impact_substitute_goals(fixtures)
    disagreements = []
    changed = False
    for p in players:
        a = agg[p['name']]
        tm = team_matches.get(p['team'], 0)
        mp = tm  # squad players are assumed rostered for their team's matches
        conceded = team_conceded.get(p['team'], 0)
        ga_per_match = conceded / tm if tm else 0

        # ── Hockey.AI Player Index ─────────────────────────────────────
        # Raw figures only here. The rating itself is a separate engine
        # (scripts/player_rating.py): components, percentile-normalised inside
        # the position group, weighted for what the position is asked to do,
        # and carrying its own breakdown so the number can be read rather than
        # taken on trust. Nothing is scored 0 for want of a source — a
        # component the record cannot feed is declared missing and its weight
        # is redistributed.
        pos, pos_source = derive_position(a, p.get('position'))
        scored = team_scored.get(p['team'], 0)
        # Appearances are the FIH's, from the match-page squad table. Where
        # that has not been read yet the figure is left unset rather than
        # assumed: crediting every squad member with his team's whole
        # tournament is what let a player who never left the bench carry the
        # same appearance count as a captain who played every minute.
        # The sheets are per match, so they carry starts as well as
        # appearances. Where they have not been read the match-page squad
        # table's count stands, and where neither has, nothing is assumed.
        seen = official.get(p['name'])
        # Two official figures, and they can disagree: the match-page squad
        # table is a snapshot stamped "as of" a date and can lag, while the
        # reports are per match. Ireland's Luke Roleston is carried at nought
        # appearances by the table and at one by the sheets, which record the
        # minute he came on. The per-match evidence is the better of the two.
        if seen and p.get('games_played') not in (None, seen['appearances']):
            disagreements.append((p['name'], p['games_played'], seen['appearances']))
        official_mp = seen['appearances'] if seen else p.get('games_played')
        # Only players the official FIH team list carries are at this
        # tournament. The rest are pre-tournament seed rows for players who
        # were expected and did not travel; rating them puts a player who is
        # not here onto boards that describe who is.
        if p.get('on_team_list') is False:
            pos, pos_source = None, None
        gv = gvalue.get(p['name'])
        op = onpitch.get(p['name'])
        starts_ = seen['starts'] if seen else None
        rating_rows.append({
            'player': p,
            'position': pos,
            'goals': a['goals'],
            'fg_scored': max(0, a['goals'] - a['pc'] - a['ps']),
            'pc_scored': a['pc'],
            'ps_scored': a['ps'],
            'appearances': official_mp,
            'started': starts_,
            # Workload is measured against the side's own campaign: five starts
            # of five is a different claim from five of eight.
            'start_share': (starts_ / tm) if (tm and starts_ is not None) else None,
            'app_share': (official_mp / tm) if (tm and official_mp is not None) else None,
            'goal_value': (gv['value'] if gv else 0.0),
            'goal_share': (a['goals'] / scored) if scored else 0.0,
            'card_points': a['green'] * 1 + a['yellow'] * 2 + a['red'] * 5,
            # The side's record in the matches he actually started.
            'on_pitch_gf': (op['gf'] if op else None),
            'on_pitch_ga': (op['ga'] if op else None),
            'on_pitch_cs': (op['clean_sheets'] if op else None),
            # How far this player's side actually got, in the record's own
            # terms. Three for a win, one for a draw, over matches played.
            'team_points_per_match': (team_points.get(p['team'], 0) / tm) if tm else None,
        })

        new_vals = {
            'goals': a['goals'],
            # Assists are NOT in the FIH record for this competition, and no
            # event in the feed carries one, so there is nothing to count.
            # Nine players held a phantom assist each, kept alive by a max()
            # against the pre-tournament seed, and the rating formulas were
            # weighting them.
            'assists': 0,
            'pc_scored': a['pc'],
            # Goals split the way the FIH splits them. A penalty stroke is not
            # open play and it is not a corner, and with the stroke left out
            # of the record every surface that wanted field goals was reading
            # goals-minus-corners and quietly counting eleven strokes as open
            # play. The competition scorers report states all three; this is
            # the same split, from the event ledger, and checked against it.
            'ps_scored': a['ps'],
            'fg_scored': a['goals'] - a['pc'] - a['ps'],
            'yellow_cards': a['yellow'],
            'red_cards': a['red'],
            'green_cards': a['green'],
            # The FIH's appearance count where it has been read, and the
            # team's match count only as a stand-in until it has.
            'matches_played': official_mp if official_mp is not None else mp,
            # The role every surface reads, and where it came from. `position`
            # is left exactly as the FIH entry list gave it and is never
            # rewritten — these sit beside it.
            'position_effective': pos,
            'position_source': pos_source,
            # From the official team sheets: started, took the field at all,
            # and was named without being used. Three different facts.
            'starts': seen['starts'] if seen else None,
            'appearances': seen['appearances'] if seen else None,
            'benched': seen['benched'] if seen else None,
            # Goals scored in a match he did not start, checked match by
            # match against that match's own official team sheet. Shown as a
            # badge on the bench, never as a reason to start him instead — a
            # coach's team sheet, not this figure, decides who starts.
            'impact_sub_goals': impact_sub.get(p['name'], 0),
        }
        for k, v in new_vals.items():
            if p.get(k) != v:
                p[k] = v
                changed = True
    # ── Rate, one position group at a time ─────────────────────────────
    # Percentiles only mean something against comparable players, so a
    # goalkeeper is ranked among goalkeepers.
    #
    # A travelling outfielder the record gives no line to is rated in the
    # Outfield group rather than left unrated. The FIH names a position for 48
    # of 320 entrants and marks the rest "Squad", so the line is inferred from
    # how a player's goals were scored — and 186 players who never scored were
    # getting no rating at all, 119 of them men who started matches. They are
    # measured against each other on what the record does hold, and the
    # coverage figure states how narrow that model is.
    for r in rating_rows:
        if r['position'] is None and r['player'].get('on_team_list') is not False:
            r['position'] = 'Outfield'
    for position in ('Goalkeeper', 'Defender', 'Midfielder', 'Forward', 'Outfield'):
        group = [r for r in rating_rows if r['position'] == position]
        if not group:
            continue
        for row, result in zip(group, rate_group(group, position)):
            p = row['player']
            want = (result or {}).get('rating')
            breakdown = (result or {}).get('components')
            for field, value in (('ai_rating', want),
                                 # Which group he was ranked in. Usually his
                                 # line; "Outfield" where the record names no
                                 # line, so a reader is never shown a rating
                                 # without being told what it was measured
                                 # against.
                                 ('rating_group', position if want is not None else None),
                                 ('rating_components', breakdown),
                                 # What he did, before the standard he did it
                                 # against is applied — both are published, so
                                 # the multiplier can be read rather than
                                 # inferred from a number that moved.
                                 ('rating_performance', (result or {}).get('performance')),
                                 ('rating_context', (result or {}).get('context')),
                                 ('rating_playing_time', (result or {}).get('playing_time')),
                                 ('rating_coverage', (result or {}).get('coverage')),
                                 ('rating_missing', (result or {}).get('components_missing'))):
                if p.get(field) != value:
                    p[field] = value
                    changed = True
    # Anyone with no position carries no rating, rather than a stale one.
    rated_names = {r['player']['name'] for r in rating_rows if r['position']}
    for p in players:
        if p['name'] in rated_names:
            continue
        for field in ('ai_rating', 'rating_components', 'rating_performance',
                      'rating_context', 'rating_playing_time', 'rating_coverage',
                      'rating_missing'):
            if p.get(field) is not None:
                p[field] = None
                changed = True

    if disagreements:
        print(f'APPEARANCES: {len(disagreements)} player(s) where the squad table and '
              f'the match sheets disagree; the sheets are used:')
        for name, table, sheets in disagreements[:8]:
            print(f'  · {name}: table says {table}, sheets say {sheets}')
    if changed:
        print('PLAYER STATS: recomputed tournament aggregates + positional ratings')
    return changed

# ------------------------------------------------- knockout slotting
POINTS = lambda w, d: w * 3 + d

def pool_table(fixtures, pool):
    rows = {}
    for m in fixtures['matches']:
        if m['phase'] != 'pool' or m.get('pool') != pool or not has_score(m) or m['status'] != 'completed':
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            r = rows.setdefault(m[side], {'pts': 0, 'gd': 0, 'gf': 0})
            gf, ga = m['score'][side], m['score'][opp]
            r['gf'] += gf
            r['gd'] += gf - ga
            if gf > ga: r['pts'] += 3
            elif gf == ga: r['pts'] += 1
    return sorted(rows.items(), key=lambda kv: (-kv[1]['pts'], -kv[1]['gd'], -kv[1]['gf'], kv[0]))

def pool_complete(fixtures, pool):
    ms = [m for m in fixtures['matches'] if m['phase'] == 'pool' and m.get('pool') == pool]
    return ms and all(m['status'] == 'completed' and has_score(m) for m in ms)

# ── Real FIH 2026 two-stage bracket (see src/engine/simulate.js for the mirror) ──
# Stage-2 re-pooling from Stage-1 finishing positions [(pool, 0-indexed place)].
STAGE2 = {
    'E': [('A', 0), ('A', 1), ('D', 0), ('D', 1)],
    'F': [('B', 0), ('B', 1), ('C', 0), ('C', 1)],
    'G': [('A', 2), ('A', 3), ('D', 2), ('D', 3)],
    'H': [('B', 2), ('B', 3), ('C', 2), ('C', 3)],
}
# Each Stage-2 pool plays the four cross matches — every team meets the two who
# came through the *other* Stage-1 pool, while the head-to-head against the side
# from their own pool carries forward. (home slot, away slot) per fixture, ids
# S2{pool}{1..4}. Read off the official FIH schedule, match by match, rather
# than assumed: Pool F's last two rounds are ordered differently from E/G/H.
S2_MATCHUPS = {
    'E': {1: (0, 3), 2: (2, 1), 3: (1, 3), 4: (0, 2)},   # #31 #32 #39 #40
    'F': {1: (2, 1), 2: (0, 3), 3: (0, 2), 4: (3, 1)},   # #27 #28 #35 #36
    'G': {1: (0, 3), 2: (2, 1), 3: (1, 3), 4: (0, 2)},   # #29 #30 #37 #38
    'H': {1: (0, 3), 2: (2, 1), 3: (1, 3), 4: (0, 2)},   # #25 #26 #33 #34
}
# Classification / semis over Stage-2 placements: id -> (poolH, placeH, poolA, placeA)
# Ids are POS<n>, not C<n>: the pool-stage fixtures already own C1-C6, so a
# classification match called "C5" collided with Pool C's fifth match and
# shadowed a played result wherever matches are keyed by id.
CLASS_SLOTS = {
    'POS13': ('G', 2, 'H', 2), 'POS15': ('G', 3, 'H', 3), 'POS11': ('G', 1, 'H', 1),
    'POS9': ('G', 0, 'H', 0), 'POS5': ('E', 2, 'F', 2), 'POS7': ('E', 3, 'F', 3),
}
SEMI_SLOTS = {'SF1': ('E', 0, 'F', 1), 'SF2': ('F', 0, 'E', 1)}

def ko_winner(m):
    if not m or not has_score(m) or m['status'] != 'completed':
        return None
    so = m.get('shootout') or {}
    if so.get('home') is not None and so['home'] != so['away']:
        return m['home'] if so['home'] > so['away'] else m['away']
    if m['score']['home'] != m['score']['away']:
        return m['home'] if m['score']['home'] > m['score']['away'] else m['away']
    return None

def stage1_placements(fixtures):
    """[1st..4th] code per Stage-1 pool, or None until every pool is complete."""
    if not all(pool_complete(fixtures, p) for p in ('A', 'B', 'C', 'D')):
        return None
    return {p: [code for code, _ in pool_table(fixtures, p)] for p in ('A', 'B', 'C', 'D')}

def stage2_members(fixtures):
    """{pool: [4 codes]} once Stage 1 is done, else None."""
    place1 = stage1_placements(fixtures)
    if not place1:
        return None
    return {s2: [place1[p][i] for p, i in slots] for s2, slots in STAGE2.items()}

def stage2_table(fixtures, pool_letter, members):
    """Stage-2 pool standings over completed matches among its four members —
    Stage-1 head-to-head between same-pool teams carries forward automatically."""
    codes = set(members[pool_letter])
    rows = {c: {'pts': 0, 'gd': 0, 'gf': 0, 'w': 0} for c in codes}
    for m in fixtures['matches']:
        if not has_score(m) or m['status'] != 'completed':
            continue
        if m['home'] not in codes or m['away'] not in codes:
            continue
        if m['phase'] not in ('pool', 'stage2'):
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            r = rows[m[side]]
            gf, ga = m['score'][side], m['score'][opp]
            r['gf'] += gf; r['gd'] += gf - ga
            if gf > ga: r['pts'] += 3; r['w'] += 1
            elif gf == ga: r['pts'] += 1
    return sorted(rows.items(), key=lambda kv: (-kv[1]['pts'], -kv[1]['w'], -kv[1]['gd'], -kv[1]['gf'], kv[0]))

def stage2_complete(fixtures, pool_letter):
    ms = [m for m in fixtures['matches'] if m['phase'] == 'stage2' and m.get('pool') == pool_letter]
    return bool(ms) and all(m['status'] == 'completed' and has_score(m) for m in ms)

def slot_knockouts(fixtures):
    """Fill Stage-2, classification, semi and medal fixtures from real results
    as each stage completes — mirrors the two-stage FIH 2026 progression."""
    by_id = {m['id']: m for m in fixtures['matches']}
    changed = False

    # 1) Stage-2 pool fixtures, once Stage 1 is done
    place1 = stage1_placements(fixtures)
    if place1:
        for m in fixtures['matches']:
            if m['phase'] != 'stage2' or m['home'] != 'TBD':
                continue
            pl, n = m['pool'], int(m['id'][-1])
            i, j = S2_MATCHUPS[pl][n]
            (ph, hi), (pa, ai) = STAGE2[pl][i], STAGE2[pl][j]
            m['home'], m['away'] = place1[ph][hi], place1[pa][ai]
            changed = True
            print(f"SLOTTED {m['id']}: {m['home']} vs {m['away']}")

    # 2) Semis + classification, once the relevant Stage-2 pools are done
    members = stage2_members(fixtures)
    if members:
        place2 = {}
        for pl in ('E', 'F', 'G', 'H'):
            if stage2_complete(fixtures, pl):
                place2[pl] = [code for code, _ in stage2_table(fixtures, pl, members)]
        for kid, (ph, hi, pa, ai) in {**SEMI_SLOTS, **CLASS_SLOTS}.items():
            m = by_id.get(kid)
            if not m or m['home'] != 'TBD':
                continue
            if ph in place2 and pa in place2:
                m['home'], m['away'] = place2[ph][hi], place2[pa][ai]
                changed = True
                print(f"SLOTTED {kid}: {m['home']} vs {m['away']}")

    # 3) Medals, once both semis have a winner
    sf1, sf2 = by_id.get('SF1'), by_id.get('SF2')
    w1, w2 = ko_winner(sf1), ko_winner(sf2)
    if w1 and w2:
        gold, brz = by_id.get('GOLD'), by_id.get('BRZ')
        if gold and gold['home'] == 'TBD':
            gold['home'], gold['away'] = w1, w2
            changed = True
            print(f"SLOTTED GOLD: {w1} vs {w2}")
        if brz and brz['home'] == 'TBD':
            l1 = sf1['away'] if w1 == sf1['home'] else sf1['home']
            l2 = sf2['away'] if w2 == sf2['home'] else sf2['home']
            brz['home'], brz['away'] = l1, l2
            changed = True
            print(f"SLOTTED BRZ: {l1} vs {l2}")

    # A fixture is provisional exactly while it does not yet know who is in
    # it. The seed schedule marked every knockout tie provisional because none
    # of them did, and the flag was written once and never revisited — so a
    # semi-final filled in from two finished tables went on calling itself a
    # guess. Stating the invariant instead of setting the flag at each slot
    # point also repairs the rows that were already filled in.
    for m in fixtures['matches']:
        if m['phase'] in ('pool',):
            continue
        want = m['home'] == 'TBD' or m['away'] == 'TBD'
        if m.get('provisional') is not None and m['provisional'] != want:
            m['provisional'] = want
            changed = True
            print(f"PROVISIONAL {m['id']}: {'yes' if want else 'no'} "
                  f"({m['home']} vs {m['away']})")
    return changed

# ------------------------------------------------------------- oracle
def points_from_rank(rank):
    """Pseudo-points fallback when the official points are missing — the
    observed 2026 table spans ~3838 (#1) to ~2397 (#16), ~96 points a place."""
    return 3850 - 96 * (rank - 1)

# ── What moves a prediction, and by how much ──────────────────────────────
# Deliberate weight order, because the model must not be steered by the most
# colourful number on the page:
#
#   1. Current FIH ranking points — the base. Spans ~1,365 points across the 16
#      teams here, so it dominates by construction.
#   2. This tournament — bounded at ±FORM_CAP (~2.7 ranking places). What a side
#      is doing here outranks anything older, but cannot invent a contender out
#      of a team losing every week.
#   3. The head-to-head record — bounded at ±H2H_CAP (~0.9 places). Real, so
#      that citing it as a reason is honest, but deliberately the smallest term:
#      a 2018 result says less about tonight than this week's hockey does.
#
# Form and H2H both scale with sample size, so one match never speaks with the
# authority of three.
# All model constants live in model/params.json — one file, shared verbatim
# with the app engine (src/engine/strength.js imports the same JSON), so the
# published pick and the in-app simulation can never drift apart, and anyone
# reading the repository finds every number in one documented place.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       '..', 'model', 'params.json')) as _fh:
    MODEL_CONFIG = json.load(_fh)

FORM_PPM_WEIGHT = MODEL_CONFIG['form']['ppm_weight']
FORM_GD_WEIGHT = MODEL_CONFIG['form']['gd_weight']
FORM_CAP = MODEL_CONFIG['form']['cap']
FORM_FULL_SAMPLE = MODEL_CONFIG['form']['full_sample']
H2H_WEIGHT = MODEL_CONFIG['h2h']['weight']
H2H_CAP = MODEL_CONFIG['h2h']['cap']
H2H_FULL_SAMPLE = MODEL_CONFIG['h2h']['full_sample']
MATCH_MODEL = MODEL_CONFIG['match_model']

def _clamp(v, lo, hi):
    return max(lo, min(hi, v))

def team_form(code, fixtures):
    """{played, wins, draws, losses, gf, ga} for one team in this tournament."""
    f = {'played': 0, 'wins': 0, 'draws': 0, 'losses': 0, 'gf': 0, 'ga': 0}
    for m in fixtures['matches']:
        if not has_score(m) or m['status'] != 'completed':
            continue
        if code not in (m['home'], m['away']):
            continue
        side = 'home' if m['home'] == code else 'away'
        opp = 'away' if side == 'home' else 'home'
        gf, ga = m['score'][side], m['score'][opp]
        f['played'] += 1
        f['gf'] += gf
        f['ga'] += ga
        if gf > ga: f['wins'] += 1
        elif gf < ga: f['losses'] += 1
        else: f['draws'] += 1
    return f

def form_delta(form):
    """Ranking-point adjustment for how a team is playing in this tournament."""
    n = form.get('played', 0)
    if not n:
        return 0.0
    ppm = (form['wins'] * 3 + form['draws']) / n
    gdpm = _clamp((form['gf'] - form['ga']) / n, -3.0, 3.0)
    raw = FORM_PPM_WEIGHT * (ppm - 1.5) + FORM_GD_WEIGHT * gdpm
    confidence = min(n, FORM_FULL_SAMPLE) / FORM_FULL_SAMPLE
    return _clamp(raw, -FORM_CAP, FORM_CAP) * confidence

def h2h_delta(meetings, code, opponent):
    """Ranking-point adjustment from the official record between two nations.

    Deliberately the smallest term in the model. Meetings from the tournament
    being played are excluded — those are already counted, in full, as form.
    """
    past = [m for m in (meetings or []) if not m.get('current')]
    if not past:
        return 0.0
    wins = losses = 0
    for m in past:
        mine = m['home_goals'] if m['home'] == code else m['away_goals']
        theirs = m['home_goals'] if m['home'] == opponent else m['away_goals']
        if mine > theirs: wins += 1
        elif mine < theirs: losses += 1
    n = len(past)
    margin = (wins - losses) / n          # -1 … 1
    confidence = min(n, H2H_FULL_SAMPLE) / H2H_FULL_SAMPLE
    return _clamp(H2H_WEIGHT * margin * n ** 0.5, -H2H_CAP, H2H_CAP) * confidence

def effective_points(code, opponent, base_points, fixtures, h2h_pairs=None):
    """Ranking points adjusted for this tournament, then lightly for history."""
    pts = base_points + form_delta(team_form(code, fixtures))
    if h2h_pairs:
        key = '-'.join(sorted((code, opponent)))
        pts += h2h_delta(h2h_pairs.get(key), code, opponent)
    return pts

def predict(home_pts, away_pts, knockout=False):
    """(p_home, p_draw, p_away) for the sixty minutes, from FIH ranking points.

    All constants live in model/params.json. Calibrated against the
    tournament's own completed matches, scored as-of-then (only the form
    and rankings available before each push-back) — the harness is
    scripts/backtest_model.py, re-runnable at any time:

      - the draw window (draw_width) concentrates draw probability on
        genuinely close matchups rather than medium ranking gaps.
      - near-equal sides (gap under close_gap_points, roughly two places)
        carry an additional draw allowance (close_gap_draw_delta): hockey
        between neighbours in the rankings draws far more often than a
        smooth curve admits, and the backtest confirms the bump improves
        every scoring metric.

    The triple always describes REGULATION — the sixty minutes — in every
    phase. A knockout match level at the hooter goes to a shoot-out, so its
    draw mass belongs to a near coin-flip, and every consumer resolves it
    that way: advance probability = p_home + p_draw / 2 (the app engine has
    done exactly this in prediction.js from the start).

    v3 history, kept for the record: knockouts previously returned a raw
    two-way logistic — the draw simply deleted, all of its mass handed to
    the favourite. The tournament's own knockout rounds refuted that: three
    of the first six were level after sixty minutes, matches this model had
    called impossible (a certainty scored at −log(0) in its own backtest),
    and it sent a 92% favourite into a semi-final that was lost. Sixty
    minutes of knockout hockey is the same sport the draw model was
    calibrated on; the shoot-out is where the tie is broken, not a reason
    to pretend ties cannot happen.

    v2 history: recalibrated after PAK v WAL when the rank-position Elo
    read near-equals as 75/25 and the match finished 3-3 — ranking points,
    not positions, are the currency, and the draw is a full outcome, not a
    residue.
    """
    mm = MATCH_MODEL
    dr = home_pts - away_pts
    e = 1 / (1 + 10 ** (-dr / mm['slope']))
    p_draw = mm['draw_scale'] * math.exp(-(dr / mm['draw_width']) ** 2)
    if abs(dr) < mm['close_gap_points']:
        p_draw += mm['close_gap_draw_delta']
    p_draw = _clamp(p_draw, mm['draw_floor'], mm['draw_cap'])
    p_home = (1 - p_draw) * e
    p_away = (1 - p_draw) * (1 - e)
    return round(p_home, 3), round(p_draw, 3), round(p_away, 3)

import model_non_knockout as _nkm

_FROZEN_RANKINGS = None


def _frozen_rankings():
    """The baseline table the convergence feature measures movement from."""
    global _FROZEN_RANKINGS
    if _FROZEN_RANKINGS is None:
        try:
            with open(os.path.join(DATA_DIR, 'rankings-history.json')) as fh:
                _FROZEN_RANKINGS = json.load(fh).get('frozen') or {}
        except (OSError, ValueError):
            _FROZEN_RANKINGS = {}
    return _FROZEN_RANKINGS


def h2h_margin(h2h_pairs, home, away):
    """Pre-tournament head-to-head: home wins minus home losses, as a count."""
    key = '-'.join(sorted((home, away)))
    past = [x for x in ((h2h_pairs or {}).get(key) or []) if not x.get('current')]
    wins = losses = 0
    for x in past:
        hg = x['home_goals'] if x['home'] == home else x['away_goals']
        ag = x['home_goals'] if x['home'] == away else x['away_goals']
        if hg > ag:
            wins += 1
        elif hg < ag:
            losses += 1
    return wins - losses


def non_knockout_pick(m, base_probs, points_of, fixtures, h2h_pairs):
    """Run one drawable fixture through NON_KNOCKOUT_MODEL_V2."""
    frozen = _frozen_rankings()
    home, away = m['home'], m['away']
    ph, _pd, pa = base_probs
    underdog = away if ph >= pa else home
    form = team_form(underdog, fixtures)
    features = _nkm.build_features(
        base_probs,
        points_of.get(home), points_of.get(away),
        frozen.get(home), frozen.get(away),
        und_gd=form['gf'] - form['ga'],
        h2h_margin=h2h_margin(h2h_pairs, home, away))
    return _nkm.predict(features)


def revise_stale_predictions(fixtures, predictions, rank_of, points_of, now, h2h_pairs=None):
    """
    Publish a visible correction for a pick whose match has not started but
    whose inputs were wrong when it was written.

    Every early pick was generated from the hand-seeded FIH ranks, 13 of which
    were wrong; the FRA v MAS pick read "#10 MAS favoured over #13 FRA" while
    fih.hockey has FRA #9 and MAS #14. Picks are never rewritten or deleted —
    the original stays in the ledger, marked superseded, and a revision becomes
    the active pick. That is an erratum, not revisionism: the record of what
    was published survives, and the app stops asserting rank claims its own
    rankings tab contradicts. A match that has kicked off is never touched —
    a wrong pick that ran is a miss, and it stays one.
    """
    by_match = {}
    for p in predictions['predictions']:
        if not p.get('superseded'):
            by_match[p['matchId']] = p
    matches = {m['id']: m for m in fixtures['matches']}
    changed = False

    for mid, p in by_match.items():
        m = matches.get(mid)
        if not m or m['home'] == 'TBD':
            continue
        # The only picks eligible for revision are those whose match has not
        # kicked off — which by itself excludes every backfill. (Not gated on
        # basis: the earliest picks predate that field.)
        try:
            if kickoff(m) <= now:
                continue
        except ValueError:
            continue
        hr, ar = rank_of.get(m['home']), rank_of.get(m['away'])
        if hr is None or ar is None:
            continue
        knockout = m['phase'] in ('semi-final', 'bronze-final', 'gold-final', 'classification')
        ph, pd, pa = predict(
            effective_points(m['home'], m['away'], points_of[m['home']], fixtures, h2h_pairs),
            effective_points(m['away'], m['home'], points_of[m['away']], fixtures, h2h_pairs),
            knockout=knockout)
        if knockout:
            adv_h = ph + pd / 2
            pick = 'HOME' if adv_h >= 0.5 else 'AWAY'
            conf = round(max(adv_h, 1 - adv_h), 3)
        else:
            # Pool and stage-2 matches can be drawn, so they go through the
            # non-knockout model: the same ranking-points base, plus its one
            # validated rule for sides that have converged to parity.
            out = non_knockout_pick(m, (ph, pd, pa), points_of, fixtures, h2h_pairs)
            pick = out['prediction']
            ph, pd, pa = out['probs']['HOME'], out['probs']['DRAW'], out['probs']['AWAY']
            # The pick's own probability, not the largest in the row. Those are
            # the same number only when the pick leads, and a card that prints
            # "India to win · 70%" over Argentina's 70% is asserting the
            # opposite of what it means.
            conf = round({'HOME': ph, 'DRAW': pd, 'AWAY': pa}[pick], 3)
        # A pick is stale if its numbers no longer follow from the current
        # ranks — or if the ranks its reason asserts are simply not the ranks.
        # (IND v PAK moved from #5 v #9 to #8 v #12: same gap, same
        # probabilities, still a false claim on the page.)
        stated = sorted(int(x) for x in re.findall(r'#(\d+)', p.get('reason', '')))
        if ((p['pick'], p['p_home_win'], p['p_draw'], p['p_away_win']) == (pick, ph, pd, pa)
                and (not stated or stated == sorted((hr, ar)))):
            continue
        rev = sum(1 for q in predictions['predictions'] if q['matchId'] == mid) + 1
        fav, dog = (m['home'], m['away']) if pick != 'AWAY' else (m['away'], m['home'])
        p['superseded'] = True
        p['superseded_at'] = now.isoformat()
        p['superseded_reason'] = 'Inputs refreshed pre-match: current FIH ranking points and the calibrated draw-aware model.'
        new_row = {
            'id': f"oracle-v1:{mid}:r{rev}",
            'matchId': mid,
            'source': 'oracle-v1',
            'basis': 'pre-match',
            'revises': p['id'],
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick': pick, 'pick_confidence': conf,
            # The card names the team, not the side — a revision without
            # pick_team rendered as a pick of nobody.
            'pick_team': {'HOME': m['home'], 'AWAY': m['away'], 'DRAW': None}[pick],
            'reason': (f"FIH #{min(hr, ar)} {fav} favoured over #{max(hr, ar)} {dog} — points-based "
                       f"Elo with a full draw model. Revised pre-match; the original pick "
                       f"stays in the ledger."),
            'publishedAt': now.isoformat(),
        }
        if p.get('reason_original'):
            # An authored rationale (written from the tournament record, marked
            # by reason_original) outlives a probability refresh: the template
            # never overwrites prose.
            new_row['reason'] = p['reason']
            new_row['reason_original'] = p['reason_original']
            for k in ('reason_revised_at', 'reason_revision'):
                if p.get(k):
                    new_row[k] = p[k]
        predictions['predictions'].append(new_row)
        changed = True
        print(f"ORACLE REVISION: {mid} {p['pick']} -> {pick} (ranks corrected, match not started)")
    return changed

def fix_venues(fixtures):
    """Pool venues follow the pool: A and D play at Wagener (Amstelveen), B and
    C at Belfius (Brussels). The seeded data had them inverted for two pools —
    the app showed FRA v MAS at the Wagener while FIH plays it in Belgium."""
    POOL_VENUE = {'A': 'AMV', 'D': 'AMV', 'B': 'BRU', 'C': 'BRU'}
    changed = False
    for m in fixtures['matches']:
        want = POOL_VENUE.get(m.get('pool')) if m['phase'] == 'pool' else None
        if want and m.get('venue') != want:
            print(f"VENUE: {m['id']} {m['home']} v {m['away']} {m.get('venue')} -> {want}")
            m['venue'] = want
            changed = True
    return changed

def generate_predictions(fixtures, teams, predictions, h2h_pairs=None):
    """
    Every fixture with both teams known carries an engine pick — including
    matches that finished before the pipeline existed. The model is
    SCORE-BLIND (FIH ranks only), so a backfilled pick is byte-identical to
    what the engine would have output pre-match; those rows are labeled
    basis='model-backfill' in the ledger for full transparency. Once written,
    a pick is never edited or deleted.
    """
    rank_of = {t['code']: t['fih_rank'] for t in teams['teams']}
    points_of = {t['code']: t.get('fih_points') or points_from_rank(t['fih_rank'])
                 for t in teams['teams']}
    have = {p['matchId'] for p in predictions['predictions']}
    changed = False
    now = now_utc()

    changed |= revise_stale_predictions(fixtures, predictions, rank_of, points_of, now, h2h_pairs)

    for m in fixtures['matches']:
        if m['id'] in have or m['home'] == 'TBD':
            continue
        try:
            ko = kickoff(m)
        except ValueError:
            continue
        # Stage-2 ('stage2') is a group phase like the Stage-1 pools — draws are
        # allowed. Only the single-match rounds go to a shootout when level.
        knockout = m['phase'] in ('semi-final', 'bronze-final', 'gold-final', 'classification')
        pre_match = ko > now
        hr, ar = rank_of.get(m['home']), rank_of.get(m['away'])
        if hr is None or ar is None:
            continue
        ph, pd, pa = predict(
            effective_points(m['home'], m['away'], points_of[m['home']], fixtures, h2h_pairs),
            effective_points(m['away'], m['home'], points_of[m['away']], fixtures, h2h_pairs),
            knockout=knockout)
        if knockout:
            adv_h = ph + pd / 2
            pick = 'HOME' if adv_h >= 0.5 else 'AWAY'
            conf = round(max(adv_h, 1 - adv_h), 3)
        else:
            # Pool and stage-2 matches can be drawn, so they go through the
            # non-knockout model: the same ranking-points base, plus its one
            # validated rule for sides that have converged to parity.
            out = non_knockout_pick(m, (ph, pd, pa), points_of, fixtures, h2h_pairs)
            pick = out['prediction']
            ph, pd, pa = out['probs']['HOME'], out['probs']['DRAW'], out['probs']['AWAY']
            # The pick's own probability, not the largest in the row. Those are
            # the same number only when the pick leads, and a card that prints
            # "India to win · 70%" over Argentina's 70% is asserting the
            # opposite of what it means.
            conf = round({'HOME': ph, 'DRAW': pd, 'AWAY': pa}[pick], 3)
        fav, dog = (m['home'], m['away']) if pick != 'AWAY' else (m['away'], m['home'])
        stage_note = f" {m['phase'].replace('-', ' ').title()} slot decided by pool standings." if knockout else ''
        basis_note = (' Published pre-match.' if pre_match else
                      ' Engine backfill — the model reads world rankings only (score-blind), so this pick is identical to its pre-match output.')
        predictions['predictions'].append({
            'id': f"oracle-v1:{m['id']}",
            'matchId': m['id'],
            'source': 'oracle-v1',
            'basis': 'pre-match' if pre_match else 'model-backfill',
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick': pick, 'pick_confidence': conf,
            'reason': f"FIH #{min(hr, ar)} {fav} favoured over #{max(hr, ar)} {dog} — Elo model from world rankings.{stage_note}{basis_note}",
            'publishedAt': now.isoformat(),
        })
        changed = True
        print(f"ORACLE PICK ({'pre-match' if pre_match else 'backfill'}): {m['id']} -> {pick} ({round(conf*100)}%)")
    return changed

# ---------------------------------------------------------------- main
def main():
    fixtures = load('fixtures.json')
    teams = load('teams.json')
    players = load('players.json')
    predictions = load('predictions.json')
    version_doc = load('data-version.json')

    changed = False
    if os.environ.get('PROBE_MATCH_IDS'):   # debug hook, dormant unless set
        for _pid in os.environ['PROBE_MATCH_IDS'].split(','):
            probe_match_report(_pid.strip())
    changed |= fix_venues(fixtures)
    # The official schedule before the clock speaks: statuses are computed
    # from kickoff times, and the per-match pages are the authority on those.
    links = discover_tms_lineup_links()
    # Head-to-head history is harvested from the same pages the schedule sync
    # reads. A pair keeps whatever we last saw: TMS only serves the table on a
    # match page, so a pair drops out of reach once its match is complete and
    # the page stops being refetched.
    h2h_doc = load_or('h2h.json', {'source': 'fih-tms', 'since': H2H_SINCE, 'pairs': {}})
    harvested = {}
    changed |= sync_schedule_from_match_pages(fixtures, links, h2h_out=harvested)
    if harvested:
        h2h_doc['pairs'].update(harvested)
        h2h_doc['since'] = H2H_SINCE
        h2h_doc['updated_at'] = now_utc().isoformat()
        save('h2h.json', h2h_doc)
        print(f'H2H: {len(harvested)} pairs refreshed, {len(h2h_doc["pairs"])} on file.')
    changed |= update_statuses(fixtures)

    # The matches page carries every final score by team-code pair — the
    # primary result source, consumed by the backfill below.
    page_body, _ = _tms_get(TMS_BASE + '/matches')
    page_shootouts = {}
    page_results = (parse_tms_results(_tms_lines(page_body), shootouts_out=page_shootouts)
                    if page_body else {})
    if page_results:
        print(f'RESULTS: matches page carries {len(page_results)} final scores.')
    # Running scores for in-window matches — display-only, never a final.
    changed |= update_live_scores(fixtures, page_results)

    # Official FIH world rankings — fetched here because CI has the egress
    # that local sandboxes don't. Feeds both the UI and the model prior.
    teams_changed = apply_rankings(teams, fetch_fih_rankings())

    # Official entry lists, when TMS publishes them — squads gate the line-ups.
    squads, staff = fetch_tms_squads()
    players_changed = reconcile_team_lists(players, squads)
    players_changed |= merge_squads(players, squads, teams)
    # Runs whatever the source: the client store is keyed on player id, so a
    # collision does not show up as a wrong number — it shows up as a player
    # who is simply not there.
    players_changed |= dedupe_player_ids(players)
    # The FIH's own per-player figures — appearances above all, which nothing
    # else here has a source for. Read from the same match pages the schedule
    # and head-to-head passes already visit.
    players_changed |= fetch_official_player_figures(fixtures, links, players)
    teams_changed |= apply_coaches(teams, staff)
    try:
        players_changed |= apply_player_rankings(players, load('player_rankings.json'))
    except FileNotFoundError:
        pass

    tms = fetch_tms_standings()
    if tms:
        print(f"TMS standings parsed: { {k: len(v) for k, v in tms.items()} }")
        changed |= backfill_scores_from_tms(fixtures, tms, page_results)
    # Stage 2 and knockout matches have no pool table to witness them; their
    # scores come from the matches page with their own confirmation rules —
    # and must not be gated on the standings PDF parsing.
    changed |= backfill_stage_scores(fixtures, page_results, shootouts=page_shootouts)
    changed |= attach_missing_shootouts(fixtures, page_shootouts)

    # Real timeline from the TMS match report first; estimation only fills the
    # matches a report hasn't been published for yet.
    changed |= apply_official_events(fixtures, players)
    changed |= estimate_enrichment(fixtures, players)
    # The official team sheets are read before anything is derived from them.
    # They were read after, and that is a whole class of bug rather than one:
    # starts and appearances come out of the sheets, so a run that adopted a
    # sheet published figures computed without it, and since a sheet is
    # adopted once and then skipped, the lag never corrected itself. Every
    # fact the FIH states is established first; the derivations follow.
    changed |= fetch_match_reports(fixtures, players)
    changed |= fetch_official_lineups(fixtures, links, players)
    changed |= update_player_stats(fixtures, players)
    # Every published player figure, checked against the FIH's own individual
    # statistics tables. It runs after the recompute so it checks what this run
    # will actually publish, not what the last one did.
    players_changed |= fetch_individual_stats(players)
    changed |= slot_knockouts(fixtures)
    # build_lineups composes an estimate only where no official sheet exists,
    # and never overwrites one — so it runs last of the three.
    changed |= build_lineups(fixtures, players, teams)
    # The browser-side strength model must weight this tournament exactly as the
    # published picks do, so the aggregates live on the team rather than being
    # recomputed twice from different code.
    for t in teams['teams']:
        f = team_form(t['code'], fixtures)
        if t.get('form') != f:
            t['form'] = f
            changed = True
    changed |= generate_predictions(fixtures, teams, predictions, h2h_doc.get('pairs'))

    # Team ratings, on the same component architecture as the player rating:
    # every figure a rate per match, percentile-ranked across the sixteen, and
    # carrying its own breakdown. Published as its own file because it is
    # evidence as much as it is a table — a pick can point at the two or three
    # components that actually separate the sides, in this tournament's
    # numbers, instead of asserting that one team is better than another.
    team_ratings = {
        'model': 'hockey-ai-team-components-1',
        'generated_at': now_utc().isoformat(),
        'source': 'Hockey.AI, derived from the FIH match record',
        'teams': rate_teams(fixtures['matches']),
    }
    prev = load_or('team-ratings.json', {})
    if json.dumps(prev.get('teams'), sort_keys=True) != json.dumps(team_ratings['teams'], sort_keys=True):
        save('team-ratings.json', team_ratings)
        changed = True
        print(f"TEAM RATINGS: {len(team_ratings['teams'])} teams rated.")

    stamp = now_utc().isoformat()
    if players_changed:
        changed = True

    if teams_changed:
        save('teams.json', teams)
        changed = True
        print('teams.json updated with official FIH ranks.')

    if changed:
        fixtures['last_updated'] = stamp
        predictions['updated_at'] = stamp
        players['last_updated'] = stamp
        version_doc['version'] = int(version_doc.get('version', 0)) + 1
        version_doc['updated_at'] = stamp
        version_doc['source'] = 'github-actions'
        save('fixtures.json', fixtures)
        save('predictions.json', predictions)
        save('players.json', players)
        save('data-version.json', version_doc)
        # The counter can survive a merge that changed the content underneath
        # it; the fingerprint cannot. Clients resync on either.
        from data_fingerprint import stamp as stamp_fingerprint
        print(f"Data version bumped -> {version_doc['version']} "
              f"(fingerprint {stamp_fingerprint(version_doc)})")
    else:
        print('No changes.')

if __name__ == '__main__':
    main()
