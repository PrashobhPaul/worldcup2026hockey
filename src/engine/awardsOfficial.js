// Hockey.AI — the official awards, and what this app's own stats named.
//
// The comparison here used to be against a list of names typed into
// content/awards.js before the tournament. That was wrong twice over: those
// names are not how this app names anyone, and reporting them as "the Oracle's
// pick" told readers the app had guessed five times and missed five times when
// it had done no such thing.
//
// The app names award winners from the record, by one ranking device — the
// Hockey.AI Player Index — applied to the pool each award is drawn from:
//
//   Player of the Tournament   highest index of any player
//   Top Scorer                 most goals (the FIH counts the same goals)
//   Best Goalkeeper            highest index among goalkeepers
//   Best Young Player          highest index among the rising-star pool
//   Fair Play                  fewest card points per match played
//
// Each basis is printed beside the name it produced, so a reader can check the
// claim rather than take it. Where the app's name and the FIH's differ, that is
// stated as a difference between two ways of measuring — not as a failed
// prediction, because naming the best player from the record is not a forecast.

import { isRising } from './bestXI.js'
import { CARD_WEIGHT, teamLedger } from './awards.js'

/** Names travel with and without accents; compare on the letters. */
export function sameName(a, b) {
  const flat = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '')
  return Boolean(a) && Boolean(b) && flat(a) === flat(b)
}

/** Nothing is compared against an award the FIH has not announced. */
export function officialAwards(doc) {
  return (doc?.awards ?? []).filter(a => a.winner)
}

const byIndex = (a, b) => (b.ai_rating ?? 0) - (a.ai_rating ?? 0) || a.name.localeCompare(b.name)
const rated = list => (list ?? []).filter(p => p.ai_rating != null)

/**
 * What this app's stats name for each award, with the basis that produced it.
 *
 * Every entry carries `basis` — the sentence the page prints under the name.
 * A pick with no stated basis would be exactly the unsourced claim this
 * function exists to remove.
 */
export function appNamed({ players, matches, startDate }) {
  const list = rated(players)
  const out = {}

  const top = [...list].sort(byIndex)[0]
  if (top) {
    out.best_player = { name: top.name, team: top.team, player: top,
      basis: `highest Hockey.AI Player Index of any player — ${top.ai_rating}` }
  }

  const scorers = (players ?? []).filter(p => (p.goals ?? 0) > 0)
    .sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0) || a.name.localeCompare(b.name))
  if (scorers[0]) {
    out.top_scorer = { name: scorers[0].name, team: scorers[0].team, player: scorers[0],
      basis: `most goals — ${scorers[0].goals}` }
  }

  const keeper = list.filter(p => (p.position_effective ?? p.position) === 'Goalkeeper')
    .sort(byIndex)[0]
  if (keeper) {
    out.best_goalkeeper = { name: keeper.name, team: keeper.team, player: keeper,
      basis: `highest Player Index among goalkeepers — ${keeper.ai_rating}` }
  }

  const rising = list.filter(p => isRising(p, startDate)).sort(byIndex)[0]
  if (rising) {
    const why = isRising(rising, startDate)
    out.rising_star = { name: rising.name, team: rising.team, player: rising,
      basis: `highest Player Index among the rising-star pool (${why.reason}) — ${rising.ai_rating}` }
  }

  // Fair play is a team award, scored per match played: a side that went
  // further is not punished for having been on the pitch longer.
  const ledger = teamLedger(matches, players)
  const teams = [...ledger.values()].filter(r => r.mp > 0)
    .map(r => ({ ...r, perMatch: r.cardPoints / r.mp }))
    .sort((a, b) => a.perMatch - b.perMatch || a.code.localeCompare(b.code))
  if (teams[0]) {
    out.fair_play = { name: teams[0].code, team: teams[0].code, teamRow: teams[0],
      basis: `fewest card points per match — ${teams[0].cards} card${teams[0].cards === 1 ? '' : 's'} `
        + `in ${teams[0].mp} (green ${CARD_WEIGHT.green}, yellow ${CARD_WEIGHT.yellow}, red ${CARD_WEIGHT.red})` }
  }

  return out
}

/**
 * One row per announced award: the FIH's winner beside this app's own name for
 * it, and whether the two agree.
 *
 * `agrees` is a comparison of two measurements, not a mark out of five.
 */
export function compareAwards(doc, named) {
  return officialAwards(doc).map(a => {
    const ours = named?.[a.key] ?? null
    const agrees = ours
      ? (a.kind === 'team' ? ours.team === a.team : sameName(ours.name, a.winner))
      : null
    return { ...a, display: a.winnerDisplay ?? a.winner, ours, agrees }
  })
}
