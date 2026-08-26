// Hockey.AI — the tournament as a progression, not a list of cards.
//
// The structure is declared once, here, and the view renders it:
//
//     A + D  →  E                    W(SF1) + W(SF2)  →  FINAL
//     B + C  →  F                    L(SF1) + L(SF2)  →  BRONZE
//     1E + 2F  →  SF1
//     2E + 1F  →  SF2
//
// Which Stage-1 pools feed which crossover pool is still read out of the match
// record rather than written down — a crossover pool is one every entrant of
// which arrived as a first or second place, and a Stage-1 pool belongs to the
// side its qualifiers went to. If the format changes this follows it.
//
// Every slot is addressed by (source, position) and resolved through that key
// alone: "2nd Pool A" is looked up as the second row of Pool A's final table,
// never taken from whatever object happened to be to hand. Two slots therefore
// cannot collapse onto the same team by sharing a reference — the only way
// they can name the same nation is if the table itself says so twice, which it
// cannot.
//
// Nothing here is a forecast. A slot names a nation only where the record
// settles it, and the status says which kind of knowledge it is. PROJECTED is
// part of the vocabulary because a caller may one day supply projections; this
// engine never emits it, because the Oracle owns the projected bracket and two
// brackets disagreeing about the same tie is the thing worth avoiding.
import { computeStandings, computeStage2Standings } from './standings.js'

const ORDINALS = ['', '1st', '2nd', '3rd', '4th']
export const ordinal = n => ORDINALS[n] ?? `${n}th`

export const STATUS = {
  COMPLETED: 'COMPLETED',   // the match behind this slot has been played
  LOCKED: 'LOCKED',         // the record names the nation
  PROJECTED: 'PROJECTED',   // a projection, never emitted here
  TBD: 'TBD',               // not yet known
}

const played = m => m?.status === 'completed' && m?.score?.home != null
const named = code => (code && code !== 'TBD' ? code : null)

export function buildBracket(teams, matches) {
  const all = matches ?? []
  const stage1 = computeStandings(teams ?? [], all)
  const stage2 = computeStage2Standings(all)
  if (!stage1.length || !stage2.length) return null

  // ── Stage 1 ─────────────────────────────────────────────────────────
  const poolSettled = new Map()
  for (const pool of stage1) {
    const fixtures = all.filter(m => m.phase === 'pool' && m.pool === pool.id)
    poolSettled.set(pool.id, fixtures.length > 0 && fixtures.every(played))
  }
  // (pool, position) → nation. The one lookup every Stage-1 slot goes through.
  const place1 = (poolId, position) => {
    const pool = stage1.find(p => p.id === poolId)
    if (!pool || !poolSettled.get(poolId)) return null
    return pool.standings[position - 1]?.team ?? null
  }
  const from = new Map()
  for (const pool of stage1) {
    pool.standings.forEach((row, i) => {
      from.set(row.team, { pool: pool.id, pos: i + 1, settled: poolSettled.get(pool.id) })
    })
  }

  // ── The crossover pools that carry the medal path ───────────────────
  const medal = stage2.filter(p =>
    p.standings.length > 0 &&
    p.standings.every(r => from.get(r.team)?.settled && from.get(r.team).pos <= 2))
  if (medal.length !== 2) return null

  const complete = p => p.crossTotal > 0 && p.crossPlayed === p.crossTotal
  // (crossover pool, position) → nation, the Stage-2 equivalent of place1.
  const place2 = (poolId, position) => {
    const pool = medal.find(p => p.id === poolId)
    if (!pool || !complete(pool)) return null
    return pool.standings[position - 1]?.team ?? null
  }

  const qualifiers = medal.map(pool => {
    const feeders = [...new Set(pool.standings.map(r => from.get(r.team).pool))].sort()
    // Four independent slots: 1st and 2nd of each feeding pool, each resolved
    // by its own (pool, position) key.
    const slots = feeders.flatMap(feeder => [1, 2].map(position => {
      const team = place1(feeder, position)
      return {
        id: `${pool.id}:${feeder}${position}`,
        sourcePool: feeder,
        sourcePosition: position,
        label: `${ordinal(position)} Pool ${feeder}`,
        team,
        status: team ? STATUS.LOCKED : STATUS.TBD,
        // Where that nation stands in this pool now, once it has finished.
        standing: team && complete(pool)
          ? pool.standings.findIndex(r => r.team === team) + 1
          : null,
      }
    }))
    return {
      id: pool.id,
      feeders,
      complete: complete(pool),
      played: pool.crossPlayed,
      total: pool.crossTotal,
      slots,
    }
  })

  const groups = stage1
    .filter(p => qualifiers.some(q => q.feeders.includes(p.id)))
    .map(p => {
      const fixtures = all.filter(m => m.phase === 'pool' && m.pool === p.id)
      return {
        id: p.id,
        settled: poolSettled.get(p.id),
        played: fixtures.filter(played).length,
        total: fixtures.length,
        feeds: qualifiers.find(q => q.feeders.includes(p.id)).id,
        rows: p.standings.map((r, i) => ({ team: r.team, pos: i + 1, advanced: i < 2 })),
      }
    })

  // ── Semi-finals: 1E v 2F, 2E v 1F ───────────────────────────────────
  const [left, right] = qualifiers
  const fixtureFor = phase => all
    .filter(m => m.phase === phase)
    .sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0) || a.id.localeCompare(b.id))

  const crossSlot = (poolId, position) => {
    const team = place2(poolId, position)
    return {
      id: `${poolId}${position}`,
      source: poolId,
      sourcePosition: position,
      label: `${ordinal(position)} Group ${poolId}`,
      team,
      status: team ? STATUS.LOCKED : STATUS.TBD,
    }
  }

  const semiFixtures = fixtureFor('semi-final')
  const pairings = [
    [crossSlot(left.id, 1), crossSlot(right.id, 2)],
    [crossSlot(left.id, 2), crossSlot(right.id, 1)],
  ]
  const semis = pairings.map(([home, away], i) => {
    const fixture = semiFixtures[i]
    const done = played(fixture)
    // The sides stay in the order the structure declares — 2nd of one pool
    // against 1st of the other — and the score is aligned to them by team
    // rather than by position. The FIH may write the same tie the other way
    // round, and reading its score positionally would hand the match to the
    // side that lost it.
    const goalsFor = slot => {
      if (!done) return null
      if (slot.team && named(fixture.home) === slot.team) return fixture.score.home
      if (slot.team && named(fixture.away) === slot.team) return fixture.score.away
      return null
    }
    const score = done && goalsFor(home) != null && goalsFor(away) != null
      ? [goalsFor(home), goalsFor(away)]
      : (done ? [fixture.score.home, fixture.score.away] : null)
    return {
      id: fixture?.id ?? `SF${i + 1}`,
      type: 'SEMIFINAL',
      number: i + 1,
      title: `Semi Final ${i + 1}`,
      home: { ...home, status: done ? STATUS.COMPLETED : home.status },
      away: { ...away, status: done ? STATUS.COMPLETED : away.status },
      score,
      date: fixture?.date ?? null,
      // The fixture is the FIH's own statement of the same pairing. Where it
      // names a side, it and the derivation must agree; test:medalpath fails
      // if they ever do not, rather than one of them silently winning here.
      stated: fixture ? [named(fixture.home), named(fixture.away)] : [null, null],
      slotLabel: fixture?.slotLabel ?? null,
    }
  })

  const outcome = (semi, want) => {
    if (!semi.score) return null
    const homeWon = semi.score[0] > semi.score[1]
    const side = want === 'winner' ? (homeWon ? 'home' : 'away') : (homeWon ? 'away' : 'home')
    return semi[side].team
  }

  const medalMatch = (phase, id, type, title, want, verb) => {
    const fixture = fixtureFor(phase)[0]
    const done = played(fixture)
    const slots = semis.map(semi => {
      const derived = outcome(semi, want)
      const team = derived ?? null
      return {
        id: `${want}-${semi.id}`,
        source: semi.id,
        sourceMatch: semi.number,
        label: `${verb} Semi Final ${semi.number}`,
        team,
        status: team ? (done ? STATUS.COMPLETED : STATUS.LOCKED) : STATUS.TBD,
      }
    })
    return {
      id: fixture?.id ?? id,
      type,
      title,
      path: want,
      home: slots[0],
      away: slots[1],
      score: done ? [fixture.score.home, fixture.score.away] : null,
      date: fixture?.date ?? null,
      stated: fixture ? [named(fixture.home), named(fixture.away)] : [null, null],
    }
  }

  return {
    groups,
    qualifiers,
    semis,
    final: medalMatch('gold-final', 'GOLD', 'FINAL', 'Grand Final', 'winner', 'Winner'),
    bronze: medalMatch('bronze-final', 'BRZ', 'BRONZE', '3rd Place', 'loser', 'Loser'),
  }
}
