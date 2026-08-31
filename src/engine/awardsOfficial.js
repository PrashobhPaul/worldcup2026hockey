// Hockey.AI — the official awards, and what this app's own stats named.
//
// The comparison here used to be against a list of names typed into
// content/awards.js before the tournament. That was wrong twice over: those
// names are not how this app names anyone, and reporting them as "the Oracle's
// pick" told readers the app had guessed five times and missed five times when
// it had done no such thing.
//
// The rules that name a winner are in engine/awardRules.js — one definition,
// read by this file and by engine/awards.js, because they were two and had
// drifted. This file only turns a winner into the sentence the page prints
// beneath the name, and compares that name with the FIH's.
//
// Where the two differ, that is stated as a difference between two ways of
// measuring — not as a failed prediction, because naming the best player from
// a finished record is a measurement rather than a forecast.

import {
  playerOfTournament, topScorer, bestGoalkeeper, risingStar, fairPlay, RISING_STAR_UNDER,
} from './awardRules.js'
import { CARD_WEIGHT } from './awards.js'

/** Names travel with and without accents; compare on the letters. */
export function sameName(a, b) {
  const flat = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z]/g, '')
  return Boolean(a) && Boolean(b) && flat(a) === flat(b)
}

/** Nothing is compared against an award the FIH has not announced. */
export function officialAwards(doc) {
  return (doc?.awards ?? []).filter(a => a.winner)
}

const one = d => (Number.isInteger(d) ? d : Number(d).toFixed(2))

/**
 * What this app's stats name for each award, with the basis that produced it.
 *
 * Every rule lives in engine/awardRules.js and nowhere else; this only turns
 * each winner into the sentence the page prints under the name. A pick with no
 * stated basis would be exactly the unsourced claim this function exists to
 * remove.
 */
export function appNamed({ players, matches, startDate }) {
  const out = {}

  const potm = playerOfTournament(players)[0]
  if (potm) {
    out.best_player = { name: potm.player.name, team: potm.player.team, player: potm.player,
      basis: `Player Index and goals, equally weighted — index ${potm.parts.index}, `
        + `${potm.parts.goals} goal${potm.parts.goals === 1 ? '' : 's'}` }
  }

  const scorer = topScorer(players)[0]
  if (scorer) {
    out.top_scorer = { name: scorer.player.name, team: scorer.player.team, player: scorer.player,
      basis: `most goals — ${scorer.parts.goals}` }
  }

  const keeper = bestGoalkeeper(players, matches)[0]
  if (keeper) {
    out.best_goalkeeper = { name: keeper.player.name, team: keeper.player.team,
      player: keeper.player,
      basis: `Player Index, clean sheets and goals conceded per match, equally weighted — `
        + `index ${keeper.parts.index}, ${keeper.parts.cleanSheets} clean sheet`
        + `${keeper.parts.cleanSheets === 1 ? '' : 's'}, ${one(keeper.parts.gaPerMatch)} conceded per match` }
  }

  const young = risingStar(players, startDate)[0]
  if (young) {
    out.rising_star = { name: young.player.name, team: young.player.team, player: young.player,
      basis: `highest Player Index among players under ${RISING_STAR_UNDER} — `
        + `index ${young.parts.index}, age ${young.parts.age}` }
  }

  const clean = fairPlay(matches, players)[0]
  if (clean) {
    out.fair_play = { name: clean.team.code, team: clean.team.code, teamRow: clean.team,
      basis: `fewest card points per match — ${clean.parts.cards} card`
        + `${clean.parts.cards === 1 ? '' : 's'} in ${clean.parts.mp} `
        + `(green ${CARD_WEIGHT.green}, yellow ${CARD_WEIGHT.yellow}, red ${CARD_WEIGHT.red})` }
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
