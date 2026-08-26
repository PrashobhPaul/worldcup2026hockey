// Hockey.AI — the exhibition the tournament never plays.
//
// Tournament's Best XI against the Rising Stars XI. Both sides used to be a
// hand-written table in `src/content/sim.js`: eleven names on each side, typed
// in before the competition started and never touched again. By the second week
// it was showing a Belgian keeper who did not travel, a captain who was not on
// any entry list, and a scoreline that no longer had anything to do with the
// players printed above it.
//
// So nothing here is written down. Both XIs are the engine's own selections —
// the same `tournamentXI` and `risingXI` the Tournament's Best tab draws — and
// every number on the page is computed from those two elevens and the match
// record behind them:
//
//   the goal rate      what a side actually scores per match at this World Cup
//   the strengths      the positional ratings of the eleven, by line
//   the scoreline      the likeliest result of the two, not a chosen one
//   the drivers        counted off the two team sheets, never asserted
//
// It is still a simulation and every surface says so. What it is not is
// fiction: a reader can check any figure on this page against the record.

import { tournamentXI, risingXI, xiRows } from './bestXI.js'

/** Both XIs line up 1-4-3-3, so the pitch draws the outfield as 4-3-3. */
export const SIM_FORMATION = '4-3-3'

/**
 * How much a rating advantage is allowed to move a scoreline.
 *
 * Ratings are percentile-based and sit in a narrow band, so the ratio between
 * two elevens is small — an exponent turns "slightly better" into a margin
 * without letting it run away. Three keeps the better side favoured and still
 * loses often enough that the sim is worth reading.
 */
const ELASTICITY = 3

/** Goals beyond this contribute nothing worth carrying. */
const MAX_GOALS = 10

/** What a line contributes to attacking and to defending the circle. */
const ATTACK = { Forward: 0.6, Midfielder: 0.4 }
const DEFENCE = { Defender: 0.7, Goalkeeper: 0.3 }

/** Goals per team per match across every completed match at this tournament. */
export function goalRate(matches) {
  const done = (matches ?? []).filter(m =>
    m.status === 'completed' && m.score?.home != null && m.score?.away != null)
  if (!done.length) return null
  const goals = done.reduce((s, m) => s + m.score.home + m.score.away, 0)
  return { rate: goals / (done.length * 2), goals, matches: done.length }
}

/** Weighted mean rating of the lines that do one job. */
function strength(rows, weights) {
  let num = 0
  let den = 0
  for (const [role, w] of Object.entries(weights)) {
    const line = rows.filter(r => r.role === role && r.rating != null)
    if (!line.length) continue
    num += w * (line.reduce((s, r) => s + r.rating, 0) / line.length)
    den += w
  }
  return den ? num / den : null
}

function pmf(lambda) {
  const out = []
  let term = Math.exp(-lambda)
  for (let k = 0; k <= MAX_GOALS; k++) {
    out.push(term)
    term = term * lambda / (k + 1)
  }
  return out
}

/**
 * The whole distribution, not one result: how often each side wins, and the
 * single scoreline that comes up more than any other.
 */
export function outcome(lambdaHome, lambdaAway) {
  const ph = pmf(lambdaHome)
  const pa = pmf(lambdaAway)
  let home = 0
  let draw = 0
  let away = 0
  let modal = null
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = ph[h] * pa[a]
      if (h > a) home += p
      else if (h === a) draw += p
      else away += p
      if (!modal || p > modal.p) modal = { home: h, away: a, p }
    }
  }
  const total = home + draw + away
  return {
    home: (home / total) * 100,
    draw: (draw / total) * 100,
    away: (away / total) * 100,
    modal,
  }
}

const mean = (rows, of) => {
  const vals = rows.map(of).filter(v => v != null)
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
}
const sum = (rows, of) => rows.reduce((s, r) => s + (of(r) ?? 0), 0)
/** The clear leader on a measure, or null when two players are level on it. */
const top = (rows, of) => {
  const ranked = rows.filter(r => (of(r) ?? 0) > 0).sort((a, b) => of(b) - of(a))
  if (!ranked.length) return null
  if (ranked.length > 1 && of(ranked[1]) === of(ranked[0])) return null
  return ranked[0]
}
const lineOf = (rows, role) => rows.filter(r => r.role === role)
const nameList = rows => rows.map(r => r.player).join(', ')
const one = (n, s, pl) => `${n} ${n === 1 ? s : pl ?? `${s}s`}`

/** Goals conceded per match, per nation, from the completed matches. */
function concededPerMatch(matches) {
  const ga = new Map()
  const mp = new Map()
  for (const m of matches ?? []) {
    if (m.status !== 'completed' || m.score?.home == null) continue
    ga.set(m.home, (ga.get(m.home) ?? 0) + m.score.away)
    ga.set(m.away, (ga.get(m.away) ?? 0) + m.score.home)
    mp.set(m.home, (mp.get(m.home) ?? 0) + 1)
    mp.set(m.away, (mp.get(m.away) ?? 0) + 1)
  }
  return code => (mp.get(code) ? ga.get(code) / mp.get(code) : null)
}

/**
 * The reasons the model gives the result it gives — each one a figure counted
 * off the two team sheets, with the names that produce it.
 *
 * These were four paragraphs of prose about players who are not in either XI.
 * A driver that cannot be recomputed from the sheet beside it is an opinion.
 */
function drivers(home, away, conceded) {
  const rows = []

  const hPc = sum(home, r => r.pcGoals)
  const aPc = sum(away, r => r.pcGoals)
  const hFlick = top(home, r => r.pcGoals)
  if (hPc || aPc) {
    rows.push({
      key: 'driver',
      title: 'Penalty-corner battery',
      detail: `The Best XI carry ${one(hPc, 'penalty-corner goal')} between them against `
        + `${one(aPc, 'penalty-corner goal')} for the Rising Stars`
        + (hFlick ? `, ${hFlick.player} alone accounting for ${hFlick.pcGoals}` : '')
        + `. Corners are the one routine a defence can rehearse for, and the model gives the `
        + `${hPc >= aPc ? 'Best XI' : 'Rising Stars'} the edge on it.`,
    })
  }

  const hMid = lineOf(home, 'Midfielder')
  const aMid = lineOf(away, 'Midfielder')
  const hMidR = mean(hMid, r => r.rating)
  const aMidR = mean(aMid, r => r.rating)
  if (hMidR != null && aMidR != null) {
    rows.push({
      key: 'driver',
      title: 'Midfield control',
      detail: `${nameList(hMid)} average ${hMidR.toFixed(1)} against ${aMidR.toFixed(1)} for `
        + `${nameList(aMid)}. The outletting lanes decide how often either circle is reached, `
        + `and a ${Math.abs(hMidR - aMidR).toFixed(1)}-point gap carries `
        + `${Math.round(ATTACK.Midfielder * 100)}% of the attacking strength this model reads, `
        + `the forward line the other ${Math.round(ATTACK.Forward * 100)}%.`,
    })
  }

  const hGk = lineOf(home, 'Goalkeeper')[0]
  const aGk = lineOf(away, 'Goalkeeper')[0]
  if (hGk && aGk) {
    const hGa = conceded(hGk.nat)
    const aGa = conceded(aGk.nat)
    rows.push({
      key: 'driver',
      title: 'Goalkeeping',
      detail: `${hGk.player} (${hGk.nat}, rated ${hGk.rating}) against ${aGk.player} `
        + `(${aGk.nat}, rated ${aGk.rating}).`
        + (hGa != null && aGa != null
          ? ` Their nations concede ${hGa.toFixed(2)} and ${aGa.toFixed(2)} per match at this `
            + `World Cup — the closest department on the sheet.`
          : ''),
    })
  }

  const hTal = top(home, r => r.goals)
  const aTal = top(away, r => r.goals)
  if (hTal && aTal) {
    rows.push({
      key: 'driver',
      title: 'Where the goals come from',
      detail: `${hTal.player} has scored ${one(hTal.goals, 'goal')} at this tournament and `
        + `${aTal.player} ${one(aTal.goals, 'goal')}. Between the two elevens that is `
        + `${sum(home, r => r.goals)} against ${sum(away, r => r.goals)} — the scoring the model `
        + `has to distribute across an exhibition neither side has played.`,
    })
  }

  return rows
}

function insights(home, away, result, base) {
  const rows = []
  const hCaps = mean(home, r => r.caps)
  const aCaps = mean(away, r => r.caps)
  if (hCaps != null && aCaps != null) {
    rows.push({
      key: 'insight',
      detail: `The Best XI arrived with ${Math.round(hCaps)} caps a man, the Rising Stars with `
        + `${Math.round(aCaps)}. Experience is not in the rating and not in this model — it is `
        + `the one advantage the favourites hold that the scoreline above does not count.`,
    })
  }
  rows.push({
    key: 'insight',
    detail: `Sides at this World Cup score ${base.rate.toFixed(2)} goals a match `
      + `(${base.goals} in ${base.matches} matches). That is the rate this exhibition starts `
      + `from; the ratings of the two elevens move it to ${result.lambdaHome.toFixed(2)} and `
      + `${result.lambdaAway.toFixed(2)}, and everything else on this page follows from those `
      + `two numbers.`,
  })
  // What this line says has to follow the number it quotes. It used to end
  // "nowhere near decisive" whatever came out above it, which read as reassurance
  // beside an 80–8 split.
  const upset = result.away + result.draw
  rows.push({
    key: 'insight',
    detail: `The Rising Stars take something from this fixture in ${upset.toFixed(0)}% of `
      + `outcomes — a win or a draw. `
      + (upset >= 33
        ? 'A single match is a thin filter: the favourites are favourites and it is nowhere near '
          + 'decisive over sixty minutes.'
        : 'The gap is wide enough that an upset needs the run of play as well as the corners, '
          + 'and the model hands the Best XI both.'),
  })
  return rows
}

/**
 * The simulation, end to end. Returns null until the record can support it —
 * an exhibition between two elevens the ratings have not picked yet is not
 * something to show a reader.
 */
export function simulate(players, matches) {
  const base = goalRate(matches)
  if (!base) return null
  const start = (matches ?? []).reduce((min, m) => (!min || m.date < min ? m.date : min), null)
  // Both selections are merit selections over the same field, so five names
  // came out in both elevens and the exhibition fielded Jakob Brilla against
  // Jakob Brilla. A player picked for the Best XI is not available to the other
  // side: the Rising Stars are the emerging players the Best XI did not take,
  // and the page says so. The Tournament's Best tab still shows the rising XI
  // whole — that selection answers a different question and is left alone.
  const picked = tournamentXI(players)
  const taken = new Set(picked.map(p => p.id))
  const home = xiRows(picked)
  const away = xiRows(start
    ? risingXI(players.filter(p => !taken.has(p.id)), new Date(`${start}T00:00:00Z`))
    : [])
  if (home.length < 11 || away.length < 11) return null

  const hAtt = strength(home, ATTACK)
  const hDef = strength(home, DEFENCE)
  const aAtt = strength(away, ATTACK)
  const aDef = strength(away, DEFENCE)
  if ([hAtt, hDef, aAtt, aDef].some(v => v == null)) return null

  const lambdaHome = base.rate * (hAtt / aDef) ** ELASTICITY
  const lambdaAway = base.rate * (aAtt / hDef) ** ELASTICITY
  const result = { ...outcome(lambdaHome, lambdaAway), lambdaHome, lambdaAway }
  const conceded = concededPerMatch(matches)

  return {
    home,
    away,
    base,
    strengths: { hAtt, hDef, aAtt, aDef },
    result,
    score: { home: result.modal.home, away: result.modal.away },
    decider: result.modal.home === result.modal.away ? 'FT · level' : 'FT',
    cards: [
      {
        key: 'confidence',
        title: result.home >= result.away ? "Tournament's Best XI win" : 'Rising Stars XI win',
        value: Math.round(Math.max(result.home, result.away)),
        detail: `Over the full distribution the Best XI win ${result.home.toFixed(1)}%, the `
          + `Rising Stars ${result.away.toFixed(1)}%, and ${result.draw.toFixed(1)}% finish level. `
          + `The likeliest single scoreline is ${result.modal.home}–${result.modal.away}, which `
          + `comes up in ${(result.modal.p * 100).toFixed(1)}% of them.`,
      },
      ...drivers(home, away, conceded),
      ...insights(home, away, result, base),
      {
        key: 'disclosure',
        detail: 'An Oracle-simulated exhibition, not a fixture. Both team sheets are the engine’s '
          + 'own selections from this tournament’s positional ratings, and every player named is on '
          + 'an official FIH team list. Nobody plays twice: the Best XI picks first, and the Rising '
          + 'Stars here are the emerging players it did not take, so this side is narrower than the '
          + 'Rising Stars XI on the Tournament’s Best tab. The scoreline is the most likely result '
          + 'of a Poisson model built from the tournament’s own goal rate and the two elevens’ '
          + 'ratings — not a prediction, and no FIH endorsement is implied.',
      },
    ],
  }
}
