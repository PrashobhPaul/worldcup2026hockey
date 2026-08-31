// Hockey.AI — an award winner is a person's name, published as fact.
//
// This is the highest-risk data in the repository. Every other published
// figure is derived from the match record and can be recomputed from it; an
// award winner cannot. It arrives as four names from outside, and a wrong one
// is not a rounding error — it is this app telling its readers that somebody
// won a World Cup award they did not win.
//
// The FIH is the authority and is unreachable from where this was recorded, so
// the names cannot be checked against their source here. What CAN be checked is
// that each one is a real player, on the nation the award says, doing the job
// the award implies — against the official FIH team lists this app does hold.
// A fabricated or misattributed name fails every one of those:
//
//   * the winner exists in players.json, on the stated team;
//   * the goalkeeper award went to someone the team sheets list as a keeper;
//   * the top scorer's goal count matches our own event ledger AND is the
//     outright tournament lead — so the award and the Top Scorers board can
//     never print different numbers for the same man;
//   * the young-player award went to the youngest quarter of the field;
//   * nothing is graded against an award that was not announced.
//
// Run: node scripts/test_awards.mjs
import { readFileSync } from 'node:fs'
import { gradeAwards, sameName } from '../src/engine/awardsOfficial.js'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

let DOC = null
try { DOC = read('awards.json') } catch { /* not announced yet */ }

if (!DOC) {
  console.log('No awards committed — nothing to verify.')
  console.log('The Awards tab shows the Oracle race alone until the FIH announces winners.')
  process.exit(0)
}

console.log('Official awards')

const PLAYERS = read('players.json').players
const FIX = read('fixtures.json').matches
const TEAMS = read('teams.json').teams

const find = (name, team) => PLAYERS.find(p => sameName(p.name, name) && p.team === team)

check('the file declares itself official', DOC.state === 'official', String(DOC.state))
check('it says where the names came from',
      typeof DOC.provenance?.note === 'string' && DOC.provenance.note.length > 80)

// Goals, counted from the ledger rather than trusted from the player row.
const ledger = new Map()
for (const m of FIX) {
  for (const e of m.events ?? []) {
    if (e.type === 'goal') ledger.set(e.player, (ledger.get(e.player) ?? 0) + 1)
  }
}
const best = Math.max(...ledger.values())

for (const a of DOC.awards ?? []) {
  if (!a.winner) continue
  const p = find(a.winner, a.team)
  check(`${a.key}: ${a.winner} is on the ${a.team} team list`, Boolean(p),
        p ? '' : 'not in players.json for that nation')
  if (!p) continue

  check(`${a.key}: the nation is a real one`,
        TEAMS.some(t => t.code === a.team), a.team)

  if (a.key === 'best_goalkeeper') {
    const pos = p.position_effective ?? p.position ?? ''
    check(`${a.key}: ${a.winner} is listed as a goalkeeper`,
          /goalkeeper/i.test(pos), pos || 'no position on the record')
  }

  if (a.key === 'top_scorer') {
    const scored = ledger.get(p.name) ?? 0
    check(`${a.key}: the stated ${a.goals} goals match the event ledger (${scored})`,
          a.goals === scored, `${a.goals} vs ${scored}`)
    check(`${a.key}: ${a.winner} leads the tournament outright`,
          scored === best && [...ledger.values()].filter(v => v === best).length === 1,
          `${scored} vs best ${best}`)
    check(`${a.key}: players.json agrees with the ledger`,
          (p.goals ?? 0) === scored, `${p.goals} vs ${scored}`)
  }

  if (a.key === 'rising_star' && p.dob) {
    // "Young player" is not a number the FIH publishes a threshold for, so
    // this asserts only what would catch a misattribution: the winner is
    // genuinely among the younger players here, not a thirty-year-old.
    const year = n => Number(String(n).match(/(\d{4})/)?.[1])
    const born = year(p.dob)
    const all = PLAYERS.map(x => year(x.dob)).filter(Boolean).sort((x, y) => y - x)
    const cut = all[Math.floor(all.length / 4)]
    check(`${a.key}: ${a.winner} is among the youngest quarter of the field`,
          Boolean(born) && born >= cut, `born ${born}, cut ${cut}`)
  }
}

// Grading must never invent a verdict for an award nobody won.
const graded = gradeAwards(DOC, [])
check('only announced awards are graded',
      graded.length === (DOC.awards ?? []).filter(a => a.winner).length)
check('an unannounced award carries no grade',
      (DOC.notAnnounced ?? []).every(n => !(DOC.awards ?? []).some(a => a.key === n.key && a.winner)))

// The grade itself has to be able to say "missed". A grader that can only
// return true is not a grader, and this repository has shipped one of those
// before.
const hof = [{ key: 'top_scorer', oraclePick: 'Somebody Else', oraclePickTeam: 'IND' }]
const marked = gradeAwards(DOC, hof).find(a => a.key === 'top_scorer')
check('a wrong pre-tournament pick is graded as a miss', marked?.called === false,
      String(marked?.called))
const hofRight = [{ key: 'top_scorer', oraclePick: DOC.awards.find(a => a.key === 'top_scorer')?.winner }]
check('a right pre-tournament pick is graded as a hit',
      gradeAwards(DOC, hofRight).find(a => a.key === 'top_scorer')?.called === true)

console.log()
if (failed) console.log(`${failed} award check(s) FAILED`)
else console.log(`All award checks passed — ${(DOC.awards ?? []).length} awards.`)
process.exit(failed ? 1 : 0)
