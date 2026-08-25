// Hockey.AI — the official team sheet must be read exactly, or not at all.
// The rows carry both teams side by side and a name can be one word or four,
// so the split is the thing most likely to go quietly wrong.
import { readFileSync } from 'node:fs'
const FIX = JSON.parse(readFileSync(new URL('../public/data/fixtures.json', import.meta.url)))

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

const official = FIX.matches.filter(m => (m.lineups ?? {}).source === 'official')
console.log(`Official team sheets (${official.length} of ${FIX.matches.length} matches)`)

if (!official.length) {
  console.log('  ..   none adopted yet — the pipeline reads them in CI.')
  process.exit(0)
}

check('every official sheet fields eleven a side',
  official.every(m => m.lineups.home.startingXI.length === 11
                   && m.lineups.away.startingXI.length === 11),
  official.filter(m => m.lineups.home.startingXI.length !== 11).map(m => m.id).join(','))

check('every starter is marked as having started',
  official.every(m => ['home', 'away'].every(s =>
    m.lineups[s].startingXI.every(p => p.started === true))))

check('no substitute is marked as having started',
  official.every(m => ['home', 'away'].every(s =>
    m.lineups[s].substitutes.every(p => p.started === false))))

check('a substitute who came on carries the minute he came on',
  official.every(m => ['home', 'away'].every(s =>
    m.lineups[s].substitutes.every(p =>
      p.played === (p.on_minute !== null && p.on_minute !== undefined)))))

check('every stated minute falls inside a match',
  official.every(m => ['home', 'away'].every(s =>
    m.lineups[s].substitutes.every(p => p.on_minute == null || (p.on_minute >= 0 && p.on_minute <= 70)))))

check('each side fields exactly one goalkeeper',
  official.every(m => ['home', 'away'].every(s =>
    m.lineups[s].startingXI.filter(p => p.goalkeeper).length === 1)),
  official.filter(m => m.lineups.home.startingXI.filter(p => p.goalkeeper).length !== 1)
    .map(m => m.id).join(','))

check('no player appears twice on one sheet',
  official.every(m => ['home', 'away'].every(s => {
    const all = [...m.lineups[s].startingXI, ...m.lineups[s].substitutes].map(p => p.number)
    return new Set(all).size === all.length
  })))

check('every named player belongs to that team',
  official.every(m => ['home', 'away'].every(s =>
    [...m.lineups[s].startingXI, ...m.lineups[s].substitutes]
      .every(p => (p.playerId ?? '').startsWith(m[s])))))

check('no sheet invents a substitution time',
  official.every(m => ['home', 'away'].every(s =>
    m.lineups[s].startingXI.every(p => p.on_minute == null))))

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll official-team-sheet checks passed.')
process.exit(failed ? 1 : 0)
