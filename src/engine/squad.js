// Hockey.AI — the tournament squads: a Best XV and a Rising XV.
//
// The old selection took the top one, four, three and three names off the
// rating boards and called it a team. That is a leaderboard, not a side, and
// it showed: three of the eleven had started one match or fewer between them,
// one of them had never started at all, and four came from nations knocked out
// in the pools.
//
// A team is picked by what each shirt is for. This module picks role by role,
// on the component that defines the role rather than on the aggregate rating:
//
//   keeper        the side's record while he was actually on the pitch
//   the battery   penalty-corner conversion — the routine every defence fears
//   the anchors   fewest conceded per match started
//   midfield      goal value and the workload a coach trusted them with
//   the talisman  the largest share of his own side's goals
//   the finishers field goals per appearance
//
// Two rules bound the field, and both come out of the record rather than a
// list written here: every pick comes from the eight nations still standing
// after the crossover pools, and the eleven is weighted to the four
// semi-finalists. A best XI of a World Cup that fields four players from
// nations eliminated in the pools is not describing that World Cup.

import { isAtTournament, roleOf, LINES } from './bestXI.js'
import { ageOn } from './awards.js'

/** How many of the XI must come from the four semi-finalists. */
export const SEMI_SHARE = { min: 8, max: 9 }

/**
 * The bench: a cover keeper, then the best of the rest whatever line they play.
 *
 * One reserve per line was tried and no rising squad could be filled at any
 * age or scope — the record names four under-23 defenders in the whole
 * tournament and an XI already needs four. Hockey substitutes roll on and off
 * continuously anyway; the one place cover is genuinely non-negotiable is in
 * goal, and that is the only line this reserves.
 */
export const BENCH_SIZE = 4

/**
 * The elite field, read off the record rather than written down.
 *
 * The top eight are the nations that reached the crossover pools; the
 * semi-finalists are the four the semi-final fixtures name, and before those
 * fixtures are populated, the top two of each crossover pool on the table.
 */
export function eliteTiers(matches, standingsOf) {
  const topEight = new Set()
  for (const m of matches ?? []) {
    if (m.phase !== 'stage2') continue
    if (m.pool === 'E' || m.pool === 'F') { topEight.add(m.home); topEight.add(m.away) }
  }
  const semifinalists = new Set()
  for (const m of matches ?? []) {
    if (m.phase !== 'semi-final') continue
    for (const code of [m.home, m.away]) if (code && code !== 'TBD') semifinalists.add(code)
  }
  if (semifinalists.size < 4 && typeof standingsOf === 'function') {
    for (const pool of ['E', 'F']) {
      for (const row of (standingsOf(pool) ?? []).slice(0, 2)) semifinalists.add(row.code ?? row)
    }
  }
  return { topEight, semifinalists }
}

/** A component's percentile for one player, or null when he was not scored on it. */
export const componentScore = (p, key) => p?.rating_components?.[key]?.score ?? null

/** A component's raw figure — the countable fact behind the percentile. */
export const componentRaw = (p, key) => p?.rating_components?.[key]?.raw ?? null

const byDesc = (...keys) => (a, b) => {
  for (const k of keys) {
    const d = (k(b) ?? -Infinity) - (k(a) ?? -Infinity)
    if (d) return d
  }
  return a.name.localeCompare(b.name)
}

/**
 * The slots of a 1-4-3-3, each with the question it answers and the component
 * that answers it. `rank` orders the candidates for that shirt; the rating
 * breaks ties, so two players level on the defining component are separated by
 * everything else they did.
 *
 * Every slot but the keeper's carries a starts floor. A rate stat over a
 * handful of substitute cameos can still read as elite after shrinkage —
 * Will Calnan started none of England's matches and came on to score two,
 * which put his goal value ahead of every starting midfielder in the top
 * eight — and a coach does not hand the shirt that answers "who wins us the
 * match" to a man who has not started one. The floor is soft: a line with
 * nobody past it falls back to the full pool rather than leaving the shirt
 * empty, exactly as the drag-flick shirt already did for a corner nobody
 * had scored.
 */
const STARTED_FLOOR = 2
const hasStarted = p => (p.starts ?? 0) >= STARTED_FLOOR

export const SLOTS = [
  {
    // The one shirt where the rating IS the role measure: a keeper is rated on
    // his side's record while he was on the pitch, his clean sheets and the
    // matches he was trusted with, and nothing else. Ranking this slot on a
    // single one of those threw the other two away and left the tournament's
    // best goalkeeper on the bench.
    key: 'keeper', role: 'Goalkeeper', label: 'Goalkeeper',
    why: 'the side’s record while he was on the pitch',
    rank: byDesc(p => p.ai_rating, p => componentScore(p, 'on_pitch_defence')),
  },
  {
    key: 'battery', role: 'Defender', label: 'Drag flick', count: 2,
    why: 'penalty corners and strokes converted',
    rank: byDesc(p => componentScore(p, 'set_piece'), p => p.ai_rating),
    require: p => hasStarted(p) && (componentRaw(p, 'set_piece') ?? 0) > 0,
  },
  {
    key: 'anchor', role: 'Defender', label: 'Defensive anchor', count: 2,
    why: 'fewest conceded per match started',
    rank: byDesc(p => componentScore(p, 'on_pitch_defence'), p => p.ai_rating),
    require: hasStarted,
  },
  // The specialist picks before the generalist, in every line. Filling two
  // engine shirts first took the midfielder with the best goal value into one
  // of them and left the match-winner's shirt to whoever was left.
  {
    key: 'creator', role: 'Midfielder', label: 'Match winner',
    why: 'goals weighted by what they were worth',
    rank: byDesc(p => componentScore(p, 'goal_value'), p => p.ai_rating),
    require: hasStarted,
  },
  {
    key: 'engine', role: 'Midfielder', label: 'Engine', count: 2,
    why: 'the workload a coach trusted him with',
    rank: byDesc(p => componentScore(p, 'workload'), p => p.ai_rating),
    require: hasStarted,
  },
  {
    key: 'talisman', role: 'Forward', label: 'Talisman',
    why: 'the largest share of his own side’s goals',
    rank: byDesc(p => componentScore(p, 'talisman'), p => p.ai_rating),
    require: hasStarted,
  },
  {
    key: 'finisher', role: 'Forward', label: 'Finisher', count: 2,
    why: 'field goals per appearance',
    rank: byDesc(p => componentScore(p, 'finishing'), p => p.ai_rating),
    require: hasStarted,
  },
]

const lineOf = role => LINES.find(l => l.role === role)

/**
 * Pick a squad of fifteen from one eligible field.
 *
 * Returns {xi, bench, squad, semiCount, shortfall} where every entry carries
 * the slot it fills and the figure that won it the shirt.
 */
export function pickSquad(players, { topEight, semifinalists, eligible = () => true } = {}) {
  const field = (players ?? []).filter(p =>
    isAtTournament(p) && p.ai_rating != null && eligible(p) &&
    (!topEight || topEight.has(p.team)))

  const taken = new Set()
  const inRole = role => field.filter(p => roleOf(p).role === role && !taken.has(p.id))

  const xi = []
  for (const slot of SLOTS) {
    const want = slot.count ?? 1
    for (let n = 0; n < want; n++) {
      let pool = inRole(slot.role)
      const strict = slot.require ? pool.filter(slot.require) : pool
      // A slot with a hard requirement falls back to the rest of its line
      // rather than fielding ten men: a World Cup where nobody in the back
      // four has scored a corner is possible, and the shirt still says which
      // question it was filled on.
      let chosen = (strict.length ? strict : pool).sort(slot.rank)[0]
      // And a line that runs out of bodies falls back to the players the FIH
      // gives no line to at all. The entry list names a position for 48 of 320
      // entrants, so this is a real shortage rather than a rare one: the
      // rising side has three under-23 defenders left once the Best XI has
      // taken one, and an XI needs four. The shirt is marked off-role and the
      // page says so, exactly as a team's own best XI has always done.
      let offRole = false
      if (!chosen) {
        chosen = field
          .filter(p => !taken.has(p.id) && !roleOf(p).role &&
            (p.rating_group === 'Outfield') && slot.role !== 'Goalkeeper')
          .sort(byDesc(p => p.ai_rating))[0]
        offRole = !!chosen
      }
      if (!chosen) continue
      taken.add(chosen.id)
      xi.push({
        ...chosen, slot, line: lineOf(slot.role),
        fallback: !strict.length, offRole,
      })
    }
  }

  const balanced = rebalance(xi, field, taken, semifinalists)

  const bench = []
  const addBench = (p, label, why) => {
    taken.add(p.id)
    bench.push({ ...p, slot: { key: 'bench', label, why }, line: lineOf(roleOf(p).role) })
  }
  // One per line where the record allows it, then the best of the rest.
  // Best-of-the-rest alone put a keeper and three defenders on the bench of a
  // side already fielding four — cover that covers nothing. Trying for balance
  // first and filling the gaps afterwards keeps a full fifteen even in the
  // rising squad, where the whole tournament holds four under-23 defenders.
  for (const role of ['Goalkeeper', 'Midfielder', 'Forward', 'Defender']) {
    if (bench.length >= BENCH_SIZE) break
    const p = inRole(role).sort(byDesc(x => x.ai_rating))[0]
    if (p) addBench(p, `${lineOf(role)?.short ?? 'SUB'} cover`, `the best ${role.toLowerCase()} not starting`)
  }
  // Never a second reserve keeper: one is cover, two is a wasted shirt. The
  // rising bench reached for one because the record holds no under-23
  // defenders left to take.
  const rest = field
    .filter(p => !taken.has(p.id) && roleOf(p).role && roleOf(p).role !== 'Goalkeeper')
    .sort(byDesc(p => p.ai_rating))
  for (const p of rest.slice(0, BENCH_SIZE - bench.length)) {
    addBench(p, `${lineOf(roleOf(p).role)?.short ?? 'SUB'} bench`, 'highest rated of the rest')
  }

  const semiCount = semifinalists
    ? balanced.filter(p => semifinalists.has(p.team)).length : null
  return {
    xi: balanced,
    bench,
    squad: [...balanced, ...bench],
    semiCount,
    shortfall: balanced.length < 11 || bench.length < BENCH_SIZE,
  }
}

/**
 * Weight the eleven towards the four semi-finalists.
 *
 * Swaps happen inside a line and inside a slot, so the shape and the reason
 * for every shirt survive: the weakest non-semi-finalist pick gives way to the
 * best semi-finalist available for that same shirt, and only while doing so
 * actually improves the count.
 */
function rebalance(xi, field, taken, semifinalists) {
  if (!semifinalists) return xi
  const out = [...xi]
  const count = () => out.filter(p => semifinalists.has(p.team)).length

  let guard = 0
  while (count() < SEMI_SHARE.min && guard++ < 20) {
    let best = null
    for (let i = 0; i < out.length; i++) {
      const held = out[i]
      if (semifinalists.has(held.team)) continue
      const slot = held.slot
      const cand = field
        .filter(p => semifinalists.has(p.team) && !taken.has(p.id) &&
          roleOf(p).role === slot.role)
        .sort(slot.rank)[0]
      if (!cand) continue
      // Give up the least: the swap that costs the fewest rating points.
      const cost = (held.ai_rating ?? 0) - (cand.ai_rating ?? 0)
      if (!best || cost < best.cost) best = { i, cand, cost, slot, held }
    }
    if (!best) break
    taken.delete(best.held.id)
    taken.add(best.cand.id)
    out[best.i] = {
      ...best.cand, slot: best.slot, line: lineOf(best.slot.role),
      swappedFor: best.held.name,
    }
  }
  return out
}

/**
 * The rising squad: this tournament's emerging players, fifteen of them.
 *
 * Under-23 from the top eight nations is the intent, and the record does not
 * allow it. The ladder below tries the strictest rule first and steps down one
 * rung at a time, only ever because the rung above cannot field a side — and
 * the rung it landed on is published beside the squad, with the count that
 * forced it, so the rule is never quietly relaxed.
 *
 *   age 22, top eight   11 players, no goalkeeper and no midfielder
 *   age 22, all nations 33 players, three defenders where four are needed
 *   age 23, top eight   23 players, two of each outfield line
 *   age 23, all nations fills all fifteen
 *
 * Age is the strict rule and the reason the selection exists, so it is the
 * last thing to give: the field widens before the ceiling lifts.
 */
export const RISING_LADDER = [
  { maxAge: 22, topEightOnly: true },
  { maxAge: 22, topEightOnly: false },
  { maxAge: 23, topEightOnly: true },
  { maxAge: 23, topEightOnly: false },
]

export function risingAge(player, startDate) {
  return ageOn(player?.dob, startDate)
}

/**
 * {squad, xi, bench, rung, tried} — the first rung of the ladder that fields
 * fifteen, and every rung it had to step past to get there.
 */
export function pickRisingSquad(players, startDate, { topEight, requireBench = true } = {}) {
  const tried = []
  for (const rung of RISING_LADDER) {
    const picked = pickSquad(players, {
      topEight: rung.topEightOnly ? topEight : null,
      // A rising side is not weighted towards the semi-finalists: the question
      // is who is emerging, not who went furthest.
      semifinalists: null,
      eligible: p => {
        const age = risingAge(p, startDate)
        return age != null && age <= rung.maxAge
      },
    })
    const field = (players ?? []).filter(p =>
      isAtTournament(p) && p.ai_rating != null &&
      (!rung.topEightOnly || !topEight || topEight.has(p.team)) &&
      (risingAge(p, startDate) ?? 99) <= rung.maxAge)
    tried.push({ ...rung, field: field.length, filled: picked.squad.length })
    // The exhibition needs an eleven, not a squad: it fields the Best XI's
    // leftovers, so a full bench is often out of reach and refusing to pick at
    // all left the simulation blank.
    const enough = requireBench ? !picked.shortfall : picked.xi.length >= 11
    if (enough) return { ...picked, rung, tried }
  }
  return { xi: [], bench: [], squad: [], rung: null, tried, shortfall: true }
}
