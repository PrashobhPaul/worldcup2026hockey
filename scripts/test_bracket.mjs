// Bracket projection — the numbers on the Cup tab and the Oracle bracket come
// from one object, and this is where that promise is enforced.
//
// The bug these checks exist for: the Stage-2 pool card showed the pool in
// SEEDING order while the semi-finals below it were slotted from a DIFFERENT
// ordering (by rating), so the same screen said both "Argentina finish 2nd in
// Pool E, → SF" and "the semi-final is England v Belgium".
import fs from 'node:fs'
import { projectBracket } from '../src/engine/simulate.js'
import { computeStandings } from '../src/engine/standings.js'

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n, d) } }
const read = p => JSON.parse(fs.readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'))
const listOf = raw => Array.isArray(raw) ? raw : (raw.fixtures ?? raw.matches ?? raw.teams)

const teams = listOf(read('teams.json')).map(t => ({ ...t, fihRank: t.fih_rank, fihPoints: t.fih_points }))
const fixtures = listOf(read('fixtures.json'))
  .map(m => ({ ...m, kickoffUtc: m.kickoffUtc ?? Date.parse(`${m.date}T${m.time ?? '12:00'}:00Z`) }))

const project = ms => projectBracket(teams, ms, computeStandings(teams, ms))
const b = project(fixtures)
const ids = new Set(fixtures.map(m => m.id))

console.log('Bracket projection')

// ── Every tie must be a real fixture ──────────────────────────────────────
ok('every projected tie matches a fixture id in the schedule',
   b.ties.every(t => ids.has(t.id)), b.ties.filter(t => !ids.has(t.id)).map(t => t.id).join(','))
ok('the six classification ties are the POS* fixtures',
   ['POS5', 'POS7', 'POS9', 'POS11', 'POS13', 'POS15'].every(id => b.byId.has(id)))
ok('no tie invents a match number the schedule does not have',
   b.ties.every(t => fixtures.find(m => m.id === t.id)?.matchNo != null))

// ── One ordering, used everywhere ─────────────────────────────────────────
const E = b.stage2.E, F = b.stage2.F
ok('each Stage-2 pool publishes a table of its four teams',
   Object.values(b.stage2).every(p => p.table.length === 4))
ok('the listed pool order IS the table order',
   Object.values(b.stage2).every(p => p.teams.join() === p.table.map(r => r.code).join()))
const sf1 = b.byId.get('SF1'), sf2 = b.byId.get('SF2')
ok('SF1 is 1st of Pool E v 2nd of Pool F — the same two the cards show',
   sf1.home === E.table[0].code && sf1.away === F.table[1].code,
   `${sf1.home} v ${sf1.away} vs table ${E.table[0].code}/${F.table[1].code}`)
ok('SF2 is 1st of Pool F v 2nd of Pool E',
   sf2.home === F.table[0].code && sf2.away === E.table[1].code,
   `${sf2.home} v ${sf2.away} vs table ${F.table[0].code}/${E.table[1].code}`)
ok('the four semi-finalists are exactly the teams marked → SF on the cards',
   new Set([sf1.home, sf1.away, sf2.home, sf2.away]).size === 4 &&
   [E.table[0], E.table[1], F.table[0], F.table[1]].every(r =>
     [sf1.home, sf1.away, sf2.home, sf2.away].includes(r.code)))
ok('5th/6th is 3rd E v 3rd F, 7th/8th is 4th E v 4th F',
   b.byId.get('POS5').home === E.table[2].code && b.byId.get('POS5').away === F.table[2].code &&
   b.byId.get('POS7').home === E.table[3].code && b.byId.get('POS7').away === F.table[3].code)
ok('9th-16th are drawn from Pools G and H in table order',
   ['POS9', 'POS11', 'POS13', 'POS15'].every((id, i) =>
     b.byId.get(id).home === b.stage2.G.table[i].code &&
     b.byId.get(id).away === b.stage2.H.table[i].code))

// ── The table has to be a table, not a ranking ─────────────────────────────
ok('the table is sorted by points, then wins, then goal difference',
   Object.values(b.stage2).every(p => p.table.every((r, i) => {
     const q = p.table[i - 1]
     return !q || q.pts > r.pts || (q.pts === r.pts && (q.w > r.w || (q.w === r.w && q.gd >= r.gd)))
   })))
ok('a carried Stage-1 result is counted in the Stage-2 table',
   Object.values(b.stage2).every(p => p.table.every(r => r.played >= 1)),
   JSON.stringify(Object.values(b.stage2).map(p => p.table.map(r => r.played))))
ok('each team has exactly three Stage-2 opponents (one carried, two to come)',
   Object.values(b.stage2).every(p => p.table.every(r => r.played + r.pending === 3)))
ok('no pool is called complete while matches are pending',
   Object.values(b.stage2).every(p => p.complete === p.table.every(r => r.pending === 0)))

// ── Locking is about the fixture, not about the calendar ──────────────────────
ok('a tie is locked only when its fixture names both teams, or it is played',
   b.ties.every(t => {
     const m = fixtures.find(x => x.id === t.id)
     const named = m && m.home !== 'TBD' && m.away !== 'TBD'
     return t.locked === Boolean(t.played || named)
   }), b.ties.filter(t => t.locked).map(t => t.id).join(','))
// A semi-final is settled exactly when its fixture names both nations — never
// because the calendar has moved on, and never while a slot still reads TBD.
// (This used to assert the semis were simply unlocked, which was true only for
// as long as Stage 2 was unfinished; once the pools resolved it failed on
// correct behaviour.)
for (const sf of [sf1, sf2]) {
  const m = fixtures.find(x => x.id === sf.id)
  const named = Boolean(m && m.home !== 'TBD' && m.away !== 'TBD')
  ok(`${sf.id} is settled only once both nations are named`,
     sf.locked === (named || Boolean(sf.played)),
     `locked=${sf.locked} named=${named}`)
}

// ── Real results outrank the projection ──────────────────────────────────
// Give Spain a 9-0 win over Germany — a real Stage-2 cross fixture, not the
// carried Stage-1 pairing — and it must climb the table. The pairing is reset
// to unplayed for the baseline first: once the real tournament plays it, a
// diff against live data would show no points change and the check would rot.
const isEspGer = m => m.phase === 'stage2' && m.pool === 'F' &&
  [m.home, m.away].includes('ESP') && [m.home, m.away].includes('GER')
const pairUnplayed = fixtures.map(m =>
  isEspGer(m) ? { ...m, status: 'scheduled', score: null } : m)
const b0 = project(pairUnplayed)
const spainWins = pairUnplayed.map(m =>
  isEspGer(m)
    ? { ...m, status: 'completed',
        score: m.home === 'ESP' ? { home: 9, away: 0 } : { home: 0, away: 9 } }
    : m)
const bw = project(spainWins)
const espBefore = b0.stage2.F.table.find(r => r.code === 'ESP')
const espAfter = bw.stage2.F.table.find(r => r.code === 'ESP')
const gerAfter = bw.stage2.F.table.find(r => r.code === 'GER')
ok('a win banks real points in place of the projected ones',
   espAfter.pts > espBefore.pts && espAfter.gd > espBefore.gd,
   `${espBefore.pts.toFixed(2)}/${espBefore.gd.toFixed(2)} -> ${espAfter.pts.toFixed(2)}/${espAfter.gd.toFixed(2)}`)
ok('the beaten side carries the defeat',
   gerAfter.gd < b0.stage2.F.table.find(r => r.code === 'GER').gd)
ok('the played pairing is no longer counted as pending',
   espAfter.played === espBefore.played + 1 && espAfter.pending === espBefore.pending - 1)
ok('the semi-final slots follow the table after a real result',
   bw.byId.get('SF2').home === bw.stage2.F.table[0].code &&
   bw.byId.get('SF1').away === bw.stage2.F.table[1].code)

// Enough real wins must overturn the projection outright.
const espSweeps = fixtures.map(m =>
  (m.phase === 'stage2' && m.pool === 'F' && [m.home, m.away].includes('ESP'))
    ? { ...m, status: 'completed',
        score: m.home === 'ESP' ? { home: 9, away: 0 } : { home: 0, away: 9 } }
    : m)
const bs = project(espSweeps)
ok('two real wins lift a projected last place above the teams it beat',
   bs.stage2.F.table.findIndex(r => r.code === 'ESP') <
   Math.min(bs.stage2.F.table.findIndex(r => r.code === 'BEL'),
            bs.stage2.F.table.findIndex(r => r.code === 'GER')),
   bs.stage2.F.table.map(r => `${r.code}:${r.pts.toFixed(1)}`).join(' '))

// ── A finished pool must read as fact ───────────────────────────────────
const allF = fixtures.map(m => m.phase === 'stage2' && m.pool === 'F'
  ? { ...m, status: 'completed', score: { home: 2, away: 1 } } : m)
const bf = project(allF)
ok('a completed pool is marked complete', bf.stage2.F.complete)
ok('a completed pool has whole-number points',
   bf.stage2.F.table.every(r => Number.isInteger(r.pts)),
   bf.stage2.F.table.map(r => r.pts).join(','))
ok('a completed pool has nothing pending',
   bf.stage2.F.table.every(r => r.pending === 0 && r.played === 3))

// ── Real Stage-2 standings (the Cup tab's tables, matching FIH's own) ───────
// Ground truth from the official standings page after 27 completed matches:
// Pool H read IRL P2 6pts 11:5 — the 7-4 over Malaysia PLUS the carried 4-1
// over South Africa from Stage 1. Carry-over is a fact of the format, not an
// option, and these checks pin it with synthetic fixtures.
console.log('\nReal Stage-2 standings (carry-over included)')
const { computeStage2Standings } = await import('../src/engine/standings.js')
const syn = [
  // Stage 1: AAA & BBB shared a pool (carried), CCC & DDD shared another.
  { id: 'P1', phase: 'pool', pool: 'X', home: 'AAA', away: 'BBB', status: 'completed', score: { home: 4, away: 1 } },
  { id: 'P2', phase: 'pool', pool: 'Y', home: 'CCC', away: 'DDD', status: 'completed', score: { home: 2, away: 2 } },
  // A Stage-1 match against a team OUTSIDE the Stage-2 pool must not count.
  { id: 'P3', phase: 'pool', pool: 'X', home: 'AAA', away: 'ZZZ', status: 'completed', score: { home: 9, away: 0 } },
  // Stage 2 pool Q: one cross fixture played, three to come.
  { id: 'S1', phase: 'stage2', pool: 'Q', home: 'AAA', away: 'DDD', status: 'completed', score: { home: 7, away: 4 } },
  { id: 'S2', phase: 'stage2', pool: 'Q', home: 'BBB', away: 'CCC', status: 'scheduled', score: null },
  { id: 'S3', phase: 'stage2', pool: 'Q', home: 'AAA', away: 'CCC', status: 'scheduled', score: null },
  { id: 'S4', phase: 'stage2', pool: 'Q', home: 'BBB', away: 'DDD', status: 'scheduled', score: null },
]
const [q] = computeStage2Standings(syn)
const row = c => q.standings.find(r => r.team === c)
ok('the carried Stage-1 result counts as played', row('AAA').played === 2 && row('BBB').played === 1)
ok('the IRL shape reproduces: 2 wins, carried + cross goals summed',
   row('AAA').w === 2 && row('AAA').pts === 6 && row('AAA').gf === 11 && row('AAA').ga === 5,
   JSON.stringify(row('AAA')))
ok('a carried draw scores one point', row('CCC').pts === 1 && row('CCC').d === 1)
ok('a Stage-1 match against a non-member never leaks in', row('AAA').gf === 11)
ok('cross-fixture progress is 1/4', q.crossPlayed === 1 && q.crossTotal === 4)
ok('W/D/L splits are explicit', row('DDD').d === 1 && row('DDD').l === 1 && row('DDD').played === 2)

// FIH tie-break: level on points, wins, GD and GF → the head-to-head decides.
// The live case: ESP and GER both 3pts/1W/0GD/2GF, ESP beat GER — ESP ranks
// higher even though GER sorts first alphabetically... (GER < ESP is false:
// 'ESP' < 'GER' alphabetically). Use codes where alphabet and h2h disagree.
// MMM and AAA end dead level — P2, W1 L1, GF3 GA3, 3pts — and MMM won their
// meeting, so MMM ranks above AAA even though the alphabet says otherwise.
const tie = [
  { id: 'T1', phase: 'stage2', pool: 'R', home: 'MMM', away: 'AAA', status: 'completed', score: { home: 2, away: 1 } },
  { id: 'T2', phase: 'stage2', pool: 'R', home: 'AAA', away: 'QQQ', status: 'completed', score: { home: 2, away: 1 } },
  { id: 'T3', phase: 'stage2', pool: 'R', home: 'NNN', away: 'MMM', status: 'completed', score: { home: 2, away: 1 } },
  { id: 'T4', phase: 'stage2', pool: 'R', home: 'MMM', away: 'QQQ', status: 'scheduled', score: null },
]
const [r2] = computeStage2Standings(tie)
const orderR = r2.standings.map(r => r.team)
ok('head-to-head outranks the alphabet on a dead-level tie',
   orderR.indexOf('MMM') < orderR.indexOf('AAA'), orderR.join(','))

console.log(fail ? `\n${fail} FAILED` : '\nAll bracket checks passed.')
process.exit(fail ? 1 : 0)
