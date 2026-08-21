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
// The counter can stand still while the content moves — a merge keeps one
// side's data-version.json and both sides' data. That is what left published
// briefs unreachable behind an unchanged version number.
ok('a changed fingerprint under an unchanged version resyncs',
   needsResync({ empty: false, localMeta: { version: 84, fingerprint: 'aaaa' },
                 remote: { version: 84, fingerprint: 'bbbb' } }).resync)
ok('and says the content changed',
   needsResync({ empty: false, localMeta: { version: 84, fingerprint: 'aaaa' },
                 remote: { version: 84, fingerprint: 'bbbb' } }).reason === 'content-changed')
ok('a matching fingerprint does not refetch',
   !needsResync({ empty: false, localMeta: { version: 84, fingerprint: 'aaaa' },
                  remote: { version: 84, fingerprint: 'aaaa' } }).resync)
ok('a server with no fingerprint still behaves as before',
   !needsResync({ empty: false, localMeta: { version: 84, fingerprint: 'aaaa' },
                  remote: { version: 84 } }).resync)
ok('a client that has never seen a fingerprint picks one up',
   needsResync({ empty: false, localMeta: { version: 84 },
                 remote: { version: 84, fingerprint: 'bbbb' } }).resync)
ok('a lower version still wins over a matching fingerprint',
   needsResync({ empty: false, localMeta: { version: 83, fingerprint: 'aaaa' },
                 remote: { version: 84, fingerprint: 'aaaa' } }).reason === 'stale')

ok('every outcome carries a reason',
   ['forced', 'no-remote-version', 'empty-store', 'never-synced', 'stale', 'content-changed', 'fresh'].includes(
     needsResync({ empty: false, localMeta: { version: 84 }, remote: R }).reason))

console.log(fail ? `\n${fail} FAILED` : '\nAll sync-policy checks passed.')
process.exit(fail ? 1 : 0)
