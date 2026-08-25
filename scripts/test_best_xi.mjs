// Hockey.AI — the best XI is positional, and honest about where each role
// came from. These are the properties the page depends on.
import { readFileSync } from 'node:fs'
import { bestXI, roleOf, LINES } from '../src/engine/bestXI.js'

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

check('the bench holds exactly the squad members not on the pitch',
  all([...xis], ([t, x]) => {
    const squad = PLAYERS.filter(p => p.team === t)
    const on = new Set(x.lines.flatMap(l => l.slots.map(s => s.player.id)))
    return x.bench.length === squad.length - on.size
      && x.bench.every(p => !on.has(p.id))
  }).length === 0)

// The data contract the pitch stands on.
console.log('\nPosition provenance in the published data')

const stated = PLAYERS.filter(p => p.position && p.position !== 'Squad')
check('a stated position is never overwritten',
  stated.every(p => p.position_effective === p.position),
  stated.filter(p => p.position_effective !== p.position).map(p => p.name).join(','))

check('a stated position is always sourced to the FIH',
  stated.every(p => p.position_source === 'FIH'))

const derived = PLAYERS.filter(p => p.position_source === 'Hockey.AI')
check('a derived position is only ever given where the FIH states none',
  derived.every(p => !p.position || p.position === 'Squad'))

check('a derived position rests on something in the record',
  derived.every(p => (p.goals ?? 0) > 0),
  derived.filter(p => !(p.goals ?? 0)).map(p => p.name).join(','))

check('a penalty-corner scorer is derived as a defender',
  derived.filter(p => (p.pc_scored ?? 0) > 0 && p.goals - p.pc_scored <= p.pc_scored)
    .every(p => p.position_effective === 'Defender'))

check('a player with nothing on the record is given no position',
  PLAYERS.filter(p => (p.goals ?? 0) === 0 && (!p.position || p.position === 'Squad'))
    .every(p => p.position_effective == null && p.position_source == null))

check('every position is one of the four hockey plays',
  PLAYERS.every(p => p.position_effective == null
    || LINES.some(l => l.role === p.position_effective)))

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll best-XI checks passed.')
process.exit(failed ? 1 : 0)
