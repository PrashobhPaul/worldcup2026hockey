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

import { xiRows, bestXI } from './bestXI.js'
import { eliteTiers, pickSquad, pickRisingSquad } from './squad.js'
import { SIM_ID } from '../content/sim.js'

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
// A side's name opens several of these sentences, and the names carry their
// own article — "the World XI", "the Rising Stars" — so the capital has to be
// applied here rather than written into the label.
const Cap = t => (t ? t[0].toUpperCase() + t.slice(1) : t)
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
function drivers(home, away, conceded, L) {
  const rows = []

  const hPc = sum(home, r => r.pcGoals)
  const aPc = sum(away, r => r.pcGoals)
  const hFlick = top(home, r => r.pcGoals)
  if (hPc || aPc) {
    rows.push({
      key: 'driver',
      title: 'Penalty-corner battery',
      detail: `${Cap(L.home)} carry ${one(hPc, 'penalty-corner goal')} between them against `
        + `${one(aPc, 'penalty-corner goal')} for ${L.away}`
        + (hFlick ? `, ${hFlick.player} alone accounting for ${hFlick.pcGoals}` : '')
        + `. Corners are the one routine a defence can rehearse for, and the model gives the `
        + `${hPc >= aPc ? L.home : L.away} the edge on it.`,
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

function insights(home, away, result, base, L) {
  const rows = []
  const hCaps = mean(home, r => r.caps)
  const aCaps = mean(away, r => r.caps)
  if (hCaps != null && aCaps != null) {
    rows.push({
      key: 'insight',
      detail: `${Cap(L.home)} arrived with ${Math.round(hCaps)} caps a man, ${L.away} with `
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
    detail: `${Cap(L.away)} take something from this fixture in ${upset.toFixed(1)}% of `
      + `outcomes — a win or a draw. `
      + (upset >= 33
        ? 'A single match is a thin filter: the favourites are favourites and it is nowhere near '
          + 'decisive over sixty minutes.'
        : 'The gap is wide enough that an upset needs the run of play as well as the corners, '
          + `and the model hands ${L.home} both.`),
  })
  return rows
}

/**
 * The simulation, end to end. Returns null until the record can support it —
 * an exhibition between two elevens the ratings have not picked yet is not
 * something to show a reader.
 */
/**
 * One exhibition between two elevens already picked, end to end.
 *
 * The two sides and what they are called come in; every number goes out. It is
 * the same arithmetic whichever two elevens are handed to it, which is what
 * lets the Best XI meet the Rising Stars and each semi-finalist through one
 * code path rather than several that could drift apart.
 */
export function playExhibition({ home, away, base, matches, labels, disclosure }) {
  if (!base || home.length < 11 || away.length < 11) return null
  const L = labels
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
    labels: L,
    strengths: { hAtt, hDef, aAtt, aDef },
    result,
    score: { home: result.modal.home, away: result.modal.away },
    decider: result.modal.home === result.modal.away ? 'FT · level' : 'FT',
    cards: [
      {
        key: 'confidence',
        title: `${Cap(result.home >= result.away ? L.home : L.away)} win`,
        value: Math.round(Math.max(result.home, result.away)),
        detail: `Over the full distribution ${L.home} win ${result.home.toFixed(1)}%, `
          + `${L.away} ${result.away.toFixed(1)}%, and ${result.draw.toFixed(1)}% finish level. `
          + `The likeliest single scoreline is ${result.modal.home}–${result.modal.away}, which `
          + `comes up in ${(result.modal.p * 100).toFixed(1)}% of them.`,
      },
      ...drivers(home, away, conceded, L),
      ...insights(home, away, result, base, L),
      { key: 'disclosure', detail: disclosure },
    ],
  }
}

const RISING_DISCLOSURE =
  'An Oracle-simulated exhibition, not a fixture and not a prediction — no FIH '
  + 'endorsement implied. Every player named is on an official FIH team list; the Best XI '
  + 'picks first, so this Rising Stars side is narrower than the Rising Stars XI on the '
  + 'Tournament\u2019s Best tab.'

const nationDisclosure = name =>
  'An Oracle-simulated exhibition, not a fixture and not a prediction — no FIH '
  + `endorsement implied. No ${name} player appears in the World XI: a man turns out for his `
  + 'country, never against it, so the eleven he would have taken a shirt in is picked without '
  + 'him. Every player named is on an official FIH team list.'

/**
 * The simulation the AI Lab has always shown: Tournament's Best XI against the
 * Rising Stars XI. Returns null until the record can support it — an exhibition
 * between two elevens the ratings have not picked yet is not something to show.
 */
export function simulate(players, matches) {
  const base = goalRate(matches)
  if (!base) return null
  const start = (matches ?? []).reduce((min, m) => (!min || m.date < min ? m.date : min), null)
  // Both sides are the squads the Tournament's Best tab draws, picked shirt by
  // shirt on the components that define each role. They are selected over the
  // same field, so a name can come out in both — the Best XI picks first and
  // the Rising Stars are the emerging players it did not take, which the page
  // states. The Tournament's Best tab still shows the rising XV whole, because
  // that selection answers a different question.
  const tiers = eliteTiers(matches)
  const bestSquad = pickSquad(players, tiers)
  const taken = new Set(bestSquad.squad.map(p => p.id))
  const risingSquad = start
    ? pickRisingSquad(players.filter(p => !taken.has(p.id)),
                      new Date(`${start}T00:00:00Z`), { ...tiers, requireBench: false })
    : { xi: [], shortfall: true }
  return playExhibition({
    home: xiRows(bestSquad.xi),
    away: xiRows(risingSquad.xi),
    base,
    matches,
    labels: { home: "the Tournament's Best XI", away: 'the Rising Stars' },
    disclosure: RISING_DISCLOSURE,
  })
}

/**
 * The World XI against a nation, that nation excluded from it.
 *
 * A player turns out for his country, never against it, so the World XI for
 * this fixture is picked over a field the nation has been removed from. That
 * is the whole point of running one of these per opponent rather than picking
 * a single eleven and sending it out four times: leaving Germany out of the
 * World XI is what makes "the world against the champions" mean anything.
 */
export function exhibitionVsNation(players, matches, code, teamName) {
  const base = goalRate(matches)
  if (!base) return null
  const tiers = eliteTiers(matches)
  const world = pickSquad(players, { ...tiers, eligible: p => p.team !== code })
  const nation = bestXI(players.filter(p => p.team === code))
  const nationXI = nation.lines.flatMap(l => l.slots.map(s => ({ ...s.player, line: l })))
  return playExhibition({
    home: xiRows(world.xi),
    away: xiRows(nationXI),
    base,
    matches,
    labels: { home: 'the World XI', away: teamName },
    disclosure: nationDisclosure(teamName),
  })
}

/**
 * Every exhibition the app shows, in the order it shows them.
 *
 * The four semi-finalists each meet a World XI picked without them, and the
 * champions' fixture leads — it is the one a reader comes for once the
 * tournament is over. The Rising Stars meeting closes the set: it asks a
 * different question and is the only one that does not exclude anybody.
 */
export function exhibitions(players, matches, teams) {
  const nameOf = code => (teams ?? []).find(t => t.code === code)?.name ?? code
  const tiers = eliteTiers(matches)
  const champion = championOf(matches)
  const order = [...tiers.semifinalists].sort((a, b) =>
    (b === champion) - (a === champion) || nameOf(a).localeCompare(nameOf(b)))

  const out = []
  for (const code of order) {
    const sim = exhibitionVsNation(players, matches, code, nameOf(code))
    if (!sim) continue
    out.push({
      id: `sim_world_xi_vs_${code.toLowerCase()}`,
      kind: 'nation',
      opponent: code,
      opponentName: nameOf(code),
      champion: code === champion,
      homeLabel: `World XI (no ${code})`,
      awayLabel: nameOf(code),
      homeShort: 'WORLD',
      awayShort: code,
      sim,
    })
  }
  const rising = simulate(players, matches)
  if (rising) {
    out.push({
      id: SIM_ID,
      kind: 'rising',
      champion: false,
      homeLabel: "Tournament's Best XI",
      awayLabel: 'Rising Stars XI',
      homeShort: 'BEST',
      awayShort: 'RISE',
      sim: rising,
    })
  }
  return out
}

/** Who lifted it, or null while the final is unplayed. */
export function championOf(matches) {
  const final = (matches ?? []).find(m => m.phase === 'gold-final')
  if (!final || final.status !== 'completed' || final.score?.home == null) return null
  if (final.score.home === final.score.away) {
    const so = final.shootout
    if (!so || so.home === so.away) return null
    return so.home > so.away ? final.home : final.away
  }
  return final.score.home > final.score.away ? final.home : final.away
}
