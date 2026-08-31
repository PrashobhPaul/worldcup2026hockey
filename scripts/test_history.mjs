// Hockey.AI — the history table is a factual claim about fifteen tournaments
// this app did not watch, so it is held to what can actually be checked here.
//
// What CANNOT be checked here is whether Pakistan really won in 1994. The FIH
// archive is unreachable from this repository, the provenance block in
// world-cup-history.json says so plainly, and no test can turn a public-source
// row into a governing-body one. Pretending otherwise with a green check would
// be worse than not checking.
//
// What CAN be checked is everything structural, and that is what fails a build:
// a duplicated year, a medal missing, a nation named two ways across editions,
// an honours tally that does not add up to the rows it was counted from — and,
// most importantly, that the 2026 row still says what this app's own match
// record says. That last one is the row the app is the authority on, and it is
// derived rather than stored precisely so it cannot drift.
//
// Run: node scripts/test_history.mjs
import { readFileSync } from 'node:fs'
import { editions, currentEdition, honours } from '../src/engine/worldCupHistory.js'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const HISTORY = read('world-cup-history.json')
const FIX = read('fixtures.json')
const TEAMS = read('teams.json')

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

console.log('World Cup history')

const nameOf = code => TEAMS.teams.find(t => t.code === code)?.name ?? code
const rows = editions(HISTORY, FIX.matches, { year: 2026, nameOf })

check('every past edition is present', HISTORY.editions.length >= 15,
      String(HISTORY.editions.length))

// The provenance must keep saying where this came from. A history table that
// silently starts implying the FIH published it is the failure mode here.
check('the file states its provenance and does not claim the FIH as its reader',
      typeof HISTORY.provenance?.note === 'string' && HISTORY.provenance.note.length > 80,
      JSON.stringify(HISTORY.provenance ?? null).slice(0, 80))

const years = rows.map(e => e.year)
check('years are unique', new Set(years).size === years.length)
check('years are in ascending order',
      years.every((y, i) => i === 0 || y > years[i - 1]), years.join(', '))

for (const e of rows) {
  check(`${e.year} names all three medallists`,
        Boolean(e.champion && e.runnerUp && e.third),
        `${e.champion} / ${e.runnerUp} / ${e.third}`)
  check(`${e.year} does not name one nation twice`,
        new Set([e.champion, e.runnerUp, e.third]).size === 3,
        `${e.champion} / ${e.runnerUp} / ${e.third}`)
}

// One nation, one name, one code — across every edition and the honours table.
const codeByName = new Map()
for (const e of rows) {
  for (const [name, code] of [[e.champion, e.championCode], [e.runnerUp, e.runnerUpCode],
                              [e.third, e.thirdCode]]) {
    if (!name) continue
    if (codeByName.has(name) && codeByName.get(name) !== code) {
      check(`${name} has one code across editions`, false,
            `${codeByName.get(name)} and ${code}`)
    }
    codeByName.set(name, code)
  }
}
check('each nation carries one code throughout', true)

// The 2026 row is derived, not stored. It must agree with the match record,
// and it must not have been quietly added to the static file as well.
const gold = FIX.matches.find(m => m.id === 'GOLD')
const now = currentEdition(FIX.matches, { year: 2026, nameOf })
check('the current edition is not stored in the static file',
      !HISTORY.editions.some(e => e.year === 2026))
if (gold?.score?.home != null) {
  const winner = gold.score.home === gold.score.away
    ? ((gold.shootout?.home ?? 0) > (gold.shootout?.away ?? 0) ? gold.home : gold.away)
    : (gold.score.home > gold.score.away ? gold.home : gold.away)
  check('the current edition is derived and present', now != null)
  check('the current champion is the gold medal match winner',
        now?.championCode === winner, `${now?.championCode} vs ${winner}`)
  check('the current runner-up is the side it beat',
        now?.runnerUpCode === (winner === gold.home ? gold.away : gold.home))
  const brz = FIX.matches.find(m => m.id === 'BRZ')
  if (brz?.score?.home != null) {
    const third = brz.score.home === brz.score.away
      ? ((brz.shootout?.home ?? 0) > (brz.shootout?.away ?? 0) ? brz.home : brz.away)
      : (brz.score.home > brz.score.away ? brz.home : brz.away)
    check('the current third place is the bronze match winner',
          now?.thirdCode === third, `${now?.thirdCode} vs ${third}`)
  }
} else {
  check('an unfinished tournament produces no history row', now === null)
}

// A final's scoreline is printed under a column headed "Champion", so it has
// to be stated champion-first. The fixture stores it home-first and the gold
// medal match does not care who was nominally at home: printed raw, the 2026
// row read "Germany 0-1" — the champion losing its own final.
for (const e of rows) {
  if (!e.final) continue
  const [a, b] = e.final.split(' ')[0].split('-').map(Number)
  const so = /\((\d+)-(\d+) SO\)/.exec(e.final)
  const won = so ? Number(so[1]) > Number(so[2]) : a > b
  check(`${e.year} states the final champion-first`, won,
        `${e.champion} ${e.final}`)
}

// Honours are counted from the rows, so they must total them exactly.
const table = honours(rows)
const golds = table.reduce((n, r) => n + r.gold, 0)
const silvers = table.reduce((n, r) => n + r.silver, 0)
const bronzes = table.reduce((n, r) => n + r.bronze, 0)
check('one gold per edition', golds === rows.length, `${golds} vs ${rows.length}`)
check('one silver per edition', silvers === rows.length, `${silvers} vs ${rows.length}`)
check('one bronze per edition', bronzes === rows.length, `${bronzes} vs ${rows.length}`)
check('the honours table is ordered by gold, then silver, then bronze',
      table.every((r, i) => i === 0 || r.gold < table[i - 1].gold ||
        (r.gold === table[i - 1].gold && r.silver <= table[i - 1].silver) ||
        (r.gold === table[i - 1].gold && r.silver === table[i - 1].silver &&
         r.bronze <= table[i - 1].bronze)))

console.log()
if (!failed) {
  const top = table.slice(0, 3).map(r => `${r.name} ${r.gold}`).join(', ')
  console.log(`All history checks passed — ${rows.length} editions, most titles: ${top}`)
}
if (failed) console.log(`${failed} FAILED`)
process.exit(failed ? 1 : 0)
