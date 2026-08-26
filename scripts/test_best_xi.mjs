// Hockey.AI — the best XI is positional, and honest about where each role
// came from. These are the properties the page depends on.
import { readFileSync } from 'node:fs'
import { bestXI, roleOf, LINES, isAtTournament, tournamentXI } from '../src/engine/bestXI.js'

const PLAYERS = JSON.parse(readFileSync(new URL('../public/data/players.json', import.meta.url))).players
const TEAMS = [...new Set(PLAYERS.map(p => p.team))].sort()

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log('  ok  ', name)
  else { failed++; console.log('  FAIL', name, detail) }
}
const all = (list, pred) => list.filter(x => !pred(x))

console.log(`Best XI across ${TEAMS.length} squads`)

const xis = new Map(TEAMS.map(t => [t, bestXI(PLAYERS.filter(p => p.team === t))]))
// A player the official FIH team list does not carry did not travel, and no
// surface describing this tournament may show him.
const HERE = PLAYERS.filter(isAtTournament)
const ABSENT = PLAYERS.filter(p => !isAtTournament(p))

check('every squad fields eleven',
  all([...xis], ([, x]) => x.size === 11).length === 0,
  all([...xis], ([, x]) => x.size === 11).map(([t, x]) => `${t}:${x.size}`).join(','))

check('the shape is 1-4-3-3',
  all([...xis], ([, x]) => x.lines.every((l, i) => l.slots.length === LINES[i].count)).length === 0)

const dupes = [...xis].filter(([, x]) => {
  const ids = x.lines.flatMap(l => l.slots.map(s => s.player.id))
  return new Set(ids).size !== ids.length
})
check('no player fills two shirts', dupes.length === 0, dupes.map(([t]) => t).join(','))

check('every shirt belongs to that squad',
  all([...xis], ([t, x]) => x.lines.every(l => l.slots.every(s => s.player.team === t))).length === 0)

check('the keeper is one the FIH names as a keeper',
  all([...xis], ([, x]) => x.lines[0].slots.every(s => s.player.position === 'Goalkeeper')).length === 0,
  [...xis].filter(([, x]) => x.lines[0].slots.some(s => s.player.position !== 'Goalkeeper'))
    .map(([t, x]) => `${t}:${x.lines[0].slots[0]?.player.position}`).join(','))

check('a shirt not marked off-role holds a player of that role',
  all([...xis], ([, x]) => x.lines.every(l =>
    l.slots.every(s => s.offRole || roleOf(s.player).role === l.role))).length === 0)

check('an off-role shirt holds a player the record gives no role to',
  all([...xis], ([, x]) => x.lines.every(l =>
    l.slots.every(s => !s.offRole || roleOf(s.player).role === null))).length === 0)

check('every shirt says where its role came from',
  all([...xis], ([, x]) => x.lines.every(l => l.slots.every(s =>
    (s.source === 'FIH' || s.source === 'Hockey.AI') !== s.offRole))).length === 0)

check('nobody outside the official team list reaches a pitch or a bench',
  all([...xis], ([, x]) =>
    x.lines.every(l => l.slots.every(s => isAtTournament(s.player)))
    && x.bench.every(isAtTournament)).length === 0,
  [...xis].filter(([, x]) => x.bench.some(p => !isAtTournament(p)))
    .map(([t]) => t).join(','))

check('the bench holds exactly the travelling squad members not on the pitch',
  all([...xis], ([t, x]) => {
    const squad = HERE.filter(p => p.team === t)
    const on = new Set(x.lines.flatMap(l => l.slots.map(s => s.player.id)))
    return x.bench.length === squad.length - on.size
      && x.bench.every(p => !on.has(p.id))
  }).length === 0)

// The data contract the pitch stands on.
console.log('\nPosition provenance in the published data')

// The sheets state who started, so the XI must reflect them: a role's shirt
// cannot go to a player the coach used less than one the role passed over.
check('within a role, no player is picked over a team-mate with more starts',
  all([...xis], ([t, x]) => {
    const squad = HERE.filter(p => p.team === t)
    return x.lines.every(line => {
      const picked = line.slots.filter(s => !s.offRole).map(s => s.player)
      if (!picked.length) return true
      const lowest = Math.min(...picked.map(p => p.starts ?? 0))
      const passedOver = squad.filter(p =>
        roleOf(p).role === line.role && !picked.some(q => q.id === p.id))
      return passedOver.every(p => (p.starts ?? 0) <= lowest)
    })
  }).length === 0)

check('a player who did not travel carries no rating',
  ABSENT.every(p => p.ai_rating == null && p.position_effective == null),
  ABSENT.filter(p => p.ai_rating != null).map(p => p.name).join(','))

// Provenance only applies to the players actually at the tournament.
const stated = HERE.filter(p => p.position && p.position !== 'Squad')
check('a stated position is never overwritten',
  stated.every(p => p.position_effective === p.position),
  stated.filter(p => p.position_effective !== p.position).map(p => p.name).join(','))

check('a stated position is always sourced to the FIH',
  stated.every(p => p.position_source === 'FIH'))

const derived = HERE.filter(p => p.position_source === 'Hockey.AI')
check('a derived position is only ever given where the FIH states none',
  derived.every(p => !p.position || p.position === 'Squad'))

check('a derived position rests on something in the record',
  derived.every(p => (p.goals ?? 0) > 0),
  derived.filter(p => !(p.goals ?? 0)).map(p => p.name).join(','))

check('a penalty-corner scorer is derived as a defender',
  derived.filter(p => (p.pc_scored ?? 0) > 0 && p.goals - p.pc_scored <= p.pc_scored)
    .every(p => p.position_effective === 'Defender'))

check('a player with nothing on the record is given no position',
  HERE.filter(p => (p.goals ?? 0) === 0 && (!p.position || p.position === 'Squad'))
    .every(p => p.position_effective == null && p.position_source == null))

check('every position is one of the four hockey plays',
  HERE.every(p => p.position_effective == null
    || LINES.some(l => l.role === p.position_effective)))


// ── The tournament-wide XI ────────────────────────────────────────────────
// A separate selection from the per-team one above and a separate question:
// the highest-rated player in each line across every nation. It read the raw
// entry-list position, where three players in the whole tournament are stated
// Defenders, so the back four could not be filled and the XI fielded ten men
// without saying so.
{
  const xi = tournamentXI(PLAYERS)
  console.log('Tournament XI')
  check('the tournament XI fields eleven', xi.length === 11, `${xi.length} picked`)
  for (const line of LINES) {
    const got = xi.filter(p => p.line.role === line.role)
    check(`the ${line.role.toLowerCase()} line is full`, got.length === line.count,
      `${got.length} of ${line.count}`)
    check(`every ${line.role.toLowerCase()} picked plays there`,
      got.every(p => roleOf(p).role === line.role))
  }
  check('nobody is picked over a higher-rated player in the same line',
    LINES.every(line => {
      const pool = PLAYERS.filter(p => isAtTournament(p) && p.ai_rating != null &&
        roleOf(p).role === line.role).map(p => p.ai_rating).sort((a, b) => b - a)
      const picked = xi.filter(p => p.line.role === line.role).map(p => p.ai_rating)
      return picked.every((r, i) => r === pool[i])
    }))
  check('nobody outside the official team lists reaches the XI',
    xi.every(p => isAtTournament(p)))
  check('no player is picked twice', new Set(xi.map(p => p.id)).size === xi.length)
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll best-XI checks passed.')
process.exit(failed ? 1 : 0)
