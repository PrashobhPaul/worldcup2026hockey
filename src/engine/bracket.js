// Hockey.AI — the medal path, as the FIH's own tournament diagram lays it out.
//
//        POOL A                  FINAL                  POOL B
//                        POOL E        POOL F
//        POOL D               SEMI-FINALS               POOL C
//
// Nothing about that shape is hardcoded here. Which Stage-2 pools carry the
// medal path, which Stage-1 pools feed them, and which side of the draw each
// sits on are all read out of the match record:
//
//   * a medal pool is a Stage-2 pool every one of whose entrants finished
//     first or second in its Stage-1 pool — the other two carry the sides
//     that finished third and fourth, and lead to the classification places
//     rather than to a semi-final;
//   * a Stage-1 pool belongs to the side of the draw its qualifiers went to.
//
// So if the format changes, this follows it instead of misdescribing it.
//
// Every slot carries the label the diagram prints — "1st Pool A", "Winner
// Semi 1" — and resolves to a nation only where the record settles it. A pool
// that has not finished states no positions, because it has none yet.
import { computeStandings, computeStage2Standings } from './standings.js'

const ORDINALS = ['', '1st', '2nd', '3rd', '4th']
export const ordinal = n => ORDINALS[n] ?? `${n}th`

const played = m => m?.status === 'completed' && m?.score?.home != null
const named = code => code && code !== 'TBD'

function slot(label, team) {
  return { label, team: named(team) ? team : null }
}

function tie(match, home, away) {
  if (!match) return null
  return {
    id: match.id,
    home,
    away,
    score: played(match) ? [match.score.home, match.score.away] : null,
    status: match.status,
    date: match.date ?? null,
    provisional: match.provisional === true,
  }
}

export function buildBracket(teams, matches) {
  const all = matches ?? []
  const stage1 = computeStandings(teams ?? [], all)
  const stage2 = computeStage2Standings(all)
  if (!stage1.length || !stage2.length) return null

  // Where each nation finished Stage 1, and whether that pool is settled.
  const poolSettled = new Map()
  for (const pool of stage1) {
    const fixtures = all.filter(m => m.phase === 'pool' && m.pool === pool.id)
    poolSettled.set(pool.id, fixtures.length > 0 && fixtures.every(played))
  }
  const from = new Map()
  for (const pool of stage1) {
    pool.standings.forEach((row, i) => {
      from.set(row.team, { pool: pool.id, pos: i + 1, settled: poolSettled.get(pool.id) })
    })
  }

  // A medal pool: every entrant arrived as a first or second place.
  const medal = stage2.filter(p =>
    p.standings.length > 0 &&
    p.standings.every(r => from.get(r.team)?.settled && from.get(r.team).pos <= 2))
  if (medal.length !== 2) return null

  const complete = p => p.crossTotal > 0 && p.crossPlayed === p.crossTotal
  const posIn = (pool, team) => {
    if (!complete(pool)) return null
    const i = pool.standings.findIndex(r => r.team === team)
    return i < 0 ? null : i + 1
  }

  const pools = medal.map(pool => ({
    id: pool.id,
    complete: complete(pool),
    // The diagram lists who *enters* the pool, in Stage-1 order: 1st Pool A,
    // 2nd Pool A, 1st Pool D, 2nd Pool D. The live position is carried
    // alongside so the same box shows how the pool is actually going.
    entries: pool.standings
      .map(r => {
        const entry = from.get(r.team)
        return {
          team: r.team,
          entryPool: entry.pool,
          entryPos: entry.pos,
          // Where the nation stands in this pool now, once it has finished.
          pos: posIn(pool, r.team),
        }
      })
      .sort((a, b) => a.entryPool.localeCompare(b.entryPool) || a.entryPos - b.entryPos)
      .map(e => ({
        team: e.team,
        label: `${ordinal(e.entryPos)} Pool ${e.entryPool}`,
        pos: e.pos,
      })),
    feeders: [...new Set(pool.standings.map(r => from.get(r.team).pool))].sort(),
  }))

  // Semi-finals, in the order the schedule runs them.
  // In schedule order: the FIH numbers every match, and the semis are 47 and
  // 48, so "Semi 1" and "Semi 2" mean the same thing here as on the diagram.
  const semiFixtures = all
    .filter(m => m.phase === 'semi-final')
    .sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0) || a.id.localeCompare(b.id))

  // A nation's place in the medal pools, for labelling a semi-final side the
  // way the diagram does — "1st Pool E".
  const seat = new Map()
  for (const pool of pools) {
    for (const e of pool.entries) {
      if (e.pos) seat.set(e.team, `${ordinal(e.pos)} Pool ${pool.id}`)
    }
  }
  const sideLabel = (code, fallback) => (named(code) && seat.get(code)) || fallback

  // The diagram's own pairing: semi 1 is 1st of the left pool against 2nd of
  // the right, semi 2 the mirror of it. Used only to label a side the record
  // has not named yet.
  const [left, right] = pools
  const fallback = [
    [`1st Pool ${left.id}`, `2nd Pool ${right.id}`],
    [`2nd Pool ${left.id}`, `1st Pool ${right.id}`],
  ]
  const semis = semiFixtures.map((m, i) => ({
    ...tie(m,
      slot(sideLabel(m.home, fallback[i]?.[0] ?? 'Semi-finalist'), m.home),
      slot(sideLabel(m.away, fallback[i]?.[1] ?? 'Semi-finalist'), m.away)),
    number: i + 1,
  }))

  const winnerOf = m => (m && m.score ? (m.score[0] > m.score[1] ? m.home.team : m.away.team) : null)
  const loserOf = m => (m && m.score ? (m.score[0] > m.score[1] ? m.away.team : m.home.team) : null)

  const goldFixture = all.find(m => m.phase === 'gold-final')
  const bronzeFixture = all.find(m => m.phase === 'bronze-final')
  const final = tie(goldFixture,
    slot('Winner Semi 1', named(goldFixture?.home) ? goldFixture.home : winnerOf(semis[0])),
    slot('Winner Semi 2', named(goldFixture?.away) ? goldFixture.away : winnerOf(semis[1])))
  const bronze = tie(bronzeFixture,
    slot('Loser Semi 1', named(bronzeFixture?.home) ? bronzeFixture.home : loserOf(semis[0])),
    slot('Loser Semi 2', named(bronzeFixture?.away) ? bronzeFixture.away : loserOf(semis[1])))

  // Each side of the draw: the Stage-1 pools that fed that medal pool.
  const sides = pools.map(pool => ({
    poolId: pool.id,
    stage1: pool.feeders.map(id => {
      const s = stage1.find(p => p.id === id)
      return {
        id,
        settled: poolSettled.get(id),
        rows: s.standings.map((r, i) => ({ team: r.team, pos: i + 1, advanced: i < 2 })),
      }
    }),
  }))

  return { pools, sides, semis, final, bronze }
}
