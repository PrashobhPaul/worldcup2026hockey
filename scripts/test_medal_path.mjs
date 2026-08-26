// Hockey.AI — the medal path must describe the tournament, not a drawing of it.
//
// The bracket declares a structure — A+D→E, B+C→F, 1E+2F→SF1, 2E+1F→SF2,
// winners→final, losers→bronze — and fills it from the match record. Two
// things are checked here, and they are different things.
//
// The structure: every slot is addressed by (source, position) and resolved
// through that key alone, so two slots cannot collapse onto the same nation by
// sharing an object. That is asserted directly, because it is the failure the
// view would show as a duplicated flag rather than as an error.
//
// The filling: the FIH states the same pairing independently on every knockout
// fixture, in `slotLabel` — "1st Pool E vs 2nd Pool F" — so the derivation can
// be checked against the governing body's own words rather than against
// itself. The sides are compared as an unordered pair: the fixture decides who
// is written first, the topology decides who plays whom.
import { readFileSync } from 'node:fs'
import { buildBracket, STATUS } from '../src/engine/bracket.js'
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

const { groups, qualifiers, semis, final, bronze } = bracket
const [left, right] = qualifiers

// ── The structure ─────────────────────────────────────────────────────────
check('two crossover pools carry the medal path', qualifiers.length === 2,
  qualifiers.map(q => q.id).join(','))
check('each crossover pool is fed by two Stage-1 pools',
  qualifiers.every(q => q.feeders.length === 2),
  qualifiers.map(q => `${q.id}←${q.feeders}`).join(' '))
check('no Stage-1 pool feeds both crossover pools',
  new Set(qualifiers.flatMap(q => q.feeders)).size === 4)
check('every group states which crossover pool it feeds',
  groups.length === 4 && groups.every(g => qualifiers.some(q => q.id === g.feeds)))

// Four slots per pool: first and second of each feeder, addressed by key.
for (const q of qualifiers) {
  const keys = q.slots.map(s => `${s.sourcePool}${s.sourcePosition}`)
  check(`Group ${q.id} holds four slots`, q.slots.length === 4, keys.join(','))
  check(`Group ${q.id} addresses each slot once`, new Set(keys).size === 4, keys.join(','))
  check(`Group ${q.id} takes the first two of each feeder`,
    keys.slice().sort().join(',') ===
      q.feeders.flatMap(f => [`${f}1`, `${f}2`]).sort().join(','),
    keys.join(','))
  // The failure this is here to catch: one nation filling two slots because
  // the slot was read off a shared object instead of its own (pool, place).
  const named = q.slots.map(s => s.team).filter(Boolean)
  check(`Group ${q.id} names no nation twice`, new Set(named).size === named.length,
    named.join(','))
}

// Each slot names the nation the Stage-1 table puts in that place, and nothing
// else — resolved here independently of the engine.
const s1 = computeStandings(TEAMS.teams, FIX.matches)
const place = (pool, pos) => s1.find(p => p.id === pool)?.standings[pos - 1]?.team ?? null
const wrong = qualifiers.flatMap(q => q.slots)
  .filter(s => s.team && s.team !== place(s.sourcePool, s.sourcePosition))
check('every slot names the side that finished in that place',
  wrong.length === 0,
  wrong.map(s => `${s.label}=${s.team}, table says ${place(s.sourcePool, s.sourcePosition)}`).join('; '))

const topTwo = new Set(s1.flatMap(p => p.standings.slice(0, 2).map(r => r.team)))
const entrants = new Set(qualifiers.flatMap(q => q.slots.map(s => s.team)).filter(Boolean))
check('the crossover pools hold exactly the eight sides that finished top two',
  topTwo.size === entrants.size && [...topTwo].every(t => entrants.has(t)))

// ── The pairings ──────────────────────────────────────────────────────────
check('semi 1 is 1st of one pool against 2nd of the other',
  semis[0].home.label === `1st Group ${left.id}` &&
  semis[0].away.label === `2nd Group ${right.id}`,
  `${semis[0].home.label} v ${semis[0].away.label}`)
check('semi 2 is the mirror of semi 1',
  semis[1].home.label === `2nd Group ${left.id}` &&
  semis[1].away.label === `1st Group ${right.id}`,
  `${semis[1].home.label} v ${semis[1].away.label}`)

const byId = new Map(FIX.matches.map(m => [m.id, m]))
for (const s of semis) {
  const fixture = byId.get(s.id)
  if (!fixture?.slotLabel) continue
  // "1st Pool E vs 2nd Pool F" — the FIH says Pool where this says Group, and
  // may write the two sides in either order.
  const norm = t => t.toLowerCase().replace(/\bpool\b/g, 'group').split(/\s+vs\s+/).sort().join(' vs ')
  check(`${s.id} pairs the sides the FIH pairs`,
    norm(`${s.home.label} vs ${s.away.label}`) === norm(fixture.slotLabel),
    `derived "${s.home.label} vs ${s.away.label}", FIH says "${fixture.slotLabel}"`)
  if (s.stated[0]) {
    check(`${s.id} names the sides the fixture names`,
      [s.home.team, s.away.team].filter(Boolean).sort().join(',') ===
        s.stated.filter(Boolean).sort().join(','),
      `derived ${s.home.team}/${s.away.team}, fixture ${s.stated}`)
  }
}

// ── The fork ──────────────────────────────────────────────────────────────
check('the final takes the winner of each semi-final',
  final.path === 'winner' &&
  final.home.label === 'Winner Semi Final 1' && final.away.label === 'Winner Semi Final 2')
check('third place takes the loser of each semi-final',
  bronze.path === 'loser' &&
  bronze.home.label === 'Loser Semi Final 1' && bronze.away.label === 'Loser Semi Final 2')
check('an unplayed semi-final resolves to nobody downstream',
  semis.every(s => s.score) ||
    [final.home, final.away, bronze.home, bronze.away].every(s => s.team == null),
  `${final.home.team}/${final.away.team} · ${bronze.home.team}/${bronze.away.team}`)
check('a side is never both in the final and in the third-place match',
  [final.home, final.away].every(f => !f.team ||
    ![bronze.home, bronze.away].some(b => b.team === f.team)))

// ── Nothing invented ──────────────────────────────────────────────────────
const known = new Set(FIX.matches.flatMap(m => [m.home, m.away]).filter(c => c && c !== 'TBD'))
const allSlots = [...qualifiers.flatMap(q => q.slots),
  ...semis.flatMap(s => [s.home, s.away]),
  final.home, final.away, bronze.home, bronze.away]
check('every named slot names a side the schedule carries',
  allSlots.every(s => !s.team || known.has(s.team)),
  allSlots.filter(s => s.team && !known.has(s.team)).map(s => s.team).join(','))
check('a slot with no side is marked TBD and one with a side is not',
  allSlots.every(s => (s.team == null) === (s.status === STATUS.TBD)))
check('nothing is published as a projection',
  allSlots.every(s => s.status !== STATUS.PROJECTED))

// ── The fork, once the semi-finals are played ─────────────────────────────
// No semi-final has been played yet, so the live record cannot exercise any of
// this. It is the half of the structure that decides two medals, and it had a
// real defect: the score is stored in the fixture's order, the sides are shown
// in the order the structure declares, and reading one against the other
// positionally handed a tie the FIH lists the other way round to the side that
// lost it. So the scenario is played here instead of waited for.
console.log('Once the semi-finals are played')
{
  const matches = JSON.parse(JSON.stringify(FIX.matches))
  const fixtures = matches.filter(m => m.phase === 'semi-final')
    .sort((a, b) => (a.matchNo ?? 0) - (b.matchNo ?? 0))
  // The home side wins one and loses the other, so an order mix-up cannot pass
  // by symmetry.
  const results = [{ home: 3, away: 1 }, { home: 1, away: 2 }]
  const expect = fixtures.map((f, i) => (results[i].home > results[i].away
    ? { won: f.home, lost: f.away } : { won: f.away, lost: f.home }))
  fixtures.forEach((f, i) => { f.status = 'completed'; f.score = results[i] })

  const b = buildBracket(TEAMS.teams, matches)
  check('the sides stay in the order the structure declares',
    b.semis[0].home.label === `1st Group ${left.id}` &&
    b.semis[1].home.label === `2nd Group ${left.id}`,
    `${b.semis[0].home.label} · ${b.semis[1].home.label}`)
  for (const [i, s] of b.semis.entries()) {
    const f = fixtures[i]
    const goals = new Map([[f.home, results[i].home], [f.away, results[i].away]])
    check(`${s.id} keeps each side's goals with that side`,
      s.score[0] === goals.get(s.home.team) && s.score[1] === goals.get(s.away.team),
      `${s.home.team} ${s.score?.join('-')} ${s.away.team}, fixture ${f.home} ${results[i].home}-${results[i].away} ${f.away}`)
  }
  check('the winners, and only the winners, reach the final',
    [b.final.home.team, b.final.away.team].sort().join(',') ===
      expect.map(e => e.won).sort().join(','),
    `${b.final.home.team}/${b.final.away.team}, expected ${expect.map(e => e.won)}`)
  check('the losers, and only the losers, reach the third-place match',
    [b.bronze.home.team, b.bronze.away.team].sort().join(',') ===
      expect.map(e => e.lost).sort().join(','),
    `${b.bronze.home.team}/${b.bronze.away.team}, expected ${expect.map(e => e.lost)}`)
  check('a played tie is no longer waiting on anybody',
    [b.final.home, b.final.away, b.bronze.home, b.bronze.away]
      .every(s => s.status !== STATUS.TBD))
}

// A fixture is provisional exactly while it does not know who is in it.
console.log('Knockout fixtures')
const stale = FIX.matches.filter(m =>
  m.phase !== 'pool' && m.provisional != null &&
  m.provisional !== (m.home === 'TBD' || m.away === 'TBD'))
check('every knockout tie is provisional exactly while a side is unknown',
  stale.length === 0,
  stale.map(m => `${m.id} ${m.home}v${m.away} provisional=${m.provisional}`).join('; '))

console.log(failed ? 'FAILED' : 'All medal-path checks passed.')
process.exit(failed ? 1 : 0)
