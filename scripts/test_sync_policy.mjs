// When does the app refetch? The bug these checks exist for: the app trusted
// its own version stamp, decided it was up to date, and rendered every tab
// empty because the rows behind that stamp were gone.
import { needsResync } from '../src/syncPolicy.js'

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n, d) } }
const R = { version: 84 }

console.log('Sync policy')
ok('an empty store resyncs even when the version says fresh',
   needsResync({ empty: true, localMeta: { version: 84 }, remote: R }).resync)
ok('and says why', needsResync({ empty: true, localMeta: { version: 84 }, remote: R }).reason === 'empty-store')
ok('a populated store at the published version does not refetch',
   !needsResync({ empty: false, localMeta: { version: 84 }, remote: R }).resync)
ok('a populated store behind the published version refetches',
   needsResync({ empty: false, localMeta: { version: 83 }, remote: R }).resync)
ok('a first run with no local stamp refetches',
   needsResync({ empty: false, localMeta: null, remote: R }).reason === 'never-synced')
ok('force always refetches',
   needsResync({ force: true, empty: false, localMeta: { version: 99 }, remote: R }).resync)
ok('a local stamp AHEAD of the server is left alone',
   !needsResync({ empty: false, localMeta: { version: 99 }, remote: R }).resync)
ok('no remote version means no destructive refetch',
   !needsResync({ empty: true, localMeta: { version: 84 }, remote: null }).resync)
ok('a malformed remote version is treated as no version',
   !needsResync({ empty: true, localMeta: { version: 84 }, remote: { version: 'x' } }).resync)
ok('a malformed local stamp is not trusted',
   needsResync({ empty: false, localMeta: { version: null }, remote: R }).resync)
ok('every outcome carries a reason',
   ['forced', 'no-remote-version', 'empty-store', 'never-synced', 'stale', 'fresh'].includes(
     needsResync({ empty: false, localMeta: { version: 84 }, remote: R }).reason))

console.log(fail ? `\n${fail} FAILED` : '\nAll sync-policy checks passed.')
process.exit(fail ? 1 : 0)
