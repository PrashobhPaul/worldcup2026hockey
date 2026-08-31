// Hockey.AI — a closed record must behave like one.
//
// The tournament is over. The published set cannot change again, and three
// faults on a reader's phone all came from an app that did not know that:
//
//   * RETRY on a complete record. The app polled a feed that could never
//     report anything new, and enough of those requests failing in a row lit a
//     warning next to a tournament that was fully present and correct.
//
//   * The match count climbing on every launch. The worker took control of the
//     page that had just installed it, which fires the same event a genuine
//     update does, so the app reloaded — loading, syncing, and then doing the
//     whole thing again.
//
//   * The official awards never appearing. Side documents were fetched only
//     during a full resync, and a resync only happens when the stamp moves. A
//     build that ADDED a file could not reach a device already holding the
//     current stamp: it had nothing to resync to.
//
// Each of those is a one-line condition that is easy to reintroduce and
// invisible without a check, so each is checked here.
//
// Run: node scripts/test_frozen_record.mjs
import { readFileSync } from 'node:fs'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')

let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

console.log('Frozen record')

// --- The flag is derived, never asserted ----------------------------------
const version = read('data-version.json')
const matches = read('fixtures.json').matches
const allPlayed = matches.length > 0 && matches.every(
  m => m.status === 'completed' && m.score?.home != null)

check('data-version says final exactly when every fixture has been played',
      Boolean(version.final) === allPlayed,
      `final=${version.final}, all played=${allPlayed}`)
if (allPlayed) {
  check('a finished tournament is marked final', version.final === true)
}

// --- Every meta-backed document is in the backfill list --------------------
//
// The awards fault was a document the sync knew how to fetch on a resync and
// nowhere else. Any document a page reads out of `meta` has to be one the sync
// will fetch when it is missing, or the same fault returns with a new file.
const sync = src('sync.js')
const backfilled = [...sync.matchAll(/\['([a-zA-Z]+)',\s*'([a-z-]+\.json)'\]/g)].map(m => m[1])
const pagesAndComponents = ['pages/Awards.jsx', 'components/RecordsView.jsx',
                            'components/HistoryView.jsx', 'pages/Trust.jsx']
const readIds = new Set()
for (const f of pagesAndComponents) {
  for (const m of src(f).matchAll(/db\.meta\.get\('([a-zA-Z]+)'\)/g)) readIds.add(m[1])
}
check('the UI reads at least one meta document', readIds.size > 0, [...readIds].join(', '))
for (const id of readIds) {
  // `data` is the stamp itself and `calibration` is refreshed on every check;
  // everything else has to be backfillable.
  if (id === 'data' || id === 'calibration') continue
  check(`a missing '${id}' document would be backfilled`, backfilled.includes(id),
        `backfill list: ${backfilled.join(', ')}`)
}

// --- Polling stops, and the reload only happens on a real update -----------
check('a closed record stops the sync loop',
      /recordIsFinal\(\)/.test(sync) && /stop\(\)/.test(sync),
      'nothing in sync.js stops polling on a final record')

const main = src('main.jsx')
check('the app does not reload itself on a first service-worker install',
      /hadController/.test(main)
      && /if \(!hadController \|\| reloading\) return/.test(main),
      'controllerchange reloads unconditionally, which fires on a first install too')

// --- The chip cannot cry wolf over a complete record -----------------------
const chip = src('components/SyncChip.jsx')
check('a complete record on the device never reads as trouble',
      /!finished && \(status\.state === 'error' \|\| status\.state === 'offline'\)/.test(chip),
      'the chip still reports network trouble over a finished, fully present record')

console.log()
if (failed) console.log(`${failed} frozen-record check(s) FAILED`)
else console.log('All frozen-record checks passed.')
process.exit(failed ? 1 : 0)
