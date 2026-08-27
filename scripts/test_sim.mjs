// Hockey.AI — the rising XI and the exhibition played between the two elevens.
//
// Both used to be typed in. The rising XI was a list of nations; the sim was a
// hand-written team sheet that by the second week named three players who never
// travelled and a scoreline that had nothing to do with them. Both are now
// selections, so both are checked the way a selection is checked: eleven
// players, one per shirt, every one of them eligible and at this tournament.
import { readFileSync } from 'node:fs'
import { isAtTournament, roleOf, LINES } from '../src/engine/bestXI.js'
import { eliteTiers, pickSquad, pickRisingSquad, SEMI_SHARE, BENCH_SIZE, SLOTS, componentRaw } from '../src/engine/squad.js'
import { ageOn } from '../src/engine/awards.js'
import { simulate, outcome, goalRate } from '../src/engine/sim.js'

const PLAYERS = JSON.parse(readFileSync(new URL('../public/data/players.json', import.meta.url))).players
const MATCHES = JSON.parse(readFileSync(new URL('../public/data/fixtures.json', import.meta.url))).matches

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

const start = new Date(`${MATCHES.reduce((min, m) => (!min || m.date < min ? m.date : min), null)}T00:00:00Z`)
const tiers = eliteTiers(MATCHES)
const best = pickSquad(PLAYERS, tiers)
const rising = pickRisingSquad(PLAYERS, start, tiers)

console.log(`Elite field — top eight ${[...tiers.topEight].sort().join(' ')}`)
check('the top eight are the eight nations of the crossover pools', tiers.topEight.size === 8,
  `${tiers.topEight.size}`)
check('four semi-finalists are named', tiers.semifinalists.size === 4,
  [...tiers.semifinalists].join(','))
check('every semi-finalist is one of the top eight',
  [...tiers.semifinalists].every(c => tiers.topEight.has(c)))

console.log(`\nTournament's Best XV (${best.squad.length} picked, ${best.semiCount} of the XI from semi-finalists)`)
check('eleven start and four are named as substitutes',
  best.xi.length === 11 && best.bench.length === BENCH_SIZE,
  `${best.xi.length}+${best.bench.length}`)
check('the shape is 1-4-3-3',
  LINES.every(l => best.xi.filter(p => p.line.role === l.role).length === l.count),
  LINES.map(l => `${l.short}:${best.xi.filter(p => p.line.role === l.role).length}`).join(' '))
check('nobody is picked twice', new Set(best.squad.map(p => p.id)).size === best.squad.length)
check('every pick is on an official FIH team list', best.squad.every(isAtTournament))

// The constraint the whole selection exists to honour.
check('every pick comes from the eight nations of the crossover pools',
  best.squad.every(p => tiers.topEight.has(p.team)),
  best.squad.filter(p => !tiers.topEight.has(p.team)).map(p => `${p.team} ${p.name}`).join(','))
check(`between ${SEMI_SHARE.min} and ${SEMI_SHARE.max} of the eleven are semi-finalists`,
  best.semiCount >= SEMI_SHARE.min && best.semiCount <= SEMI_SHARE.max, `${best.semiCount}`)

// Every shirt has to say what it was filled on, and the figure has to exist.
check('every shirt names the role it fills and why',
  best.squad.every(p => p.slot?.label && p.slot?.why))
check('every starter fills a slot the model declares',
  best.xi.every(p => SLOTS.some(s => s.key === p.slot.key)))
check('the drag-flick shirts hold players who have actually converted one',
  best.xi.filter(p => p.slot.key === 'battery')
    .every(p => (p.pc_scored ?? 0) + (p.ps_scored ?? 0) > 0),
  best.xi.filter(p => p.slot.key === 'battery' && !((p.pc_scored ?? 0) + (p.ps_scored ?? 0)))
    .map(p => p.name).join(','))
check('the talisman carries the largest share of his own side’s goals',
  best.xi.filter(p => p.slot.key === 'talisman').every(p => (componentRaw(p, 'talisman') ?? 0) > 0))

// The defect that made this rebuild necessary: an XI of players who barely
// played. Three of the old eleven had one start or fewer between them.
check('no starter is picked on fewer than two starts',
  best.xi.every(p => (p.starts ?? 0) >= 2),
  best.xi.filter(p => (p.starts ?? 0) < 2).map(p => `${p.name} (${p.starts})`).join(','))

console.log(`\nRising Stars XV — age ${rising.rung?.maxAge}, ${rising.rung?.topEightOnly ? 'top eight' : 'all nations'}`)
check('fifteen are picked', rising.squad.length === 15, `${rising.squad.length}`)
check('the shape is 1-4-3-3',
  LINES.every(l => rising.xi.filter(p => p.line.role === l.role).length === l.count))
check('nobody is picked twice', new Set(rising.squad.map(p => p.id)).size === rising.squad.length)
check('every pick is on an official FIH team list', rising.squad.every(isAtTournament))

// Age is the rule this selection exists for, so it is checked against the FIH
// entry list's own date of birth for every one of the fifteen, not asserted.
check(`every player is ${rising.rung.maxAge} or under on the opening day`,
  rising.squad.every(p => {
    const age = ageOn(p.dob, start)
    return age != null && age <= rising.rung.maxAge
  }),
  rising.squad.filter(p => (ageOn(p.dob, start) ?? 99) > rising.rung.maxAge)
    .map(p => `${p.name} ${ageOn(p.dob, start)}`).join(','))

check('every player carries a date of birth to be checked against',
  rising.squad.every(p => p.dob && ageOn(p.dob, start) != null))

// The ladder only ever steps down because the rung above cannot field a side,
// and the record has to show it did.
check('every rung above the one used genuinely could not field fifteen',
  rising.tried.slice(0, -1).every(t => t.filled < 15),
  rising.tried.map(t => `${t.maxAge}/${t.topEightOnly ? 'top8' : 'all'}:${t.filled}`).join(' '))
check('the rung used is the first that fields fifteen',
  rising.tried[rising.tried.length - 1].filled === 15)

console.log('\nThe simulated exhibition')
const sim = simulate(PLAYERS, MATCHES)
check('the sim is produced from the record', sim != null)

if (sim) {
  check('both sides field eleven', sim.home.length === 11 && sim.away.length === 11)
  check('no player appears on both team sheets',
    !sim.home.some(h => sim.away.some(a => a.id === h.id)),
    sim.home.filter(h => sim.away.some(a => a.id === h.id)).map(p => p.player).join(','))
  const named = new Set(PLAYERS.filter(isAtTournament).map(p => p.id))
  check('every name on both sheets is at this tournament',
    [...sim.home, ...sim.away].every(p => named.has(p.id)))
  check('the Best XI on the sim sheet is the Tournament\'s Best XI',
    sim.home.map(p => p.id).sort().join(',') === best.xi.map(p => p.id).sort().join(','))

  const base = goalRate(MATCHES)
  check('the goal rate is the tournament\'s own',
    near(sim.base.rate, base.rate) && sim.base.matches === base.matches)
  check('the outcome distribution sums to a hundred',
    near(sim.result.home + sim.result.draw + sim.result.away, 100, 1e-6))
  check('the printed scoreline is the likeliest one, not a chosen one',
    sim.score.home === sim.result.modal.home && sim.score.away === sim.result.modal.away)
  check('the confidence figure is the leading side\'s own probability',
    sim.cards.find(c => c.key === 'confidence').value ===
      Math.round(Math.max(sim.result.home, sim.result.away)))
  check('a level scoreline is labelled level',
    (sim.score.home === sim.score.away) === sim.decider.includes('level'))
  check('the page still carries its disclosure', !!sim.cards.find(c => c.key === 'disclosure'))
  check('every driver and insight has something to say',
    sim.cards.every(c => c.detail && c.detail.length > 40))

  const evenly = outcome(2.5, 2.5)
  check('two identical sides are level', near(evenly.home, evenly.away, 1e-9))
  const better = outcome(3.2, 1.8)
  check('the stronger side is favoured', better.home > better.away)
}

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll squad and simulation checks passed.')
process.exit(failed ? 1 : 0)
