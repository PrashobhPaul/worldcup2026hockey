// Hockey.AI — the OFFLINE light has to be worth reading.
//
// The chip went amber OFFLINE on phones that were plainly online. Two things
// put it there. sync.js appended a unique `?t=` to every data request, so the
// service worker's NetworkFirst rule for /data/ could never fall back to its
// own cache — the lookup missed on a URL it had never stored — and on a slow
// connection the handler's timeout turned an ordinary slow response into a
// hard failure. Then two of those failures were taken as proof of an absent
// network, when a redeploy landing mid-request produces exactly the same
// shape.
//
// So OFFLINE is now gated on navigator.onLine, the one signal trustworthy in
// the negative. This drives a real browser to hold it to that: the feed is
// broken while the network stays up, and the word must not appear.
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core && npm run test:offline
let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.error('test:offline needs playwright-core: npm i --no-save playwright-core')
  process.exit(2)
}
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:4173'

let fail = 0
const ok = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { fail++; console.log('  FAIL', n, d) } }

const b = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const ctx = await b.newContext()
const page = await ctx.newPage()

/** The word the sync chip is showing right now. */
const chip = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('button span')]
    .find(s => /^(LIVE|COMPLETE|SYNCING|OFFLINE|RETRY|SYNC)$/.test(s.textContent.trim()))
  return el ? el.textContent.trim() : '(none)'
})
const waitFor = async (pred, ms = 30000) => {
  const t0 = Date.now()
  for (;;) {
    const w = await chip()
    if (pred(w)) return true
    if (Date.now() - t0 > ms) return false
    await page.waitForTimeout(500)
  }
}

// The healthy word depends on the tournament, not on this file: LIVE while
// there are matches left, COMPLETE once there are none. "LIVE 50/50" in the
// header of a tournament whose gold final has been played says the tournament
// is still on, which is why the chip stopped saying it — and why the expected
// word is read from the fixtures rather than written down here, so this gate
// is still right for the next tournament without being edited.
const { readFileSync } = await import('node:fs')
const FIX = JSON.parse(readFileSync(new URL('../public/data/fixtures.json', import.meta.url)))
const HEALTHY = FIX.matches.every(m => m.status === 'completed' && m.score?.home != null)
  ? 'COMPLETE' : 'LIVE'

console.log('The OFFLINE light against a working network')

await page.goto(ORIGIN, { waitUntil: 'domcontentloaded' })
ok(`the chip reaches ${HEALTHY} on a healthy feed`, await waitFor(w => w === HEALTHY), await chip())

// ── The feed breaks; the network does not ────────────────────────────────
// Every /data/ request fails while navigator.onLine stays true — the shape of
// a redeploy landing mid-request, or a connection too slow for the handler.
await page.route('**/data/**', r => r.abort())
// Long enough for several 8s quick-retries to fail in a row.
await page.waitForTimeout(30000)
const duringOutage = await chip()
ok('a failing feed on a live network never reads OFFLINE',
   duringOutage !== 'OFFLINE', `chip read ${duringOutage}`)

// ── The network itself goes ──────────────────────────────────────────────
await ctx.setOffline(true)
ok('a genuinely offline device does read OFFLINE',
   await waitFor(w => w === 'OFFLINE'), await chip())

// ── And comes back ───────────────────────────────────────────────────────
await page.unroute('**/data/**')
await ctx.setOffline(false)
ok(`the chip returns to ${HEALTHY} once the network is back`,
   await waitFor(w => w === HEALTHY), await chip())

await b.close()
console.log(fail ? `\n${fail} FAILED` : '\nAll offline-indicator checks passed.')
process.exit(fail ? 1 : 0)
