"""
Hockey.AI — why a match report did not read.

Twelve of forty reports parse to two full elevens. The rest lose a row
somewhere, and one lost row leaves ten starters and rejects the sheet. The
rejection already names the rows it could not read, but that happens in the
middle of a job whose log is truncated from the end, so it is never seen.

This runs the same read against the matches that failed and prints only that.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import match_report
import update_data as ud


def main():
    fixtures = ud.load('fixtures.json')
    players = ud.load('players.json')['players']
    by_team = {}
    for p in players:
        by_team.setdefault(p['team'], []).append(p)

    failing = [m for m in fixtures['matches']
               if m.get('tms_id') and m['status'] == 'completed'
               and (m.get('lineups') or {}).get('source') != 'official']
    limit = int(os.environ.get('PROBE_SHEETS', '3'))
    print(f'{len(failing)} match(es) without an official sheet; reading {limit}.')

    for m in failing[:limit]:
        print(f"\n== {m['id']} {m['home']} v {m['away']} (tms {m['tms_id']}) ==")
        body, _ = ud._tms_get(f"{ud.TMS_HOST}/matches/{m['tms_id']}/reports/matchreport",
                              referer=f"{ud.TMS_HOST}/matches/{m['tms_id']}")
        if not body or body[:4] != b'%PDF':
            print('  the report did not come back as a PDF.')
            continue
        lines = ud._pdf_lines(body)
        rejected = []
        parsed = match_report.parse(lines, by_team.get(m['home'], []),
                                    by_team.get(m['away'], []),
                                    on_reject=rejected.append)
        if parsed:
            print('  reads cleanly here.')
            continue
        print(f'  {len(rejected)} row(s) unread:')
        for row in rejected:
            print(f'  ?| {row[:120]}')
        # The whole player block, so a row that never reached the reader at all
        # is visible too.
        start = next((i for i, l in enumerate(lines)
                      if match_report.HEADER.match(l)), None)
        if start is not None:
            print('  the block as the PDF gives it:')
            for l in lines[start:start + 26]:
                print(f'  |{l[:120]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
