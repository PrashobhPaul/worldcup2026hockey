// Tier assignment — the badge rules the Teams grid publishes.
//
// The point of these checks is restraint: exactly six of the sixteen carry a
// tag, the quota never drifts, and a team that is out of contention is never
// called a favourite on the way out.
import { assignTiers, TIER_QUOTA, expectedPPM, actualPPM, overachievement, medianRank } from '../src/engine/tiers.js'

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n, d) } }

const T = (code, rank, form = null) => ({ code, fihRank: rank, form })
const form = (played, wins, draws, losses, gf, ga) => ({ played, wins, draws, losses, gf, ga })

console.log('Tier assignment')

// Sixteen teams ranked 1..16. Champion probability follows the ranking, so the
// favourites are unambiguous; form is where the interest lives.
const codes = ['NED','BEL','AUS','IND','GER','ENG','ARG','ESP','IRL','FRA','NZL','KOR','JPN','MAS','RSA','CHI']
const ranks = Object.fromEntries(codes.map((c, i) => [c, i + 1]))
const champ = Object.fromEntries(codes.map((c, i) => [c, (16 - i) / 136]))

// Bottom-half sides beating their ranking: MAS (#14) hardest, FRA (#10) next.
const forms = {
  MAS: form(3, 3, 0, 0, 9, 2),   // 3.00 ppm vs 0.91 expected
  FRA: form(3, 2, 1, 0, 7, 3),   // 2.33 ppm vs 1.43 expected
  ESP: form(3, 2, 0, 1, 6, 5),   // 2.00 ppm vs 1.69 expected
  NED: form(3, 3, 0, 0, 12, 1),
  BEL: form(3, 2, 1, 0, 8, 2),
  AUS: form(3, 2, 0, 1, 7, 4),
  CHI: form(3, 0, 0, 3, 1, 12),
}
const teams = codes.map(c => T(c, ranks[c], forms[c] ?? form(3, 1, 0, 2, 3, 5)))
const tiers = assignTiers({ teams, championOf: c => champ[c], isOut: () => false })

ok('exactly six teams are tagged', tiers.size === 6, `${tiers.size}`)
ok('the quota is 3 / 2 / 1', TIER_QUOTA.favourite === 3 && TIER_QUOTA.dark_horse === 2 && TIER_QUOTA.underdog === 1)
const count = tier => [...tiers.values()].filter(v => v === tier).length
ok('three favourites', count('favourite') === 3, `${count('favourite')}`)
ok('two dark horses', count('dark_horse') === 2, `${count('dark_horse')}`)
ok('one underdog', count('underdog') === 1, `${count('underdog')}`)
ok('the ten remaining teams carry no tag',
   codes.filter(c => !tiers.has(c)).length === 10)
ok('favourites are the three most likely champions',
   ['NED','BEL','AUS'].every(c => tiers.get(c) === 'favourite'), JSON.stringify([...tiers]))
ok('no team holds two tags', new Set(tiers.keys()).size === tiers.size)
ok('every tag is one of the three published labels',
   [...tiers.values()].every(v => ['favourite','dark_horse','underdog'].includes(v)))

// The underdog is a bottom-half side, and it is the biggest overachiever there.
const underdog = [...tiers].find(([, v]) => v === 'underdog')?.[0]
ok('the underdog comes from the bottom half of the ranking',
   ranks[underdog] >= 9, `${underdog} is #${ranks[underdog]}`)
ok('the halfway line of the opening sixteen is 8.5', medianRank(teams) === 8.5, String(medianRank(teams)))
ok('the underdog is the biggest bottom-half overachiever', underdog === 'MAS', String(underdog))
ok('a top-eight overachiever is a dark horse, never an underdog',
   tiers.get('ESP') !== 'underdog')

// Once the pools finish, everyone ranked 9-16 is out of contention. The
// underdog is measured against the field that is left, or the label would
// retire itself for the rest of the tournament.
const lastEight = ['NED','BEL','AUS','IND','GER','ENG','ARG','ESP']
const late = assignTiers({
  teams,
  championOf: c => (lastEight.includes(c) ? champ[c] : 0),
  isOut: c => !lastEight.includes(c),
})
const lateUnderdog = [...late].find(([, v]) => v === 'underdog')?.[0]
ok('a surviving field of eight still has an underdog', !!lateUnderdog, JSON.stringify([...late]))
ok('the late underdog is drawn from the weaker half of the survivors',
   lateUnderdog && ranks[lateUnderdog] > medianRank(teams.filter(t => lastEight.includes(t.code))),
   `${lateUnderdog} is #${ranks[lateUnderdog]}`)
ok('the late underdog is never one of the surviving favourites',
   late.get(lateUnderdog) === 'underdog' && !['NED','BEL','AUS'].includes(lateUnderdog))
ok('six tags survive the cut to eight teams', late.size === 6, `${late.size}`)

// Elimination.
const outCodes = new Set(['NED','BEL'])
const cut = assignTiers({ teams, championOf: c => (outCodes.has(c) ? 0 : champ[c]), isOut: c => outCodes.has(c) })
ok('eliminated teams are never tagged', ![...outCodes].some(c => cut.has(c)), JSON.stringify([...cut]))
ok('the favourite quota refills from the teams still alive',
   [...cut.values()].filter(v => v === 'favourite').length === 3)
ok('still exactly six tags after two eliminations', cut.size === 6, `${cut.size}`)

// Before a ball is hit there is no form, and the engine must not invent any.
const fresh = codes.map(c => T(c, ranks[c], form(0, 0, 0, 0, 0, 0)))
const pre = assignTiers({ teams: fresh, championOf: c => champ[c], isOut: () => false })
ok('an unplayed tournament still tags exactly six', pre.size === 6, `${pre.size}`)
ok('with no matches played nobody is judged on form',
   actualPPM(form(0, 0, 0, 0, 0, 0)) === null && overachievement(fresh[0]) === null)

// Degenerate inputs must not throw or fabricate.
ok('no teams yields no tags', assignTiers({ teams: [], championOf: () => 0, isOut: () => false }).size === 0)
ok('a fully eliminated field yields no tags',
   assignTiers({ teams, championOf: () => 0, isOut: () => true }).size === 0)
ok('a four-team field never tags more teams than it has',
   assignTiers({ teams: teams.slice(0, 4), championOf: c => champ[c], isOut: () => false }).size <= 4)

// The expectation curve only has to be monotonic — it is a ranking device.
ok('expected points per match falls with ranking',
   codes.every((c, i) => i === 0 || expectedPPM(i + 1) < expectedPPM(i)))
ok('expectation is clamped outside 1..16',
   expectedPPM(0) === expectedPPM(1) && expectedPPM(99) === expectedPPM(16))
ok('a missing rank does not crash the curve', Number.isFinite(expectedPPM(undefined)))
ok('overachievement rewards beating the ranking',
   overachievement(T('MAS', 14, forms.MAS)) > overachievement(T('NED', 1, forms.NED)))

console.log(fail ? `\n${fail} FAILED` : '\nAll tier checks passed.')
process.exit(fail ? 1 : 0)
