// Hockey.AI — the rising XI and the exhibition played between the two elevens.
//
// Both used to be typed in. The rising XI was a list of nations; the sim was a
// hand-written team sheet that by the second week named three players who never
// travelled and a scoreline that had nothing to do with them. Both are now
// selections, so both are checked the way a selection is checked: eleven
// players, one per shirt, every one of them eligible and at this tournament.
import { readFileSync } from 'node:fs'
import { risingXI, tournamentXI, isRising, isAtTournament, roleOf, LINES, RISING } from '../src/engine/bestXI.js'
import { simulate, outcome, goalRate } from '../src/engine/sim.js'

const PLAYERS = JSON.parse(readFileSync(new URL('../public/data/players.json', import.meta.url))).players
const MATCHES = JSON.parse(readFileSync(new URL('../public/data/fixtures.json', import.meta.url))).matches

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

const start = new Date(`${MATCHES.reduce((min, m) => (!min || m.date < min ? m.date : min), null)}T00:00:00Z`)
const rising = risingXI(PLAYERS, start)

console.log(`Rising Stars XI (${rising.length} picked)`)

check('eleven players are picked', rising.length === 11, `got ${rising.length}`)

check('every line is filled to its shape',
  LINES.every(l => rising.filter(p => p.line.role === l.role).length === l.count),
  LINES.map(l => `${l.short}:${rising.filter(p => p.line.role === l.role).length}/${l.count}`).join(' '))

check('nobody is picked twice', new Set(rising.map(p => p.id)).size === rising.length)

check('every player is on an official FIH team list for this tournament',
  rising.every(isAtTournament),
  rising.filter(p => !isAtTournament(p)).map(p => p.name).join(','))

// The whole point of the selection: emerging means one of two stated facts on
// the entry list, never a judgement about who counts as a prospect.
check(`every player is under ${RISING.maxAge} on the opening day or arrived with ${RISING.maxCaps} caps or fewer`,
  rising.every(p => {
    const r = isRising(p, start)
    return r && (r.young || r.uncapped)
  }),
  rising.filter(p => !isRising(p, start)).map(p => p.name).join(','))

check('every shirt says which of the two qualified him',
  rising.every(p => p.rising?.reason))

check('every player carries a rating — nobody is picked off a squad list',
  rising.every(p => p.ai_rating != null))

// A rising XI is picked by line and by rating, exactly like the best XI: within
// a line, no player left out is rated above one picked.
const pool = PLAYERS.filter(p => isAtTournament(p) && p.ai_rating != null && isRising(p, start))
check('within every line, the highest-rated eligible players are the ones picked',
  LINES.every(l => {
    const picked = rising.filter(p => p.line.role === l.role)
    if (!picked.length) return true
    const ids = new Set(picked.map(p => p.id))
    const floor = Math.min(...picked.map(p => p.ai_rating))
    return !pool.some(p => !ids.has(p.id) && roleOf(p).role === l.role && p.ai_rating > floor)
  }),
  LINES.filter(l => {
    const picked = rising.filter(p => p.line.role === l.role)
    const ids = new Set(picked.map(p => p.id))
    const floor = picked.length ? Math.min(...picked.map(p => p.ai_rating)) : Infinity
    return pool.some(p => !ids.has(p.id) && roleOf(p).role === l.role && p.ai_rating > floor)
  }).map(l => l.short).join(','))

console.log('\nThe simulated exhibition')
const sim = simulate(PLAYERS, MATCHES)
check('the sim is produced from the record', sim != null)

if (sim) {
  check('both sides field eleven', sim.home.length === 11 && sim.away.length === 11)

  // The bug this gate exists for: two merit selections over the same field
  // returned five of the same names, and the exhibition fielded Jakob Brilla
  // against Jakob Brilla.
  check('no player appears on both team sheets',
    !sim.home.some(h => sim.away.some(a => a.id === h.id)),
    sim.home.filter(h => sim.away.some(a => a.id === h.id)).map(p => p.player).join(','))

  const named = new Set(PLAYERS.filter(isAtTournament).map(p => p.id))
  check('every name on both sheets is at this tournament',
    [...sim.home, ...sim.away].every(p => named.has(p.id)),
    [...sim.home, ...sim.away].filter(p => !named.has(p.id)).map(p => p.player).join(','))

  check('the Best XI on the sim sheet is the Tournament\'s Best XI',
    sim.home.map(p => p.id).join(',') === tournamentXI(PLAYERS).map(p => p.id).join(','))

  // Every number on the page has to be reconstructable from the two sheets.
  const base = goalRate(MATCHES)
  check('the goal rate is the tournament\'s own',
    near(sim.base.rate, base.rate) && sim.base.matches === base.matches)

  check('the outcome distribution sums to a hundred',
    near(sim.result.home + sim.result.draw + sim.result.away, 100, 1e-6),
    `${sim.result.home + sim.result.draw + sim.result.away}`)

  check('the printed scoreline is the likeliest one, not a chosen one',
    sim.score.home === sim.result.modal.home && sim.score.away === sim.result.modal.away)

  check('the confidence figure is the leading side\'s own probability',
    sim.cards.find(c => c.key === 'confidence').value ===
      Math.round(Math.max(sim.result.home, sim.result.away)))

  check('a level scoreline is labelled level',
    (sim.score.home === sim.score.away) === sim.decider.includes('level'))

  check('the page still carries its disclosure',
    !!sim.cards.find(c => c.key === 'disclosure'))

  check('every driver and insight has something to say',
    sim.cards.every(c => c.detail && c.detail.length > 40))

  // The model itself: a better side must not come out worse.
  const evenly = outcome(2.5, 2.5)
  check('two identical sides are level', near(evenly.home, evenly.away, 1e-9))
  const better = outcome(3.2, 1.8)
  check('the stronger side is favoured', better.home > better.away)
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll rising-XI and simulation checks passed.')
process.exit(failed ? 1 : 0)
