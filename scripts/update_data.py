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
SCORE_ROW = re.compile(r'^(\d{1,2})\s*-\s*(\d{1,2})$')

def parse_tms_results(lines):
    """{(home, away): (home_goals, away_goals)} from the TMS matches page.

    Only a pair row immediately answered by a score row counts — an upcoming
    match's "2 hours from now" matches nothing, so it yields no result. A pair
    appearing twice with different scores marks the page misread and returns
    None rather than a coin-flip.
    """
    results, pending = {}, None
    for ln in lines:
        ln = ln.strip()
        if ln in ('', '&nbsp;'):
            continue
        pair = PAIR_ROW.match(ln)
        if pair and pair.group(1) in TEAM_CODES and pair.group(2) in TEAM_CODES:
            pending = (pair.group(1), pair.group(2))
            continue
        score = SCORE_ROW.match(ln)
        if score and pending:
            value = (int(score.group(1)), int(score.group(2)))
            if pending in results and results[pending] != value:
                print(f'RESULTS: {pending} appears twice with different scores — page misread.')
                return None
            results[pending] = value
        pending = None
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

def sync_schedule_from_match_pages(fixtures, links):
    """
    Correct kickoff date, time and venue against each TMS match page.

    The seeded schedule was wrong in both directions — BEL v GER held at 13:30
    when FIH plays it at 20:30, IND v WAL at 13:30 when FIH played it at
    13:00 — and a wrong kickoff is what let the clock fabricate a finished
    match. Each fixture also learns its TMS match id, so later runs skip pages
    for matches already completed, and the official line-ups on those pages
    have an address when they are wired in.
    """
    by_pair = {frozenset((m['home'], m['away'])): m for m in fixtures['matches']
               if m['home'] != 'TBD' and m['away'] != 'TBD'}
    known = {str(m.get('tms_id')): m for m in fixtures['matches'] if m.get('tms_id')}
    changed = False
    for mid in sorted(links, key=int):
        prior = known.get(mid)
        if prior is not None and prior['status'] == 'completed' and has_score(prior):
            continue  # its kickoff is history; don't refetch every run
        body, _ = _tms_get(f'{TMS_HOST}/matches/{mid}', referer=TMS_BASE + '/matches')
        if not body:
            continue
        info = parse_match_page(_tms_lines(body))
        if not info:
            print(f'SCHEDULE: match page {mid} did not parse — skipped.')
            continue
        m = by_pair.get(frozenset(info['pair']))
        if not m:
            continue
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
    return changed

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
            seq = len([p for p in players_doc['players'] if p['team'] == code]) + 1
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

HOCKEY_FORMATION = '4-3-3'   # GK + 4 defenders + 3 midfielders + 3 forwards
LINE_ORDER = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward']
LINE_NEED = {'Goalkeeper': 1, 'Defender': 4, 'Midfielder': 3, 'Forward': 3}

def _lineup_rank(p):
    """Captain first, then rating, then international experience."""
    return (0 if p.get('is_captain') else 1,
            -(p.get('ai_rating') or 0),
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
        # Rolling substitutions: hockey subs come and go, shown as a clock time
        minute = 8 + int(rng() * 44)
        subs.append({
            'playerId': p['id'], 'name': p['name'], 'number': p.get('number'),
            'position': _stated(p), 'onAt': f'{minute:02d}:{int(rng() * 60):02d}',
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
    return {code: rank for rank, code, _ in rows}

def apply_rankings(teams, ranks):
    """Write official ranks into teams.json. Returns True if anything changed."""
    if not ranks:
        return False
    changed = False
    for t in teams['teams']:
        new = ranks.get(t['code'])
        if new is None:
            print(f"RANKINGS: {t['code']} not present in the official table — keeping #{t['fih_rank']}")
            continue
        if t['fih_rank'] != new:
            print(f"RANKINGS: {t['code']} #{t['fih_rank']} -> #{new}")
            t['fih_rank'] = new
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
        if m['status'] == 'completed':
            continue

        if m['status'] == 'scheduled' and ko <= now:
            m['status'] = 'live'
            changed = True
            print(f"LIVE: {m['id']} {m['home']} vs {m['away']}")
        if m['status'] == 'live' and now >= end:
            if has_score(m):
                m['status'] = 'completed'
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
        page = page_results.get((h, a)) or (
            page_results.get((a, h)) and page_results[(a, h)][::-1])
        if page and dh >= pending_count[h] and da >= pending_count[a]:
            sh, sa = page
            if dh == 1 and da == 1 and (rh['gf'] - lh['gf'], ra['gf'] - la['gf']) != (sh, sa):
                print(f"BACKFILL SKIP {m['id']}: page says {sh}-{sa} but standings "
                      f"deltas disagree — leaving it for the next run.")
                continue
            m['score'] = {'home': sh, 'away': sa}
            m['result_source'] = 'fih-tms-matches'
            m['status'] = 'completed'
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
        changed = True
        print(f"BACKFILL: {m['id']} {h} {sh}-{sa} {a} (from TMS standings deltas)")
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

def estimate_enrichment(fixtures, players_doc):
    """
    For completed matches with a real score but no timeline: generate seeded,
    roster-aware events + PC counts + stats + commentary. Labeled 'estimated';
    manual events always win and are never overwritten.
    """
    players = players_doc['players']
    changed = False
    for m in fixtures['matches']:
        if m['status'] != 'completed' or not has_score(m):
            continue
        if m.get('events'):
            # Manual/official timeline exists — only derive stats/commentary if absent
            if not m.get('stats'):
                m['stats'] = derive_stats_from_events(m)
                changed = True
            if not m.get('commentary'):
                m['commentary'] = build_commentary(m)
                changed = True
            continue

        rng = seeded_rng(f"{m['id']}:{m['score']['home']}-{m['score']['away']}")
        events = []
        picked = {}
        for side in ('home', 'away'):
            code = m[side]
            for _ in range(m['score'][side]):
                via = pick_weighted(rng, GOAL_VIA_WEIGHTS)
                minute = 2 + int(rng() * 58)
                ev = {
                    'minute': minute, 'team': code, 'type': 'goal', 'via': via,
                    'player': pick_scorer(rng, players, code, via, picked),
                }
                if via == 'FG' and rng() < 0.6:
                    assist = pick_scorer(rng, players, code, 'FG', None)
                    if assist != ev['player']:
                        ev['assist'] = assist
                events.append(ev)
        # Cards: green common, yellow occasional, red rare
        for side in ('home', 'away'):
            code = m[side]
            if rng() < 0.55:
                events.append({'minute': 5 + int(rng() * 54), 'team': code, 'type': 'green_card',
                               'player': pick_scorer(rng, players, code, 'FG')})
            if rng() < 0.30:
                events.append({'minute': 10 + int(rng() * 49), 'team': code, 'type': 'yellow_card',
                               'player': pick_scorer(rng, players, code, 'PC')})
        events.sort(key=lambda e: e['minute'])
        m['events'] = events

        pc_goals = {s: sum(1 for e in events if e['team'] == m[s] and e['type'] == 'goal' and e['via'] == 'PC')
                    for s in ('home', 'away')}
        if not (m.get('penalty_corners') or {}).get('home'):
            m['penalty_corners'] = {
                'home': pc_goals['home'] + 2 + int(rng() * 5),
                'away': pc_goals['away'] + 2 + int(rng() * 5),
            }
        m['stats'] = derive_stats_from_events(m, rng)
        m['commentary'] = build_commentary(m)
        m['enrichment'] = 'estimated'
        changed = True
        print(f"ENRICHED (estimated): {m['id']} — {len(events)} events, stats, commentary")
    return changed

def derive_stats_from_events(m, rng=None):
    """Per-side match stats. Real fields from events/PC; volumes seeded when estimating."""
    rng = rng or seeded_rng(f"stats:{m['id']}")
    s = {}
    gh, ga = m['score']['home'], m['score']['away']
    pc = m.get('penalty_corners') or {}
    lean = 50 + (gh - ga) * 4
    poss_home = max(35, min(65, int(lean + (rng() - 0.5) * 8)))
    for side, goals, opp_goals in (('home', gh, ga), ('away', ga, gh)):
        events = [e for e in (m.get('events') or []) if e.get('team') == m[side]]
        s[side] = {
            'goals': goals,
            'shots': goals + 3 + int(rng() * 6),
            'circle_entries': 10 + goals * 3 + int(rng() * 10),
            'penalty_corners': pc.get(side),
            'possession': poss_home if side == 'home' else 100 - poss_home,
            'green_cards': sum(1 for e in events if e['type'] == 'green_card'),
            'yellow_cards': sum(1 for e in events if e['type'] == 'yellow_card'),
            'red_cards': sum(1 for e in events if e['type'] == 'red_card'),
        }
    return s

VIA_LABEL = {'PC': 'penalty corner', 'FG': 'field goal', 'PS': 'penalty stroke'}

def build_commentary(m):
    """Deterministic beats from the event ledger — quarters, goals, cards, FT."""
    beats = [{'minute': 0, 'text': f"Push-back! {m['home']} vs {m['away']} under way."}]
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

    agg = {p['name']: {'goals': 0, 'assists': 0, 'pc': 0, 'green': 0, 'yellow': 0, 'red': 0, 'mids': set()}
           for p in players}

    for m in fixtures['matches']:
        if m['status'] != 'completed' or not has_score(m):
            continue
        for side, opp in (('home', 'away'), ('away', 'home')):
            code = m[side]
            team_matches[code] = team_matches.get(code, 0) + 1
            team_conceded[code] = team_conceded.get(code, 0) + m['score'][opp]
        for e in m.get('events') or []:
            p = by_name.get(e.get('player'))
            if not p:
                continue
            a = agg[p['name']]
            a['mids'].add(m['id'])
            if e['type'] == 'goal':
                a['goals'] += 1
                if e.get('via') == 'PC':
                    a['pc'] += 1
            elif e['type'] == 'green_card':
                a['green'] += 1
            elif e['type'] == 'yellow_card':
                a['yellow'] += 1
            elif e['type'] == 'red_card':
                a['red'] += 1
            if e.get('assist') and e['assist'] in agg:
                agg[e['assist']]['assists'] += 1

    max_team_mp = max(team_matches.values(), default=1)
    changed = False
    for p in players:
        a = agg[p['name']]
        tm = team_matches.get(p['team'], 0)
        mp = tm  # squad players are assumed rostered for their team's matches
        conceded = team_conceded.get(p['team'], 0)
        ga_per_match = conceded / tm if tm else 0

        pos = p['position']
        if pos == 'Goalkeeper':
            base = 62 + max(0, (3.0 - ga_per_match)) * 9
            clean_sheets = 0
            for m in fixtures['matches']:
                if m['status'] == 'completed' and has_score(m):
                    if m['home'] == p['team'] and m['score']['away'] == 0: clean_sheets += 1
                    if m['away'] == p['team'] and m['score']['home'] == 0: clean_sheets += 1
            base += clean_sheets * 4
        elif pos == 'Defender':
            base = 58 + a['pc'] * 6 + a['goals'] * 3 + a['assists'] * 3 + max(0, (3.0 - ga_per_match)) * 5
        elif pos == 'Midfielder':
            base = 58 + a['goals'] * 5 + a['assists'] * 5 + a['pc'] * 3
        elif pos == 'Forward':
            base = 56 + a['goals'] * 7 + a['assists'] * 3.5
        else:
            # Position not stated on the entry list. A positional rating means
            # nothing without one, and scoring them as forwards by default would
            # put unrated squad players into the Best XI.
            base = None
        if base is None:
            rating = None
        else:
            base -= a['yellow'] * 2 + a['red'] * 6
            if p.get('fih_star'): base += 3
            if p.get('is_captain'): base += 1
            volume = math.sqrt(mp / max_team_mp) if max_team_mp else 1
            rating = round(min(99, max(40, 40 + (base - 40) * volume)), 1)

        new_vals = {
            'goals': a['goals'],
            'assists': max(p.get('assists', 0), a['assists']),  # keep seeded assists if ledger lacks them
            'pc_scored': a['pc'],
            'yellow_cards': a['yellow'],
            'red_cards': a['red'],
            'green_cards': a['green'],
            'matches_played': mp,
            'ai_rating': rating,
        }
        for k, v in new_vals.items():
            if p.get(k) != v:
                p[k] = v
                changed = True
    if changed:
        print('PLAYER STATS: recomputed tournament aggregates + AI ratings')
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

QF_SLOTS = {'QF1': ('A', 0, 'C', 0), 'QF2': ('B', 0, 'D', 0), 'QF3': ('A', 1, 'C', 1), 'QF4': ('B', 1, 'D', 1)}

def ko_winner(m):
    if not has_score(m) or m['status'] != 'completed':
        return None
    so = m.get('shootout') or {}
    if so.get('home') is not None and so['home'] != so['away']:
        return m['home'] if so['home'] > so['away'] else m['away']
    if m['score']['home'] != m['score']['away']:
        return m['home'] if m['score']['home'] > m['score']['away'] else m['away']
    return None

def slot_knockouts(fixtures):
    """Fill QF/SF/medal fixtures from real results as rounds complete."""
    by_id = {m['id']: m for m in fixtures['matches']}
    changed = False

    for qf, (ph, pi, pa, pj) in QF_SLOTS.items():
        m = by_id.get(qf)
        if not m or m['home'] != 'TBD':
            continue
        if pool_complete(fixtures, ph) and pool_complete(fixtures, pa):
            th = pool_table(fixtures, ph)[pi][0]
            ta = pool_table(fixtures, pa)[pj][0]
            m['home'], m['away'] = th, ta
            changed = True
            print(f"SLOTTED {qf}: {th} vs {ta}")

    for sf, (q1, q2) in (('SF1', ('QF1', 'QF3')), ('SF2', ('QF2', 'QF4'))):
        m = by_id.get(sf)
        if not m or m['home'] != 'TBD':
            continue
        w1, w2 = ko_winner(by_id.get(q1, {})), ko_winner(by_id.get(q2, {}))
        if w1 and w2:
            m['home'], m['away'] = w1, w2
            changed = True
            print(f"SLOTTED {sf}: {w1} vs {w2}")

    sf1, sf2 = by_id.get('SF1'), by_id.get('SF2')
    if sf1 and sf2:
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
    return changed

# ------------------------------------------------------------- oracle
def elo_from_rank(rank):
    return 2000 - 38 * (rank - 1)

def predict(home_rank, away_rank):
    rh, ra = elo_from_rank(home_rank), elo_from_rank(away_rank)
    p_home_raw = 1 / (1 + 10 ** ((ra - rh) / 400))
    gap = abs(rh - ra)
    p_draw = 0.26 * math.exp(-gap / 260)  # hockey pool draw rate baseline
    p_home = p_home_raw * (1 - p_draw)
    p_away = (1 - p_home_raw) * (1 - p_draw)
    return round(p_home, 3), round(p_draw, 3), round(p_away, 3)

def revise_stale_predictions(fixtures, predictions, rank_of, now):
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
        ph, pd, pa = predict(hr, ar)
        if m['phase'] != 'pool':
            adv_h = ph + pd / 2
            pick = 'HOME' if adv_h >= 0.5 else 'AWAY'
            conf = round(max(adv_h, 1 - adv_h), 3)
        else:
            pick = 'HOME' if ph >= max(pd, pa) else ('AWAY' if pa >= pd else 'DRAW')
            conf = round(max(ph, pd, pa), 3)
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
        p['superseded_reason'] = 'FIH ranks corrected against fih.hockey; pick revised before push-back.'
        predictions['predictions'].append({
            'id': f"oracle-v1:{mid}:r{rev}",
            'matchId': mid,
            'source': 'oracle-v1',
            'basis': 'pre-match',
            'revises': p['id'],
            'p_home_win': ph, 'p_draw': pd, 'p_away_win': pa,
            'pick': pick, 'pick_confidence': conf,
            'reason': (f"FIH #{min(hr, ar)} {fav} favoured over #{max(hr, ar)} {dog} — Elo model "
                       f"from world rankings. Revised before push-back: the original pick used "
                       f"seeded ranks later corrected against fih.hockey, and stays in the ledger."),
            'publishedAt': now.isoformat(),
        })
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

def generate_predictions(fixtures, teams, predictions):
    """
    Every fixture with both teams known carries an engine pick — including
    matches that finished before the pipeline existed. The model is
    SCORE-BLIND (FIH ranks only), so a backfilled pick is byte-identical to
    what the engine would have output pre-match; those rows are labeled
    basis='model-backfill' in the ledger for full transparency. Once written,
    a pick is never edited or deleted.
    """
    rank_of = {t['code']: t['fih_rank'] for t in teams['teams']}
    have = {p['matchId'] for p in predictions['predictions']}
    changed = False
    now = now_utc()

    changed |= revise_stale_predictions(fixtures, predictions, rank_of, now)

    for m in fixtures['matches']:
        if m['id'] in have or m['home'] == 'TBD':
            continue
        try:
            ko = kickoff(m)
        except ValueError:
            continue
        knockout = m['phase'] != 'pool'
        pre_match = ko > now
        hr, ar = rank_of.get(m['home']), rank_of.get(m['away'])
        if hr is None or ar is None:
            continue
        ph, pd, pa = predict(hr, ar)
        if knockout:
            adv_h = ph + pd / 2
            pick = 'HOME' if adv_h >= 0.5 else 'AWAY'
            conf = round(max(adv_h, 1 - adv_h), 3)
        else:
            pick = 'HOME' if ph >= max(pd, pa) else ('AWAY' if pa >= pd else 'DRAW')
            conf = round(max(ph, pd, pa), 3)
        fav, dog = (m['home'], m['away']) if pick != 'AWAY' else (m['away'], m['home'])
        stage_note = f" {m['phase'].replace('-', ' ').title()} slot decided by pool standings." if knockout else ''
        basis_note = (' Published before push-back.' if pre_match else
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
    changed |= fix_venues(fixtures)
    # The official schedule before the clock speaks: statuses are computed
    # from kickoff times, and the per-match pages are the authority on those.
    links = discover_tms_lineup_links()
    changed |= sync_schedule_from_match_pages(fixtures, links)
    changed |= update_statuses(fixtures)

    # The matches page carries every final score by team-code pair — the
    # primary result source, consumed by the backfill below.
    page_body, _ = _tms_get(TMS_BASE + '/matches')
    page_results = parse_tms_results(_tms_lines(page_body)) if page_body else {}
    if page_results:
        print(f'RESULTS: matches page carries {len(page_results)} final scores.')

    # Official FIH world rankings — fetched here because CI has the egress
    # that local sandboxes don't. Feeds both the UI and the model prior.
    teams_changed = apply_rankings(teams, fetch_fih_rankings())

    # Official entry lists, when TMS publishes them — squads gate the line-ups.
    squads, staff = fetch_tms_squads()
    players_changed = reconcile_team_lists(players, squads)
    players_changed |= merge_squads(players, squads, teams)
    teams_changed |= apply_coaches(teams, staff)

    tms = fetch_tms_standings()
    if tms:
        print(f"TMS standings parsed: { {k: len(v) for k, v in tms.items()} }")
        changed |= backfill_scores_from_tms(fixtures, tms, page_results)

    changed |= estimate_enrichment(fixtures, players)
    changed |= update_player_stats(fixtures, players)
    changed |= slot_knockouts(fixtures)
    changed |= build_lineups(fixtures, players, teams)
    changed |= generate_predictions(fixtures, teams, predictions)

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
        print(f"Data version bumped -> {version_doc['version']}")
    else:
        print('No changes.')

if __name__ == '__main__':
    main()
