#!/usr/bin/env python3
"""AI-authored pre-match rationales for upcoming Oracle picks.

Same two-tier contract as the match briefs: when an AI provider is
configured (scripts/ai_provider.py — ANTHROPIC_API_KEY or OPENAI_API_KEY),
every active pick for a match that has not pushed back yet gets its
rationale written by the model from the two teams' actual tournament
records; without a key, the deterministic template the pipeline already
writes stands. The ledger contract is untouched: picks, probabilities and
publishedAt are never modified, the replaced sentence stays on the row as
`reason_original`, and a rationale that has already been authored (by a
model or by hand — marked by `reason_original`) is never rewritten.
"""
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ai_provider  # noqa: E402
from update_data import kickoff, now_utc, team_form  # noqa: E402

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'data')

SYSTEM = (
    'You are the Oracle analyst for Hockey.AI at the FIH Hockey World Cup 2026. '
    'Write a single pre-match paragraph (60-90 words) arguing the given pick from the '
    'tournament evidence provided — results, goals scored and conceded, opponents faced. '
    'Never cite world rankings, ratings or model internals; never mention probabilities; '
    'never invent results not provided. Plain text, no markdown.')


def load(name):
    with open(os.path.join(DATA, name)) as fh:
        return json.load(fh)


def save(name, doc):
    with open(os.path.join(DATA, name), 'w') as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write('\n')


def team_record(code, fixtures, teams):
    lines = []
    for m in fixtures['matches']:
        if m['status'] != 'completed' or (m.get('score') or {}).get('home') is None:
            continue
        if code not in (m['home'], m['away']):
            continue
        lines.append(f"  {m['home']} {m['score']['home']}-{m['score']['away']} {m['away']} ({m['phase']})")
    name = next((t['name'] for t in teams['teams'] if t['code'] == code), code)
    return f"{name} ({code}) results this tournament:\n" + ('\n'.join(lines) or '  none yet')


def engine_rationale(m, pick_code, fixtures, teams):
    """A pre-match case argued from the ledger alone — the stopgap tier.

    Same contract as the engine match brief: published when no AI provider is
    configured, honest about every number it uses, upgraded by the AI writer
    on a later keyed run. It must clear the same gate as an AI rationale —
    argue from this tournament with real figures, never from a ranking gap —
    because the reader is not told which tier wrote the sentence next to a
    pick they can still act on. The 29 Aug outage left two medal-match picks
    wearing bare model boilerplate for exactly the lack of this tier.
    """
    names = {t['code']: t['name'] for t in teams['teams']}
    other = m['away'] if pick_code == m['home'] else m['home']
    pn, on = names.get(pick_code, pick_code), names.get(other, other)

    f_pick = team_form(pick_code, fixtures)
    f_oth = team_form(other, fixtures)
    bits = [f"{pn} arrive with {f_pick['wins']} wins from {f_pick['played']} matches "
            f"this tournament, scoring {f_pick['gf']} and conceding {f_pick['ga']};"
            f" {on} have won {f_oth['wins']} of {f_oth['played']}, "
            f"{f_oth['gf']} for and {f_oth['ga']} against."]

    meeting = next((x for x in fixtures['matches']
                    if x['status'] == 'completed' and (x.get('score') or {}).get('home') is not None
                    and {x['home'], x['away']} == {m['home'], m['away']}), None)
    if meeting:
        ms = meeting['score']
        w = meeting['home'] if ms['home'] > ms['away'] else meeting['away'] if ms['away'] > ms['home'] else None
        met = (f"The sides have already met once here — "
               f"{names.get(meeting['home'], meeting['home'])} "
               f"{ms['home']}-{ms['away']} {names.get(meeting['away'], meeting['away'])}")
        met += f", {names.get(w, w)} taking it." if w else ", a draw."
        bits.append(met)

    if m['phase'] in ('bronze-final', 'gold-final'):
        for sf_id in ('SF1', 'SF2'):
            sf = next((x for x in fixtures['matches'] if x['id'] == sf_id), None)
            if sf and sf['status'] == 'completed' and pick_code in (sf['home'], sf['away']):
                ss = sf['score']
                won = (ss['home'] > ss['away']) == (sf['home'] == pick_code)
                opp = sf['away'] if sf['home'] == pick_code else sf['home']
                mine = ss['home'] if sf['home'] == pick_code else ss['away']
                theirs = ss['away'] if sf['home'] == pick_code else ss['home']
                bits.append(f"{pn} {'beat' if won else 'lost to'} "
                            f"{names.get(opp, opp)} {mine}-{theirs} in the semi-final.")
    gd = (f_pick['gf'] - f_pick['ga']) - (f_oth['gf'] - f_oth['ga'])
    if gd > 0:
        bits.append(f"The goal difference between them across the tournament runs "
                    f"{gd} in {pn}'s favour, which is the margin the pick leans on.")
    else:
        bits.append(f"The records give the pick little to spare — this one rests on "
                    f"how {pn} have finished their chances rather than any daylight in the numbers.")
    return ' '.join(bits)


def main():
    name, _, model = ai_provider.provider()

    fixtures = load('fixtures.json')
    preds = load('predictions.json')
    teams = load('teams.json')
    matches = {m['id']: m for m in fixtures['matches']}
    now = now_utc()
    stamp = datetime.now(timezone.utc).isoformat()

    wrote = 0
    for row in preds['predictions']:
        # A row is done when it carries an authored rationale — unless the
        # author was the engine stopgap, which a keyed run upgrades to AI.
        authored = bool(row.get('reason_original'))
        engine_authored = 'engine' in (row.get('reason_revision') or '')
        if row.get('superseded') or (authored and not (engine_authored and name)):
            continue
        m = matches.get(row['matchId'])
        if not m or m['home'] == 'TBD':
            continue
        try:
            if kickoff(m) <= now:
                continue
        except ValueError:
            continue
        pick_code = m['home'] if row['pick'] == 'HOME' else m['away'] if row['pick'] == 'AWAY' else None
        pick_line = f"The Oracle picks {pick_code} to win." if pick_code else 'The Oracle picks a draw.'
        prompt = (
            f"Upcoming match: {m['home']} v {m['away']} ({m['phase']}, {m['date']}).\n"
            f"{pick_line}\n\n"
            f"{team_record(m['home'], fixtures, teams)}\n\n"
            f"{team_record(m['away'], fixtures, teams)}\n\n"
            'Write the pre-match rationale for the pick.')
        text, author = '', None
        if name:
            try:
                text = (ai_provider.complete(SYSTEM, prompt, max_tokens=300) or '').strip()
                author = f'rationale authored by {model} from the tournament record; pick and probabilities unchanged'
            except Exception as e:  # a provider hiccup must never fail the run
                print(f'AI rationale failed for {row["matchId"]}: {e}')
        if not text and not authored:
            text = engine_rationale(m, pick_code, fixtures, teams) if pick_code else ''
            author = ('rationale composed by the engine from the tournament record; '
                      'upgraded to an AI-authored one on a later run; pick and probabilities unchanged')
        if not text:
            continue
        if not authored:
            row['reason_original'] = row['reason']
        row['reason'] = text
        row['reason_revised_at'] = stamp
        row['reason_revision'] = author
        wrote += 1
        print(f'RATIONALE ({model}): {row["matchId"]}')

    if not wrote:
        print('No rationales to author this run.')
        return 0

    save('predictions.json', preds)
    version = load('data-version.json')
    version['version'] = int(version.get('version', 0)) + 1
    version['updated_at'] = stamp
    save('data-version.json', version)
    from data_fingerprint import stamp as stamp_fingerprint
    stamp_fingerprint()
    print(f'{wrote} rationale(s) authored, data-version -> {version["version"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
