// Hockey.AI — seeded Monte Carlo tournament simulator
// Models the real FIH Hockey World Cup 2026 format: four Stage-1 pools (A–D)
// feed a Stage-2 group phase (E/F/G/H). Pools E and F are the championship
// half — their top two go straight to the semi-finals (there are no
// quarter-finals). Pools G and H, plus the lower Stage-2 finishers, decide
// classification places 5–16. Where two teams come through from the same
// Stage-1 pool their head-to-head result is carried forward into Stage 2.
//
// Completed results (pool or knockout) are honored; everything else is sampled
// from the strength model. Fully deterministic: same seed, same tournament.

import {
  MODEL_PARAMS, teamRating, goalRates, matchProbabilities,
  mulberry32, samplePoisson,
} from './strength.js'

// Stage-2 re-pooling from Stage-1 finishing positions ([pool, 0-indexed place]).
export const STAGE2 = {
  E: [['A', 0], ['A', 1], ['D', 0], ['D', 1]],
  F: [['B', 0], ['B', 1], ['C', 0], ['C', 1]],
  G: [['A', 2], ['A', 3], ['D', 2], ['D', 3]],
  H: [['B', 2], ['B', 3], ['C', 2], ['C', 3]],
}
export const CHAMPIONSHIP_POOLS = ['E', 'F'] // top two of each reach the semis

// Knockout + classification bracket, defined over Stage-2 placements.
// Each slot is [pool, place]; ties resolve to real fixtures when those exist.
const SEMIS = [
  { id: 'SF1', home: ['E', 0], away: ['F', 1] }, // #47: 1st E v 2nd F
  { id: 'SF2', home: ['F', 0], away: ['E', 1] }, // #48: 1st F v 2nd E
]
// Classification matches read straight from Stage-2 placements.
// Ids match the fixture ids exactly (POS*, not C*) — a tie whose id does not
// exist in the schedule can never bind to its real fixture, so it would show
// no date or venue and would never lock when the match is played.
const CLASSIFICATION = [
  { id: 'POS5', label: '5th/6th Place', places: 5, home: ['E', 2], away: ['F', 2] },   // #45
  { id: 'POS7', label: '7th/8th Place', places: 7, home: ['E', 3], away: ['F', 3] },   // #46
  { id: 'POS9', label: '9th/10th Place', places: 9, home: ['G', 0], away: ['H', 0] },  // #44
  { id: 'POS11', label: '11th/12th Place', places: 11, home: ['G', 1], away: ['H', 1] }, // #43
  { id: 'POS13', label: '13th/14th Place', places: 13, home: ['G', 2], away: ['H', 2] }, // #41
  { id: 'POS15', label: '15th/16th Place', places: 15, home: ['G', 3], away: ['H', 3] }, // #42
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

const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`)

// ── One pool table from a list of {home,away,h,a} over a set of codes ────────
function poolPlacement(codes, played, tb) {
  const rows = new Map(codes.map(c => [c, { code: c, pts: 0, w: 0, gd: 0, gf: 0, tb: tb.get(c) ?? 0 }]))
  for (const m of played) {
    const rh = rows.get(m.home), ra = rows.get(m.away)
    if (!rh || !ra) continue
    rh.gf += m.h; rh.gd += m.h - m.a
    ra.gf += m.a; ra.gd += m.a - m.h
    if (m.h > m.a) { rh.pts += 3; rh.w++ }
    else if (m.h < m.a) { ra.pts += 3; ra.w++ }
    else { rh.pts++; ra.pts++ }
  }
  return [...rows.values()]
    .sort((x, y) => y.pts - x.pts || y.w - x.w || y.gd - x.gd || y.gf - x.gf || x.tb - y.tb)
    .map(r => r.code)
}

/**
 * Simulate the tournament from the current (or truncated) state.
 * Returns per-team reach probabilities:
 *   top8    — into a championship pool (E/F): the last-eight, title-contention half
 *   sf      — into the semi-finals (top two of E or F)
 *   final   — into the gold-medal match
 *   bronze  — won the bronze medal
 *   champion— won the gold medal
 * `truncateAfter`: only the first N chronological results count (worm history).
 */
export function simulateTournament(teams, matches, opts = {}) {
  const runs = opts.runs ?? MODEL_PARAMS.nSims
  const seed = opts.seed ?? MODEL_PARAMS.rngSeed
  const rng = mulberry32(seed)

  const ratings = new Map(teams.map(t => [t.code, teamRating(t)]))
  const rating = c => ratings.get(c) ?? 1400
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

  // Real, completed non-pool results, indexed by PHASE and team pair. The
  // pairing alone was the key until the medal round produced the
  // tournament's first re-matches, and the gold final — Spain v Germany,
  // still two days away — resolved in all four thousand simulations from
  // their stage-2 meeting: a match already played answering for one that was
  // not, and the app told its readers Spain were 100% champions. A pairing
  // names a fixture only within its phase.
  // Where the ledger has published an advance probability for a tie, that is
  // the number this simulation uses. Running a rating Elo of its own instead
  // is how the board came to read Germany 53% to win the final while the race
  // read Germany 63.8% to be champion — with only the final left, those are
  // the same question and cannot differ.
  //
  // Pool and stage-2 matches still sample scorelines from the rating model: a
  // pool table needs goals, and the ledger publishes a result probability, not
  // a scoreline. Every knockout goes through the published number.
  const publishedAdvance = opts.published instanceof Map ? opts.published : new Map()

  const realScore = new Map()   // phase:pair -> { [code]: goals }
  const realWinner = new Map()  // phase:pair -> winning code (shootout-aware)
  for (const m of matches) {
    if (m.phase === 'pool' || !hasResult(m) || !countedIds.has(m.id)) continue
    if (m.home === 'TBD' || m.away === 'TBD') continue
    realScore.set(`${m.phase}:${pairKey(m.home, m.away)}`, { [m.home]: m.score.home, [m.away]: m.score.away })
    const w = realKnockoutWinner(m)
    if (w) realWinner.set(`${m.phase}:${pairKey(m.home, m.away)}`, w)
  }

  const counts = new Map(teams.map(t => [t.code, { top8: 0, sf: 0, final: 0, bronze: 0, champion: 0 }]))

  // Pre-derive fixed pool results once (outside the run loop)
  const fixedPool = poolFixtures
    .filter(m => countedIds.has(m.id) && hasResult(m))
    .map(m => ({ home: m.home, away: m.away, h: m.score.home, a: m.score.away }))
  const openPool = poolFixtures.filter(m => !countedIds.has(m.id))
    .map(m => {
      const { lambdaH, lambdaA } = goalRates(rating(m.home), rating(m.away))
      return { home: m.home, away: m.away, lambdaH, lambdaA }
    })

  // A match between two known teams: real score if played, else sampled goals.
  const playMatch = (codeH, codeA, phase) => {
    const real = realScore.get(`${phase}:${pairKey(codeH, codeA)}`)
    if (real) return { home: codeH, away: codeA, h: real[codeH], a: real[codeA] }
    const { lambdaH, lambdaA } = goalRates(rating(codeH), rating(codeA))
    return { home: codeH, away: codeA, h: samplePoisson(lambdaH, rng), a: samplePoisson(lambdaA, rng) }
  }

  // A knockout tie: real winner if played, else sample regulation + shootout.
  const resolveKO = (codeH, codeA, phase) => {
    const real = realWinner.get(`${phase}:${pairKey(codeH, codeA)}`)
    if (real) return real
    const pub = publishedAdvance.get(`${phase}:${pairKey(codeH, codeA)}`)
    if (pub != null) {
      // Stored in the pairing's published orientation; flip it when the
      // bracket sends the sides through the other way round.
      return rng() < (pub.home === codeH ? pub.p : 1 - pub.p) ? codeH : codeA
    }
    const { lambdaH, lambdaA } = goalRates(rating(codeH), rating(codeA))
    const h = samplePoisson(lambdaH, rng), a = samplePoisson(lambdaA, rng)
    if (h !== a) return h > a ? codeH : codeA
    const edge = 0.5 + Math.max(-0.06, Math.min(0.06, (rating(codeH) - rating(codeA)) / MODEL_PARAMS.shootoutSlope))
    return rng() < edge ? codeH : codeA
  }

  for (let run = 0; run < runs; run++) {
    // Tie-break keys: one draw per team, in fixed order, reused across every
    // pool table this run so the RNG stream never depends on sort internals.
    const tb = new Map()
    for (const [, codes] of poolTeams) for (const c of codes) tb.set(c, rng())

    // ── Stage 1: pools A–D ──────────────────────────────────────────────────
    const stage1 = [...fixedPool]
    for (const m of openPool) stage1.push({ home: m.home, away: m.away, h: samplePoisson(m.lambdaH, rng), a: samplePoisson(m.lambdaA, rng) })
    const stage1By = new Map()
    for (const m of stage1) stage1By.set(pairKey(m.home, m.away), m)

    const place1 = new Map() // pool letter -> [1st,2nd,3rd,4th] codes
    for (const [pool, codes] of poolTeams) {
      place1.set(pool, poolPlacement(codes, stage1.filter(m => codes.includes(m.home) && codes.includes(m.away)), tb))
    }

    // ── Stage 2: pools E/F/G/H, carrying same-pool head-to-head forward ─────
    const place2 = new Map()
    const members2 = new Map()
    for (const [s2, slots] of Object.entries(STAGE2)) {
      const codes = slots.map(([p, i]) => place1.get(p)[i])
      members2.set(s2, codes)
      // carried-forward results: the two Stage-1 pairings whose teams share a pool
      const played = []
      for (let i = 0; i < codes.length; i++) {
        for (let j = i + 1; j < codes.length; j++) {
          const carried = stage1By.get(pairKey(codes[i], codes[j]))
          if (carried) played.push(carried)
          else played.push(playMatch(codes[i], codes[j], 'stage2'))
        }
      }
      place2.set(s2, poolPlacement(codes, played, tb))
    }

    const at = (pool, place) => place2.get(pool)[place]

    // Milestones: last-eight (into E/F) and semi-finalists (top two of E/F)
    for (const p of CHAMPIONSHIP_POOLS) for (const c of members2.get(p)) counts.get(c).top8++

    // ── Semis → medals ──────────────────────────────────────────────────────
    const sfWinners = [], sfLosers = []
    for (const s of SEMIS) {
      const h = at(s.home[0], s.home[1]), a = at(s.away[0], s.away[1])
      counts.get(h).sf++; counts.get(a).sf++
      const w = resolveKO(h, a, 'semi-final')
      sfWinners.push(w); sfLosers.push(w === h ? a : h)
    }
    counts.get(sfWinners[0]).final++; counts.get(sfWinners[1]).final++
    const champ = resolveKO(sfWinners[0], sfWinners[1], 'gold-final')
    counts.get(champ).champion++
    const bronze = resolveKO(sfLosers[0], sfLosers[1], 'bronze-final')
    counts.get(bronze).bronze++
  }

  const out = new Map()
  for (const [code, c] of counts) {
    out.set(code, {
      top8: c.top8 / runs, sf: c.sf / runs, final: c.final / runs,
      bronze: c.bronze / runs, champion: c.champion / runs,
    })
  }
  return { reach: out, runs, finishedCount: counted.length }
}

// ── Projected Stage-2 table ─────────────────────────────────────────────────
// A Stage-2 pool of four plays six pairings: the two carried forward from
// Stage 1 (the teams that shared a Stage-1 pool) and the four cross fixtures.
// Real results are used wherever they exist; each remaining pairing
// contributes its EXPECTED points and goals from the strength model, so the
// order degrades smoothly from projection to fact instead of flipping.
//
// This is the single ordering the bracket uses. Ranking the pool by rating
// alone — as this used to — produced a table on screen that disagreed with the
// semi-final slots drawn beneath it.
function projectPoolTable(codes, matches, rating) {
  const rows = new Map(codes.map(c => [c, {
    code: c, pts: 0, w: 0, gf: 0, ga: 0, gd: 0, played: 0, pending: 0,
  }]))
  const decided = new Set()

  for (const m of matches) {
    if (!hasResult(m)) continue
    if (m.phase !== 'pool' && m.phase !== 'stage2') continue
    const rh = rows.get(m.home), ra = rows.get(m.away)
    if (!rh || !ra) continue
    decided.add(pairKey(m.home, m.away))
    rh.played++; ra.played++
    rh.gf += m.score.home; rh.ga += m.score.away
    ra.gf += m.score.away; ra.ga += m.score.home
    if (m.score.home > m.score.away) { rh.pts += 3; rh.w++ }
    else if (m.score.home < m.score.away) { ra.pts += 3; ra.w++ }
    else { rh.pts++; ra.pts++ }
  }

  for (let i = 0; i < codes.length; i++) {
    for (let j = i + 1; j < codes.length; j++) {
      const x = codes[i], y = codes[j]
      if (decided.has(pairKey(x, y))) continue
      const rx = rows.get(x), ry = rows.get(y)
      const p = matchProbabilities(rating(x), rating(y))
      rx.pending++; ry.pending++
      rx.pts += 3 * p.home + p.draw; rx.w += p.home
      ry.pts += 3 * p.away + p.draw; ry.w += p.away
      rx.gf += p.lambdaH; rx.ga += p.lambdaA
      ry.gf += p.lambdaA; ry.ga += p.lambdaH
    }
  }

  for (const r of rows.values()) r.gd = r.gf - r.ga
  return [...rows.values()].sort((a, b) =>
    b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf ||
    rating(b.code) - rating(a.code) || a.code.localeCompare(b.code))
}

// ── Most-likely projected bracket (deterministic) for the Bracket view ───────
// Probabilities come from the Monte Carlo above; this projects the single most
// likely path — Stage-2 pools from current Stage-1 standings, each ranked by
// the projected table above — and locks slots as real results arrive.
export function projectBracket(teams, matches, standings) {
  const ratings = new Map(teams.map(t => [t.code, teamRating(t)]))
  const rating = c => ratings.get(c) ?? 1400
  const byPool1 = new Map(standings.map(p => [p.id, p.standings.map(r => r.team)]))
  const koById = new Map(matches.filter(m => m.phase !== 'pool').map(m => [m.id, m]))

  const stage1Done = new Map()
  for (const p of standings) {
    const pm = matches.filter(m => m.phase === 'pool' && m.pool === p.id)
    stage1Done.set(p.id, pm.length > 0 && pm.every(hasResult))
  }
  const allStage1Done = ['A', 'B', 'C', 'D'].every(p => stage1Done.get(p))

  // Projected Stage-2 pools from current Stage-1 order (provisional until pools finish)
  const stage2 = {}
  for (const [s2, slots] of Object.entries(STAGE2)) {
    stage2[s2] = {
      id: s2,
      championship: CHAMPIONSHIP_POOLS.includes(s2),
      locked: allStage1Done,
      teams: slots.map(([p, i]) => byPool1.get(p)?.[i] ?? null),
    }
  }
  // One table per Stage-2 pool, and it is the ONLY ordering used below — the
  // card the reader sees and the semi-final slots are the same list.
  for (const pool of Object.values(stage2)) {
    const codes = pool.teams.filter(Boolean)
    pool.entrants = pool.teams          // seeding order (1st A, 2nd A, 1st D, …)
    pool.table = codes.length ? projectPoolTable(codes, matches, rating) : []
    pool.complete = pool.table.length > 0 && pool.table.every(r => r.pending === 0)
    if (pool.table.length) pool.teams = pool.table.map(r => r.code)
  }
  const at = (pool, place) => stage2[pool]?.teams?.[place] ?? null

  const ties = []
  const winners = {}, losers = {}

  const makeTie = (id, label, group, codeH, codeA) => {
    const real = koById.get(id)
    const home = real && real.home !== 'TBD' ? real.home : codeH
    const away = real && real.away !== 'TBD' ? real.away : codeA
    const played = real ? hasResult(real) : false
    // Settled means the fixture itself names both teams — not merely that
    // Stage 1 finished. Stage 2 decides who plays these ties, so calling a
    // semi-final "locked" the moment the pools were drawn was a false claim
    // about a pairing the engine had guessed.
    const provisional = !played &&
      !(real && real.home !== 'TBD' && real.away !== 'TBD')
    let pHomeAdvance = null, winner = null
    if (played) {
      winner = realKnockoutWinner(real)
    } else if (home && away) {
      pHomeAdvance = matchProbabilitiesKO(rating(home), rating(away))
    }
    const tie = {
      id, label, group, home, away, played, winner,
      loser: winner ? (winner === home ? away : home) : null,
      locked: !provisional,
      pHomeAdvance,
      predicted: pHomeAdvance != null ? (pHomeAdvance >= 0.5 ? home : away) : winner,
      match: real ?? null,
    }
    if (winner) { winners[id] = winner; losers[id] = tie.loser }
    else if (tie.predicted) winners[id] = tie.predicted
    ties.push(tie)
    return tie
  }

  // Semi-finals
  makeTie('SF1', koById.get('SF1')?.label ?? 'Semi-Final', 'semi', at('E', 0), at('F', 1))
  makeTie('SF2', koById.get('SF2')?.label ?? 'Semi-Final', 'semi', at('F', 0), at('E', 1))

  makeTie('BRZ', koById.get('BRZ')?.label ?? 'Bronze Medal Match', 'medal',
    losers.SF1 ?? predictedLoser(ties, 'SF1'), losers.SF2 ?? predictedLoser(ties, 'SF2'))
  makeTie('GOLD', koById.get('GOLD')?.label ?? 'Gold Medal Match', 'medal', winners.SF1, winners.SF2)

  // Classification 5–16 (independent of the medal path)
  for (const c of CLASSIFICATION) {
    makeTie(c.id, koById.get(c.id)?.label ?? c.label, 'classification',
      at(c.home[0], c.home[1]), at(c.away[0], c.away[1]))
  }

  return { stage2, ties, byId: new Map(ties.map(t => [t.id, t])) }
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
