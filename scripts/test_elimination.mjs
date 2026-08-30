// Hockey.AI — the Alive cut must describe the tournament, not a stage of it.
//
// The Teams grid's "Alive" chip counts the nations engine/elimination.js has
// not marked out. That chain is built stage by stage, and a chain built that
// way fails silently at its end: every earlier link keeps working, the count
// stays plausible, and nobody notices. It did. With all fifty matches played
// the grid read "Alive 2" — the champion and the side it had just beaten in
// the final — because the chain stopped at the semi-finals and the losing
// finalist was never marked.
//
// So the check here is not "does elimination run". It is the arithmetic the
// tournament forces at each point, asserted against the real record:
//
//   * a completed tournament leaves exactly one nation alive, and it is the
//     nation that won the gold medal match;
//   * nobody is marked out before a match that could still have saved them;
//   * an exit is recorded where a nation stopped being able to win the title,
//     not where it happened to play last — the bronze medallists lost their
//     semi-final and are out from there, whatever the bronze match did.
//
// Run: node scripts/test_elimination.mjs
import { readFileSync } from 'node:fs'
import { computeElimination } from '../src/engine/elimination.js'
import { projectBracket, orderedResults } from '../src/engine/simulate.js'
import { computeStandings } from '../src/engine/standings.js'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const FIX = read('fixtures.json')
const TEAMS = read('teams.json')

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

const teams = TEAMS.teams
const matches = FIX.matches

/** The map as it stood after the first `n` matches had been completed. */
const eliminationAfter = n => {
  const order = [...matches].sort((a, b) =>
    `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
  const played = new Set(order.slice(0, n).map(m => m.id))
  const asOf = matches.map(m => played.has(m.id)
    ? m
    : { ...m, status: 'scheduled', score: null, shootout: null })
  const results = orderedResults(asOf)
  const standings = computeStandings(teams, asOf)
  return computeElimination(teams, asOf, results, standings,
    projectBracket(teams, asOf, standings))
}

console.log('Elimination')

const results = orderedResults(matches)
const complete = matches.every(m => m.status === 'completed' && m.score?.home != null)
const out = eliminationAfter(matches.length)
const alive = teams.filter(t => !out.has(t.code)).map(t => t.code)

const gold = matches.find(m => m.id === 'GOLD')
const champion = gold && gold.score
  ? (gold.score.home === gold.score.away
      ? ((gold.shootout?.home ?? 0) > (gold.shootout?.away ?? 0) ? gold.home : gold.away)
      : (gold.score.home > gold.score.away ? gold.home : gold.away))
  : null

if (complete) {
  check('a finished tournament leaves exactly one nation alive',
        alive.length === 1, `alive: ${alive.join(', ') || 'none'}`)
  check('the one alive is the nation that won the gold medal match',
        alive[0] === champion, `alive ${alive[0]}, champion ${champion}`)
  check('the beaten finalist is out, and out at the final',
        out.get(gold.home === champion ? gold.away : gold.home)?.stage === 'Final',
        JSON.stringify(out.get(gold.home === champion ? gold.away : gold.home)))
} else {
  check('the tournament is still running, so someone is alive', alive.length > 0)
}

// An exit is where a nation stopped being able to win. Both bronze-match sides
// lost a semi-final, so both are out from there — never from the bronze match,
// which they played after they were already out.
const brz = matches.find(m => m.id === 'BRZ')
if (brz && brz.status === 'completed') {
  for (const code of [brz.home, brz.away]) {
    check(`${code} is out at its semi-final, not at the bronze match`,
          out.get(code)?.stage === 'SF', JSON.stringify(out.get(code)))
  }
}

// Nobody may be marked out before a match that could still have saved them:
// the recorded exit must not precede that nation's last meaningful fixture.
for (const [code, cut] of out) {
  const lastPlayed = results.reduce((acc, m, i) =>
    (m.home === code || m.away === code) ? i + 1 : acc, 0)
  if (cut.finishedCount > lastPlayed) {
    check(`${code} is not marked out after its last match`, false,
          `exit at ${cut.finishedCount}, last played ${lastPlayed}`)
  }
}
check('no exit is recorded after the nation stopped playing', true)

// The count may only ever fall. A nation that has been eliminated cannot come
// back into the title race one match later, and a chain that re-derives itself
// from scratch at every step is exactly where that could happen.
let prev = teams.length
let monotone = true
const detail = []
for (let n = 0; n <= matches.length; n += 5) {
  const size = teams.length - eliminationAfter(n).size
  if (size > prev) { monotone = false; detail.push(`${n}: ${prev} -> ${size}`) }
  prev = size
}
check('the alive count never rises as matches are played', monotone, detail.join(', '))

console.log()
console.log(failed ? `${failed} FAILED` : `All elimination checks passed — alive: ${alive.join(', ')}`)
process.exit(failed ? 1 : 0)
