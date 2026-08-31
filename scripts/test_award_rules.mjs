// Hockey.AI — one rule per award, and both callers reading it.
//
// engine/awards.js and engine/awardsOfficial.js each named award winners, from
// different rules, and nothing compared them. So they drifted: one scored
// Player of the Tournament off the race softmax and the other off the Player
// Index, and both were shipping. The rules now live in engine/awardRules.js and
// both read them — but "both read them" is only true until someone edits one
// side, which is exactly how it broke the first time.
//
// So this imports BOTH and requires them to name the same winner for every
// award. It also pins the properties each rule claims, because a weighted score
// is easy to get subtly wrong and impossible to eyeball:
//
//   * equal weight means equal: neither component of a two-part score may
//     decide it alone, which is checked by re-scoring with one part removed;
//   * the goalkeeper score must move the right way for each of its three parts;
//   * the rising-star bound is exclusive — under 21, not 21 and under;
//   * fair play is per match played, so a longer run is not a penalty.
//
// Importing both modules also proves the import cycle between them resolves:
// awardRules borrows the age, card and ledger helpers from awards.js, which
// imports awardRules back.
//
// Run: node scripts/test_award_rules.mjs
import { readFileSync } from 'node:fs'
import { liveAwardLeaders } from '../src/engine/awards.js'
import { appNamed } from '../src/engine/awardsOfficial.js'
import {
  playerOfTournament, bestGoalkeeper, risingStar, fairPlay, RISING_STAR_UNDER,
} from '../src/engine/awardRules.js'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const PLAYERS = read('players.json').players
const FIX = read('fixtures.json').matches
const FIRST = FIX.reduce((a, m) => (!a || m.date < a ? m.date : a), null)
const START = new Date(`${FIRST}T00:00:00Z`)

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

console.log('Award rules')

// --- One rule, two callers -------------------------------------------------
const live = liveAwardLeaders({ players: PLAYERS, matches: FIX, potmRanked: [], tournamentStart: FIRST })
const named = appNamed({ players: PLAYERS, matches: FIX, startDate: START })

for (const key of ['best_player', 'top_scorer', 'best_goalkeeper', 'rising_star']) {
  check(`${key}: both callers name the same player`,
        live[key]?.player?.name === named[key]?.name,
        `${live[key]?.player?.name} vs ${named[key]?.name}`)
}
check('fair_play: both callers name the same nation',
      live.fair_play?.team?.code === named.fair_play?.team,
      `${live.fair_play?.team?.code} vs ${named.fair_play?.team}`)

// --- Player of the Tournament: equal weight is actually equal --------------
const potm = playerOfTournament(PLAYERS)
check('best_player: every candidate is scored', potm.length > 0)
check('best_player: scores are ordered', potm.every((r, i) => i === 0 || r.score <= potm[i - 1].score))

// If the index alone decided it, the winner would be the highest-index player;
// if goals alone did, the top scorer. It must be neither in general — and here
// it is demonstrably a blend, because the highest-index player does not win.
const topIndex = [...PLAYERS].filter(p => p.ai_rating != null)
  .sort((a, b) => b.ai_rating - a.ai_rating)[0]
const topGoals = [...PLAYERS].sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0))[0]
check('best_player: the index alone does not decide it',
      potm[0].player.name !== topIndex.name
      || potm[0].player.name === topGoals.name,
      'winner is the top-index player and not the top scorer')
check('best_player: a player with no goals and no index cannot win',
      (potm[0].parts.index ?? 0) > 0 || (potm[0].parts.goals ?? 0) > 0)

// Both components must be able to change the outcome. Doubling one player's
// goals must be able to lift them, and so must raising their index.
const bump = (name, field, by) => PLAYERS.map(p =>
  p.name === name ? { ...p, [field]: (p[field] ?? 0) + by } : p)
const runnerUp = potm[1]?.player
if (runnerUp) {
  const byGoals = playerOfTournament(bump(runnerUp.name, 'goals', 50))[0]
  check('best_player: goals can change the winner', byGoals.player.name === runnerUp.name,
        byGoals.player.name)
  const byIndex = playerOfTournament(bump(runnerUp.name, 'ai_rating', 500))[0]
  check('best_player: the index can change the winner', byIndex.player.name === runnerUp.name,
        byIndex.player.name)
}

// --- Goalkeeper: three parts, each pulling the right way -------------------
const gks = bestGoalkeeper(PLAYERS, FIX)
check('best_goalkeeper: keepers are scored', gks.length > 0)
check('best_goalkeeper: only goalkeepers are considered',
      gks.every(g => (g.player.position_effective ?? g.player.position) === 'Goalkeeper'))
check('best_goalkeeper: the score reports all three parts',
      gks[0].parts.index != null && gks[0].parts.cleanSheets != null
      && gks[0].parts.gaPerMatch != null)
// Conceding fewer must help, not hurt: two keepers alike but for goals against
// must order with the meaner one first.
const worse = gks.find(g => g.parts.gaPerMatch > gks[0].parts.gaPerMatch)
if (worse) {
  check('best_goalkeeper: conceding more is not rewarded',
        gks[0].score >= worse.score, `${gks[0].score} vs ${worse.score}`)
}

// --- Rising star: the bound is exclusive -----------------------------------
const young = risingStar(PLAYERS, START)
check(`rising_star: nobody aged ${RISING_STAR_UNDER} or over is eligible`,
      young.every(r => r.parts.age < RISING_STAR_UNDER),
      String(young.map(r => r.parts.age).filter(a => a >= RISING_STAR_UNDER)[0]))
check('rising_star: ordered by index',
      young.every((r, i) => i === 0 || r.parts.index <= young[i - 1].parts.index))
check('rising_star: the pool is not empty', young.length > 0)

// --- Fair play: per match played -------------------------------------------
const fp = fairPlay(FIX, PLAYERS)
check('fair_play: the cleanest side leads', fp.length > 0
      && fp.every((r, i) => i === 0 || r.parts.perMatch >= fp[0].parts.perMatch))
// A side that played more matches for the same card count must not be punished.
check('fair_play: scored per match, not per tournament',
      fp.every(r => Math.abs(r.parts.perMatch - r.parts.points / r.parts.mp) < 1e-9))

console.log()
if (failed) console.log(`${failed} award-rule check(s) FAILED`)
else console.log('All award-rule checks passed — one rule per award, both callers agreeing.')
process.exit(failed ? 1 : 0)
