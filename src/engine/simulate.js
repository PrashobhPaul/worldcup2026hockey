// Hockey.AI — seeded Monte Carlo tournament simulator
// Soccer.AI runs this server-side after every result; with 16 teams and 32
// matches the hockey edition is cheap enough to run in the browser. Completed
// results are honored, everything else is sampled from the strength model.

import {
  MODEL_PARAMS, teamRating, goalRates, matchProbabilities,
  mulberry32, samplePoisson,
} from './strength.js'

const QF_SLOTS = [
  { id: 'QF1', home: { pool: 'A', place: 0 }, away: { pool: 'C', place: 0 } },
  { id: 'QF2', home: { pool: 'B', place: 0 }, away: { pool: 'D', place: 0 } },
  { id: 'QF3', home: { pool: 'A', place: 1 }, away: { pool: 'C', place: 1 } },
  { id: 'QF4', home: { pool: 'B', place: 1 }, away: { pool: 'D', place: 1 } },
]

function hasResult(m) {
  return m.status === 'completed' && m.score?.home != null && m.score?.away != null
}

function realKnockoutWinner(m) {
  if (!hasResult(m)) return null
  const so = m.shootout
  if (so && typeof so.home === 'number' && typeof so.away === 'number' && so.home !== so.away) {
    return so.home > so.away ? m.home : m.away
  }
  if (m.score.home > m.score.away) return m.home
  if (m.score.away > m.score.home) return m.away
  return null
}

// Results in kickoff order — the "match #k" axis of the champion race.
export function orderedResults(matches) {
  return [...matches]
    .sort((x, y) => (x.kickoffUtc ?? 0) - (y.kickoffUtc ?? 0))
    .filter(hasResult)
}

/**
 * Simulate the tournament from the current (or truncated) state.
 * Returns per-team reach probabilities: { qf, sf, final, bronze, gold, champion }.
 * `truncateAfter`: only the first N chronological results count (worm history).
 */
export function simulateTournament(teams, matches, opts = {}) {
  const runs = opts.runs ?? MODEL_PARAMS.nSims
  const seed = opts.seed ?? MODEL_PARAMS.rngSeed
  const rng = mulberry32(seed)

  const ratings = new Map(teams.map(t => [t.code, teamRating(t)]))
  const known = orderedResults(matches)
  const counted = opts.truncateAfter != null ? known.slice(0, opts.truncateAfter) : known
  const countedIds = new Set(counted.map(m => m.id))

  const poolTeams = new Map()
  for (const t of teams) {
    if (!t.pool) continue
    if (!poolTeams.has(t.pool)) poolTeams.set(t.pool, [])
    poolTeams.get(t.pool).push(t.code)
  }

  const poolFixtures = matches.filter(m => m.phase === 'pool' && m.home !== 'TBD')
  const koFixtures = new Map(matches.filter(m => m.phase !== 'pool').map(m => [m.id, m]))

  const counts = new Map(teams.map(t => [t.code, { qf: 0, sf: 0, final: 0, bronze: 0, gold: 0, champion: 0 }]))

  // Pre-derive fixed pool results once
  const fixedPool = poolFixtures
    .filter(m => countedIds.has(m.id))
    .map(m => ({ home: m.home, away: m.away, h: m.score.home, a: m.score.away }))
  const openPool = poolFixtures.filter(m => !countedIds.has(m.id))
    .map(m => {
      const { lambdaH, lambdaA } = goalRates(ratings.get(m.home) ?? 1400, ratings.get(m.away) ?? 1400)
      return { home: m.home, away: m.away, lambdaH, lambdaA }
    })

  const simMatch = (codeH, codeA, knockout) => {
    const { lambdaH, lambdaA } = goalRates(ratings.get(codeH) ?? 1400, ratings.get(codeA) ?? 1400)
    const h = samplePoisson(lambdaH, rng)
    const a = samplePoisson(lambdaA, rng)
    if (!knockout || h !== a) return { h, a, winner: h > a ? codeH : h < a ? codeA : null }
    const edge = 0.5 + Math.max(-0.06, Math.min(0.06,
      ((ratings.get(codeH) ?? 1400) - (ratings.get(codeA) ?? 1400)) / MODEL_PARAMS.shootoutSlope))
    return { h, a, winner: rng() < edge ? codeH : codeA }
  }

  const resolveKO = (id, codeH, codeA) => {
    const real = koFixtures.get(id)
    if (real && countedIds.has(id) && real.home !== 'TBD') {
      const w = realKnockoutWinner(real)
      if (w) return w
    }
    return simMatch(codeH, codeA, true).winner
  }

  for (let run = 0; run < runs; run++) {
    // Pool stage
    const rows = new Map()
    const rowFor = code => {
      let r = rows.get(code)
      if (!r) { r = { code, pts: 0, gd: 0, gf: 0, tb: 0 }; rows.set(code, r) }
      return r
    }
    const apply = (home, away, h, a) => {
      const rh = rowFor(home), ra = rowFor(away)
      rh.gf += h; rh.gd += h - a
      ra.gf += a; ra.gd += a - h
      if (h > a) rh.pts += 3
      else if (h < a) ra.pts += 3
      else { rh.pts++; ra.pts++ }
    }
    for (const m of fixedPool) apply(m.home, m.away, m.h, m.a)
    for (const m of openPool) apply(m.home, m.away, samplePoisson(m.lambdaH, rng), samplePoisson(m.lambdaA, rng))

    // Drawing the tie-break key up front — one per team, in a fixed order —
    // instead of calling rng() from inside the sort comparator. A comparator
    // that consumes randomness makes the RNG stream depend on the JS engine's
    // sort internals, so the same seed produced different numbers in Node and
    // in Chromium. Keys drawn here give a total, algorithm-independent order.
    for (const [, codes] of poolTeams) for (const c of codes) rowFor(c).tb = rng()

    const placed = new Map()
    for (const [pool, codes] of poolTeams) {
      placed.set(pool, [...codes]
        .map(c => rowFor(c))
        .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.tb - y.tb)
        .map(r => r.code))
    }

    // Knockouts — real teams in real fixtures override projections
    const qfWinners = []
    for (const slot of QF_SLOTS) {
      const real = koFixtures.get(slot.id)
      const codeH = real && real.home !== 'TBD' ? real.home : placed.get(slot.home.pool)[slot.home.place]
      const codeA = real && real.away !== 'TBD' ? real.away : placed.get(slot.away.pool)[slot.away.place]
      counts.get(codeH).qf++; counts.get(codeA).qf++
      qfWinners.push(resolveKO(slot.id, codeH, codeA))
    }

    const sfPairs = [[qfWinners[0], qfWinners[2]], [qfWinners[1], qfWinners[3]]]
    const finalists = [], bronzists = []
    sfPairs.forEach(([codeH, codeA], i) => {
      counts.get(codeH).sf++; counts.get(codeA).sf++
      const w = resolveKO(`SF${i + 1}`, codeH, codeA)
      finalists.push(w)
      bronzists.push(w === codeH ? codeA : codeH)
    })

    counts.get(finalists[0]).final++; counts.get(finalists[1]).final++
    const champ = resolveKO('GOLD', finalists[0], finalists[1])
    counts.get(champ).champion++; counts.get(champ).gold++
    const bronze = resolveKO('BRZ', bronzists[0], bronzists[1])
    counts.get(bronze).bronze++
  }

  const out = new Map()
  for (const [code, c] of counts) {
    out.set(code, {
      qf: c.qf / runs, sf: c.sf / runs, final: c.final / runs,
      bronze: c.bronze / runs, champion: c.champion / runs,
    })
  }
  return { reach: out, runs, finishedCount: counted.length }
}

// The champion-probability progression that used to live here (a second,
// independently-seeded Monte-Carlo run per step) is gone: it produced numbers
// that disagreed with this file's own current-state simulation for the exact
// same tournament state. Snapshots — including the current one — are now built
// in one place, engine/probability.js.

/** Current standings-driven QF projection (most likely bracket). */
export function projectBracket(teams, matches, standings) {
  const ratings = new Map(teams.map(t => [t.code, teamRating(t)]))
  const byPool = new Map(standings.map(p => [p.id, p.standings.map(r => r.team)]))
  const koById = new Map(matches.filter(m => m.phase !== 'pool').map(m => [m.id, m]))

  const poolDone = new Map()
  for (const p of standings) {
    const poolMatches = matches.filter(m => m.phase === 'pool' && m.pool === p.id)
    poolDone.set(p.id, poolMatches.length > 0 && poolMatches.every(hasResult))
  }

  const ties = []
  const winners = {}
  const losers = {}

  const makeTie = (id, label, codeH, codeA, provisional) => {
    const real = koById.get(id)
    const home = real && real.home !== 'TBD' ? real.home : codeH
    const away = real && real.away !== 'TBD' ? real.away : codeA
    const played = real ? hasResult(real) : false
    let pHomeAdvance = null
    let winner = null
    if (played) {
      winner = realKnockoutWinner(real)
      pHomeAdvance = winner === home ? 1 : 0
    } else if (home && away) {
      pHomeAdvance = matchProbabilitiesKO(ratings.get(home), ratings.get(away))
    }
    const tie = {
      id, label, home, away, played, winner,
      loser: winner ? (winner === home ? away : home) : null,
      locked: !provisional,
      pHomeAdvance,
      predicted: pHomeAdvance != null ? (pHomeAdvance >= 0.5 ? home : away) : null,
      match: real ?? null,
    }
    if (tie.predicted) winners[id] = winner ?? tie.predicted
    if (winner) losers[id] = tie.loser
    ties.push(tie)
    return tie
  }

  for (const slot of QF_SLOTS) {
    const real = koById.get(slot.id)
    const fromReal = real && real.home !== 'TBD'
    const provisional = !fromReal && !(poolDone.get(slot.home.pool) && poolDone.get(slot.away.pool))
    makeTie(slot.id, real?.label ?? slot.id,
      byPool.get(slot.home.pool)?.[slot.home.place],
      byPool.get(slot.away.pool)?.[slot.away.place],
      provisional)
  }

  const qfLocked = QF_SLOTS.every(s => koById.get(s.id) ? hasResult(koById.get(s.id)) : false)
  makeTie('SF1', koById.get('SF1')?.label ?? 'SF1', winners.QF1, winners.QF3, !qfLocked)
  makeTie('SF2', koById.get('SF2')?.label ?? 'SF2', winners.QF2, winners.QF4, !qfLocked)

  const sfLocked = ['SF1', 'SF2'].every(id => koById.get(id) ? hasResult(koById.get(id)) : false)
  makeTie('BRZ', koById.get('BRZ')?.label ?? 'Bronze', losers.SF1 ?? predictedLoser(ties, 'SF1'), losers.SF2 ?? predictedLoser(ties, 'SF2'), !sfLocked)
  makeTie('GOLD', koById.get('GOLD')?.label ?? 'Final', winners.SF1, winners.SF2, !sfLocked)

  return { ties, byId: new Map(ties.map(t => [t.id, t])) }
}

function predictedLoser(ties, id) {
  const t = ties.find(x => x.id === id)
  if (!t?.predicted || !t.home || !t.away) return undefined
  return t.predicted === t.home ? t.away : t.home
}

function matchProbabilitiesKO(ratingH = 1400, ratingA = 1400) {
  const reg = matchProbabilities(ratingH, ratingA)
  const edge = 0.5 + Math.max(-0.06, Math.min(0.06, (ratingH - ratingA) / MODEL_PARAMS.shootoutSlope))
  return reg.home + reg.draw * edge
}
