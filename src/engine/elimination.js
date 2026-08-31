// Hockey.AI — when each nation left the title race.
//
// One map, `code -> { finishedCount, stage }`, read by the Teams grid's Alive
// cut, by the Oracle race (which drops a nation's line to zero from its
// elimination point) and by the team pages. Keeping it in one pure function
// is what stops those three disagreeing about who is still in it.
//
// "Out" means out of the TITLE race, not out of the tournament. A side that
// drops to Pools G/H still has matches to play, for places 9–16; it cannot win
// the World Cup, so it is out. The elimination point is recorded on the
// finished-count axis — the number of completed matches at which it happened —
// because that is the axis the race chart is drawn on.
//
// It lives apart from oracleBundle.js so a node gate can import it: that file
// pulls in React and Dexie and cannot be loaded outside a browser, which is
// how the chain came to stop at the semi-finals without anything noticing.

/** Which tie settles the last place in the race, and what to call that exit. */
const SETTLES = { semi: 'SF', medal: 'Final' }

/**
 * @param {Array} teams     every nation at the tournament
 * @param {Array} matches   the fixture list
 * @param {Array} results   completed matches in kickoff order
 * @param {Array} standings pool tables
 * @param {object} bracket  the projected bracket (ties carry played/winner/loser)
 */
export function computeElimination(teams, matches, results, standings, bracket) {
  const eliminationAt = new Map()

  // The first exit recorded is the true one: a side eliminated when its pool
  // finished does not become "more eliminated" by losing again later.
  const markOut = (code, stage) => {
    if (eliminationAt.has(code)) return
    const lastIdx = results.reduce((acc, m, i) =>
      (m.home === code || m.away === code) ? i + 1 : acc, 0)
    eliminationAt.set(code, { finishedCount: lastIdx, stage })
  }

  // A finished Stage-1 pool settles its bottom two: they drop into Pools G/H,
  // which play only for places 9–16.
  const poolMatches = matches.filter(m => m.phase === 'pool')
  for (const pool of standings) {
    const done = poolMatches.filter(m => m.pool === pool.id).every(m =>
      m.status === 'completed' && m.score?.home != null)
    if (!done) continue
    pool.standings.slice(2).forEach(row => markOut(row.team, 'Stage 2 (9–16)'))
  }

  // Once both semi-finals name their sides, those four are the title race and
  // every other nation is out of it. Read off the bracket rather than
  // re-derived here, so the Teams grid and the bracket board look at the same
  // four names.
  const semis = bracket.ties.filter(t => t.group === 'semi')
  const contenders = new Set(semis.flatMap(t => [t.home, t.away]).filter(Boolean))
  if (semis.length > 0 && semis.every(t => t.locked) && contenders.size === semis.length * 2) {
    for (const t of teams) {
      if (!contenders.has(t.code)) markOut(t.code, 'Stage 2 (5–8)')
    }
  }

  // A played semi-final settles two more, and the gold final settles the last.
  //
  // The chain used to stop at the semi-finals, which left the losing finalist
  // never marked: with all fifty matches played the Teams grid still counted
  // two nations "Alive" in a tournament that had finished. Losing the final is
  // the most conclusive way there is to be out of the title race.
  //
  // The bronze match is deliberately not here. Both its sides were eliminated
  // by their semi-final, and markOut keeps that earlier, truer point — an exit
  // is where a nation stopped being able to win, not where it last played.
  for (const tie of bracket.ties) {
    if (!tie.played || !tie.loser) continue
    if (tie.group !== 'semi' && tie.id !== 'GOLD') continue
    const idx = results.findIndex(m => m.id === tie.id)
    if (idx >= 0) {
      eliminationAt.set(tie.loser, { finishedCount: idx + 1, stage: SETTLES[tie.group] })
    }
  }

  return eliminationAt
}
