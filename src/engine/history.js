// Earlier meetings: published as a record, never as evidence for a pick.
//
// Two things are true at once. A reader is entitled to know these two nations
// have met before and how those meetings went. And a pick for a match in this
// tournament is argued from this tournament — an earlier meeting is a
// different squad, a different season, sometimes a different decade, and it is
// not part of the case being made.
//
// So the history is rendered under its own heading, labelled as not used in
// the pick, and the rationale never cites it. scripts/test_story_facts.py
// fails the build if one does.
//
// The boundary is the 2025-26 FIH Pro League, which ran 2026-02-12 to
// 2026-06-28. Everything before it is the historical record. h2h.json carries
// the date and competition of every meeting, all of it from FIH TMS, so the
// split is read from the data rather than assumed.

export const PRO_LEAGUE_2025_26_START = '2026-02-12'

const unescapeEntities = s => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

/**
 * Split a pair's meetings into the historical record.
 *
 * Returns {status, played, wins, meetings}. `status` matters: a pairing whose
 * history has never been harvested is NOT the same claim as one with no
 * meetings on record, and the app must not print the second when it means the
 * first. h2h.json only holds pairs that existed as fixtures when it last ran,
 * so knockout pairings are routinely absent until the pipeline catches up.
 */
export function preTournamentHistory(row, home, away) {
  if (!row || !Array.isArray(row.meetings)) return { status: 'not-retrieved' }
  const past = row.meetings
    .filter(m => m?.date && m.date < PRO_LEAGUE_2025_26_START)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
  if (!past.length) return { status: 'none-on-record', held: row.meetings.length }

  const wins = { [home]: 0, [away]: 0, drawn: 0 }
  for (const m of past) {
    const winner = m.home_goals > m.away_goals ? m.home
      : m.away_goals > m.home_goals ? m.away : null
    if (winner === null) wins.drawn += 1
    else if (winner in wins) wins[winner] += 1
  }
  return {
    status: 'ok',
    played: past.length,
    wins,
    meetings: past.map(m => ({
      date: m.date,
      competition: unescapeEntities(m.competition),
      home: m.home,
      away: m.away,
      score: [m.home_goals, m.away_goals],
    })),
  }
}
