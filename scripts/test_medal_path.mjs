// Hockey.AI — the medal path must describe the tournament, not a drawing of it.
//
// The bracket in the Standings tab derives its whole shape from the match
// record: which pools carry the medal path, who fed them, and which place each
// slot is. The FIH states the same thing independently on every knockout
// fixture, in `slotLabel` — "1st Pool E vs 2nd Pool F" — so the derivation can
// be checked against the governing body's own words rather than against
// itself. That is the assertion that matters here.
import { readFileSync } from 'node:fs'
import { buildBracket } from '../src/engine/bracket.js'
import { computeStandings } from '../src/engine/standings.js'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const FIX = read('fixtures.json')
const TEAMS = read('teams.json')

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

console.log('Medal path')
const bracket = buildBracket(TEAMS.teams, FIX.matches)
check('the bracket builds', bracket != null)
if (!bracket) process.exit(1)

const { pools, sides, semis, final, bronze } = bracket

check('two crossover pools carry the medal path', pools.length === 2,
  pools.map(p => p.id).join(','))
check('each crossover pool holds four nations',
  pools.every(p => p.entries.length === 4))

// Every entrant arrived as a first or second place, and every first and second
// place arrived — the crossover is exactly the top halves of the four pools.
const s1 = computeStandings(TEAMS.teams, FIX.matches)
const topTwo = new Set(s1.flatMap(p => p.standings.slice(0, 2).map(r => r.team)))
const entrants = new Set(pools.flatMap(p => p.entries.map(e => e.team)))
check('the crossover pools are exactly the eight sides that finished top two',
  topTwo.size === entrants.size && [...topTwo].every(t => entrants.has(t)),
  `${[...topTwo].join(',')} vs ${[...entrants].join(',')}`)
check('every entry states the place it came from',
  pools.every(p => p.entries.every(e => /^(1st|2nd) Pool [A-Z]$/.test(e.label))),
  pools.flatMap(p => p.entries.map(e => e.label)).join(' · '))

// Each side of the draw carries the two pools that fed its crossover pool, and
// nothing else.
check('each side of the draw carries two Stage-1 pools',
  sides.length === 2 && sides.every(s => s.stage1.length === 2))
check('no Stage-1 pool appears on both sides of the draw',
  new Set(sides.flatMap(s => s.stage1.map(p => p.id))).size === 4)

// The check worth having: the FIH says the same thing on the fixture.
const byId = new Map(FIX.matches.map(m => [m.id, m]))
for (const s of semis) {
  const stated = byId.get(s.id)?.slotLabel
  if (!stated) continue
  check(`${s.id} is labelled the way the FIH labels it`,
    `${s.home.label} vs ${s.away.label}`.toLowerCase() === stated.toLowerCase(),
    `derived "${s.home.label} vs ${s.away.label}", FIH says "${stated}"`)
}

// Nothing is named that the record has not settled.
const settled = new Set(FIX.matches.flatMap(m => [m.home, m.away]).filter(c => c && c !== 'TBD'))
const namedSlots = [...semis, final, bronze].filter(Boolean)
  .flatMap(t => [t.home, t.away]).filter(s => s.team)
check('every named slot names a side the schedule actually carries',
  namedSlots.every(s => settled.has(s.team)),
  namedSlots.map(s => s.team).join(','))
check('a final without two played semi-finals names nobody',
  semis.every(s => s.score) || (final.home.team == null && final.away.team == null),
  `${final.home.team} vs ${final.away.team}`)

// A fixture is provisional exactly while it does not know who is in it. The
// flag was written once with the seed schedule and never revisited, so a
// semi-final filled in from two finished tables went on calling itself a guess.
console.log('Knockout fixtures')
const wrong = FIX.matches.filter(m =>
  m.phase !== 'pool' && m.provisional != null &&
  m.provisional !== (m.home === 'TBD' || m.away === 'TBD'))
check('every knockout tie is provisional exactly while a side is unknown',
  wrong.length === 0,
  wrong.map(m => `${m.id} ${m.home}v${m.away} provisional=${m.provisional}`).join('; '))

console.log(failed ? 'FAILED' : 'All medal-path checks passed.')
process.exit(failed ? 1 : 0)
