// One model, one published accuracy figure.
//
// This app has twice shipped two different records of the same model on the
// same screen, because four pages each reached into the calibration file for
// whichever field they liked and two different denominators were available.
// The file now carries one figure and the pages share one helper.
//
// publishedAccuracy() in src/engine/prediction.js is now the single place that
// decides. These checks keep it that way: no other source file may reach into
// a calibration field, and the helper must agree with itself across the
// schemas a client can actually be holding.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { publishedAccuracy } from '../src/engine/prediction.js'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const OWNER = 'engine/prediction.js'      // the one file allowed to read them
const FIELDS = /\b(accuracy_pct|winner_named_pct|winner_named|decisive_matches|draws_called)\b/

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n, d) } }

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name)
  return e.isDirectory() ? walk(p) : (/\.(jsx?|mjs)$/.test(e.name) ? [p] : [])
})

console.log('One published accuracy figure')

const offenders = walk(SRC)
  .filter(p => !p.replaceAll('\\', '/').endsWith(OWNER))
  .filter(p => FIELDS.test(fs.readFileSync(p, 'utf8')))
  .map(p => path.relative(SRC, p))
ok('only the engine reads calibration accuracy fields', offenders.length === 0,
   `${offenders.join(', ')} — call publishedAccuracy() instead`)

// Every screen that shows a number must go through the helper.
const shows = walk(SRC).filter(p => /correct ·|hero-accuracy-pct|% of decisive/.test(fs.readFileSync(p, 'utf8')))
const routed = shows.filter(p => /publishedAccuracy/.test(fs.readFileSync(p, 'utf8')))
ok('every screen showing an accuracy uses the helper', shows.length === routed.length,
   shows.filter(p => !routed.includes(p)).map(p => path.relative(SRC, p)).join(', '))
ok('at least one screen shows it', shows.length > 0, String(shows.length))

// The published figure is the decisive one whenever the data carries it.
const live = JSON.parse(fs.readFileSync(new URL('../public/data/model-calibration.json', import.meta.url), 'utf8'))
const r = publishedAccuracy(live, null)
ok('the published figure is the whole three-way record', r.basis === 'all-matches', r.basis)
ok('numerator and denominator come from the same basis',
   r.correct === live.correct && r.graded === live.matches,
   `${r.correct}/${r.graded} vs ${live.correct}/${live.matches}`)
ok('the denominator is every non-knockout match, not a subset',
   r.graded === live.matches && r.graded > 0, `${r.graded} vs matches=${live.matches}`)
// A second percentage on a different denominator is exactly how two records of
// the same model ended up on the same screen. The published file carries one.
ok('the published file carries a single accuracy figure',
   Object.keys(live).filter(k => /_pct$|^accuracy|^correct$/.test(k)).sort().join(',')
     === 'accuracy_pct,correct',
   Object.keys(live).filter(k => /_pct$|^accuracy|^correct$/.test(k)).join(','))
ok('the percentage matches its own fraction',
   Math.abs(Math.round((r.correct / r.graded) * 100) - r.pct) <= 1, `${r.pct}%`)
ok('draws are reported alongside the headline, from the same file',
   r.drawsCalled === live.draws_called && r.draws === live.draws,
   JSON.stringify({ drawsCalled: r.drawsCalled, draws: r.draws }))

// A client holding an older calibration must still show a coherent number.
const legacy = publishedAccuracy({ correct: 25, matches: 40, accuracy_pct: 62 }, null)
ok('an older calibration still yields one coherent figure',
   legacy.basis === 'all-matches' && legacy.correct === 25 && legacy.graded === 40 && legacy.pct === 62,
   JSON.stringify(legacy))
const none = publishedAccuracy(null, { correct: 9, graded: 12, accuracyPct: 75 })
ok('with no calibration at all it falls back to the graded tally',
   none.basis === 'client-tally' && none.pct === 75, JSON.stringify(none))

console.log(fail ? `\n${fail} FAILED` : '\nAll accuracy-consistency checks passed.')
process.exit(fail ? 1 : 0)
