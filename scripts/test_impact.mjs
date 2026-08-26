// Hockey.AI — what a side would lose without a player.
//
// The positional rating says how well someone plays his position. It does not
// say how much of a team he is, and the key-player cards on the knockout pages
// and the team pages answer that second question: share of the scoring, the
// corner routine, the rank in his line, and the keeper the coach actually
// plays.
//
// Two failures are worth guarding against, because both produce a card that
// looks right and reads wrong:
//
//   * handing each question to a different name, which put India's penalty
//     corners on the player with one of them while the captain with six stood
//     in the next column;
//   * answering "goalkeeper" with the best-rated keeper rather than the one
//     who plays, which named reserves who had not started a match.
import { readFileSync } from 'node:fs'
import { impactContext, playerImpact, teamKeyPlayers, teamGoalTotals } from '../src/engine/impact.js'
import { isAtTournament, roleOf } from '../src/engine/bestXI.js'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const PLAYERS = read('players.json').players.filter(isAtTournament)
const FIX = read('fixtures.json')

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

const ctx = impactContext(PLAYERS, FIX.matches)
const TEAMS = [...new Set(PLAYERS.map(p => p.team))].sort()

console.log('Impact context')
const goals = teamGoalTotals(FIX.matches)
const scored = new Map()
for (const p of PLAYERS) scored.set(p.team, (scored.get(p.team) ?? 0) + (p.goals ?? 0))
check('a side’s goal total is the goals its players are credited with',
  TEAMS.every(t => (goals.get(t) ?? 0) === (scored.get(t) ?? 0)),
  TEAMS.filter(t => (goals.get(t) ?? 0) !== (scored.get(t) ?? 0))
    .map(t => `${t}: table ${goals.get(t)}, players ${scored.get(t)}`).join('; '))

const shares = PLAYERS.map(p => playerImpact(p, ctx)).filter(i => i.share != null)
check('no player carries more than all of his side’s scoring',
  shares.every(i => i.share >= 0 && i.share <= 100),
  shares.filter(i => i.share < 0 || i.share > 100).map(i => `${i.player.name} ${i.share}%`).join(','))
check('a share is a share of that player’s own side',
  shares.every(i => i.teamGoals === goals.get(i.player.team)))

console.log('Key players')
for (const team of TEAMS) {
  const squad = PLAYERS.filter(p => p.team === team)
  const cards = teamKeyPlayers(squad, ctx)
  check(`${team} names at least one key player`, cards.length > 0)
  check(`${team} names each player once`,
    new Set(cards.map(c => c.impact.player.id)).size === cards.length,
    cards.map(c => c.impact.player.name).join(','))
  check(`${team} names only its own players`,
    cards.every(c => c.impact.player.team === team))

  // The corner card must name the side's best corner scorer, whether or not
  // he already answered another question.
  const topPc = squad.filter(p => (p.pc_scored ?? 0) > 0)
    .sort((a, b) => b.pc_scored - a.pc_scored || a.name.localeCompare(b.name))[0]
  const cornerCard = cards.find(c => c.labels.includes('Penalty corners'))
  check(`${team} puts the corners on its best corner scorer`,
    !topPc ? !cornerCard : cornerCard?.impact.player.id === topPc.id,
    topPc ? `expected ${topPc.name} (${topPc.pc_scored}), got ${cornerCard?.impact.player.name} (${cornerCard?.impact.pcGoals})` : '')

  // Likewise the talisman: the biggest share, not the next name along.
  const topShare = squad.filter(p => (p.goals ?? 0) > 0)
    .sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name))[0]
  const talismanCard = cards.find(c => c.labels.includes('Talisman'))
  check(`${team} puts the talisman on its top scorer`,
    !topShare ? !talismanCard : talismanCard?.impact.player.id === topShare.id,
    topShare ? `expected ${topShare.name}, got ${talismanCard?.impact.player.name}` : '')

  // The goalkeeper card must name a keeper the coach actually used, where the
  // sheets say anybody did.
  const keeperCard = cards.find(c => c.labels.includes('Goalkeeper'))
  const keepers = squad.filter(p => roleOf(p).role === 'Goalkeeper' && p.ai_rating != null)
  const anyStarted = keepers.some(k => (k.starts ?? 0) > 0)
  check(`${team} names a goalkeeper who has started`,
    !keeperCard || !anyStarted || (keeperCard.impact.starts ?? 0) > 0,
    keeperCard ? `${keeperCard.impact.player.name} started ${keeperCard.impact.starts}` : '')
  check(`${team} names the keeper who started most`,
    !keeperCard || !anyStarted ||
      keeperCard.impact.starts === Math.max(...keepers.map(k => k.starts ?? 0)),
    keeperCard ? `${keeperCard.impact.player.name} ${keeperCard.impact.starts} of max ${Math.max(...keepers.map(k => k.starts ?? 0))}` : '')

  // The rating card is the outfielder, because the keeper has his own line and
  // keepers rate high enough to answer both.
  const ratedCard = cards.find(c => c.labels.includes('Highest rated'))
  check(`${team} rates an outfielder, not its keeper twice`,
    !ratedCard || ratedCard.impact.role !== 'Goalkeeper',
    ratedCard?.impact.player.name)
  check(`${team} states every figure it prints`,
    cards.every(c => c.stats.length === c.labels.length && c.stats.every(Boolean)))
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll impact checks passed.')
process.exit(failed ? 1 : 0)
