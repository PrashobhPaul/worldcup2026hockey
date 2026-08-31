// Hockey.AI — the one place an award winner is named.
//
// These are the app's own rules for naming award winners from the record.
// They lived in two places and had drifted: engine/awards.js scored Player of
// the Tournament off the race softmax and Best Goalkeeper off goals conceded
// alone, while the awards page scored both off the Player Index. Two
// definitions of one quantity is the fault this repository keeps removing, so
// there is now one, here, and both callers read it.
//
//   Player of the Tournament   Player Index and tournament goals, equal weight
//   Top Scorer                 most goals
//   Best Goalkeeper            Player Index, clean sheets and goals conceded
//                              per match, equal weight
//   Best Young Player          highest Player Index among players under 21
//   Fair Play                  fewest card points per match played
//
// ON "EQUAL WEIGHT". An index out of 100 and a goal tally in single figures
// cannot be added as they stand — whichever has the larger numbers would decide
// every case on its own, and the weighting would be equal in name only. Each
// component is therefore divided by the best value any eligible player posted
// for it, putting all of them on 0…1 before they are averaged. That is what
// makes the weights actually equal.
//
// Nothing here is tuned. The rules were stated as the app's own definitions and
// implemented as stated; where the name they produce matches the FIH's, that is
// an outcome and not a target. Fitting these weights until the names agreed
// would make every one of them worthless as a claim.

import { ageOn, cardPoints, teamLedger } from './awards.js'

/** Under-21 is the rising-star pool: below 21 on the day the tournament began. */
export const RISING_STAR_UNDER = 21

/** Divide by the best figure anyone posted, so components share one scale. */
const norm = (v, max) => (max > 0 ? v / max : 0)
const rated = list => (list ?? []).filter(p => p.ai_rating != null)
const goalsOf = p => p.goals ?? 0

/** Clean sheets and goals conceded belong to the team a keeper plays behind. */
export function keeperContext(matches, players) {
  const ledger = teamLedger(matches, players)
  const done = (matches ?? []).filter(
    m => m.status === 'completed' && m.score?.home != null)
  const clean = new Map()
  for (const m of done) {
    if (m.score.away === 0) clean.set(m.home, (clean.get(m.home) ?? 0) + 1)
    if (m.score.home === 0) clean.set(m.away, (clean.get(m.away) ?? 0) + 1)
  }
  return { ledger, clean }
}

/**
 * Player of the Tournament: Player Index and goals, equally weighted.
 *
 * Returns every candidate scored and ordered, so a caller can show the chasers
 * rather than only the winner.
 */
export function playerOfTournament(players) {
  const list = rated(players)
  if (!list.length) return []
  const maxIndex = Math.max(...list.map(p => p.ai_rating))
  const maxGoals = Math.max(...list.map(goalsOf))
  return list
    .map(p => ({
      player: p,
      score: (norm(p.ai_rating, maxIndex) + norm(goalsOf(p), maxGoals)) / 2,
      parts: { index: p.ai_rating, goals: goalsOf(p) },
    }))
    .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))
}

/** Top scorer: goals, and nothing else. The FIH counts the same goals. */
export function topScorer(players) {
  return (players ?? []).filter(p => goalsOf(p) > 0)
    .sort((a, b) => goalsOf(b) - goalsOf(a) || a.name.localeCompare(b.name))
    .map(p => ({ player: p, score: goalsOf(p), parts: { goals: goalsOf(p) } }))
}

/**
 * Best goalkeeper: Player Index, clean sheets and goals conceded per match,
 * equally weighted. Conceding fewer is better, so that component is inverted
 * before it is averaged.
 *
 * Per match rather than in total: a keeper whose side reached the final has
 * been on the pitch longer than one whose side went out in the pools, and
 * should not be marked down for it. Two keepers of the same nation share the
 * team figures, and the index is what separates them.
 */
export function bestGoalkeeper(players, matches) {
  const { ledger, clean } = keeperContext(matches, players)
  const gks = rated(players)
    .filter(p => (p.position_effective ?? p.position) === 'Goalkeeper')
    .map(p => {
      const row = ledger.get(p.team)
      if (!row || !row.mp) return null
      return { player: p, index: p.ai_rating, cleanSheets: clean.get(p.team) ?? 0,
               gaPerMatch: row.ga / row.mp, mp: row.mp }
    })
    .filter(Boolean)
  if (!gks.length) return []
  const maxIndex = Math.max(...gks.map(g => g.index))
  const maxClean = Math.max(...gks.map(g => g.cleanSheets))
  const maxGa = Math.max(...gks.map(g => g.gaPerMatch))
  return gks
    .map(g => ({
      player: g.player,
      score: (norm(g.index, maxIndex) + norm(g.cleanSheets, maxClean)
              + (maxGa > 0 ? 1 - g.gaPerMatch / maxGa : 0)) / 3,
      parts: { index: g.index, cleanSheets: g.cleanSheets, gaPerMatch: g.gaPerMatch },
    }))
    .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))
}

/** Best young player: highest Player Index among players under 21. */
export function risingStar(players, startDate) {
  return rated(players)
    .map(p => ({ player: p, age: ageOn(p.dob, startDate) }))
    .filter(r => r.age != null && r.age < RISING_STAR_UNDER)
    .sort((a, b) => b.player.ai_rating - a.player.ai_rating
      || a.player.name.localeCompare(b.player.name))
    .map(r => ({ player: r.player, score: r.player.ai_rating,
                 parts: { index: r.player.ai_rating, age: r.age } }))
}

/**
 * Fair play: fewest card points per match played.
 *
 * Per match for the same reason as the keeper figures, and by points rather
 * than by count because a red and a green are not the same offence — the
 * weights are engine/awards.js's CARD_WEIGHT.
 */
export function fairPlay(matches, players) {
  const ledger = teamLedger(matches, players)
  return [...ledger.values()]
    .filter(r => r.mp > 0)
    .map(r => ({ team: r, score: -(r.cardPoints / r.mp),
                 parts: { cards: r.cards, points: r.cardPoints, mp: r.mp,
                          perMatch: r.cardPoints / r.mp } }))
    .sort((a, b) => b.score - a.score || a.team.code.localeCompare(b.team.code))
}

export { cardPoints }
