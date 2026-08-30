// Hockey.AI — recovery smoke test (browser, run locally)
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/smoke_recovery.mjs
//
// Drives a real Chromium against the built app and asserts the three states an
// empty local database can be in: unreachable feed (must SAY so), rows wiped
// behind a valid version stamp (must self-heal), and healthy (must stay quiet).
// Not in CI — CI has no browser — but it is the test that reproduces the
// "every tab is empty" report, so keep it runnable.
// playwright-core is intentionally NOT a dependency of this app — it exists for
// this one script. Install it where you run the smoke test:
//   npm i --no-save playwright-core
import { readFileSync } from 'node:fs'
import { computeElimination } from '../src/engine/elimination.js'
import { projectBracket, orderedResults } from '../src/engine/simulate.js'
import { computeStandings } from '../src/engine/standings.js'

const read = f => JSON.parse(readFileSync(new URL(`../public/data/${f}`, import.meta.url)))
const teams = read('teams.json').teams
const matches = read('fixtures.json').matches

let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.error('smoke_recovery needs playwright-core: npm i --no-save playwright-core')
  process.exit(2)
}
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:4173'
let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }
const b = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })

// 1. Feed unreachable, cache empty: the app must SAY so.
{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.route('**/data/**', r => r.abort())
  await p.goto(ORIGIN + "/", { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(3000)
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
  check('an unreachable feed with an empty cache is reported on screen', /No tournament data/.test(txt))
  check('the banner offers a retry and a reset', /Retry now/.test(txt) && /Reset app data/.test(txt))
  await ctx.close()
}

// 2. Version stamp says fresh but the tables are empty: must self-heal.
{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.goto(ORIGIN + "/", { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(3500)
  await p.evaluate(async () => {
    const open = indexedDB.open('hockeyai')
    const dbh = await new Promise(res => { open.onsuccess = () => res(open.result) })
    const tx = dbh.transaction(['teams', 'matches'], 'readwrite')
    tx.objectStore('teams').clear(); tx.objectStore('matches').clear()
    await new Promise(res => { tx.oncomplete = res })
    dbh.close()
  })
  await p.reload({ waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(4500)
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
  const counts = await p.evaluate(async () => {
    const open = indexedDB.open('hockeyai')
    const dbh = await new Promise(res => { open.onsuccess = () => res(open.result) })
    const n = s => new Promise(res => { const r = dbh.transaction(s).objectStore(s).count(); r.onsuccess = () => res(r.result) })
    const out = { teams: await n('teams'), matches: await n('matches') }
    dbh.close(); return out
  })
  check('rows wiped behind a valid version stamp are refetched',
        counts.teams === 16 && counts.matches === 50, JSON.stringify(counts))
  check('the page draws content again after self-healing', txt.length > 600, String(txt.length))
  await ctx.close()
}

// 3. Healthy path unchanged.
{
  const ctx = await b.newContext({ serviceWorkers: 'block' })
  const p = await ctx.newPage()
  await p.goto(ORIGIN + "/teams", { waitUntil: 'domcontentloaded' })
  // A fixed sleep was wrong twice over. A cold cache on a slow machine takes
  // longer than three and a half seconds to fetch and store the whole set, so
  // this failed on a perfectly healthy app; and had it been slower still, the
  // assertion below would have run against a half-drawn page. Wait for the
  // banner to clear, and fail only if it never does.
  //
  // Waiting on a length threshold was not enough: the page passes it while
  // React is still rendering, and the assertion below then read a chip
  // mid-flight and reported a count the app never actually showed. Wait for
  // the chip itself to hold the same value twice.
  const settled = await p.waitForFunction(
    () => {
      const t = document.body?.innerText ?? ''
      if (/No tournament data/.test(t)) return false
      const now = (/Alive \d+/.exec(t) ?? [null])[0]
      if (!now) return false
      const stable = window.__aliveSeen === now
      window.__aliveSeen = now
      return stable
    },
    null, { timeout: 45000, polling: 500 }).then(() => true).catch(() => false)
  const txt = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
  check('a healthy app clears the banner once the data lands', settled, txt.slice(0, 160))

  // The Alive chip is the count of nations still able to win the title, and
  // it was asserted here as the literal "Alive 8" — true for one week of one
  // tournament. It went stale the moment the field narrowed and said nothing
  // when the real bug appeared: with every match played the grid counted two
  // nations alive, because the elimination chain stopped at the semi-finals.
  // So this now checks the rendered number against the engine that computes
  // it, which is a claim that stays true for any tournament in any state.
  const expected = teams.length - computeElimination(
    teams, matches, orderedResults(matches), computeStandings(teams, matches),
    projectBracket(teams, matches, computeStandings(teams, matches))).size
  check('the Teams filters render', /All \d+/.test(txt), txt.slice(0, 160))
  check(`the Alive chip agrees with the elimination engine (${expected})`,
        new RegExp(`Alive ${expected}\\b`).test(txt),
        (/Alive \d+/.exec(txt) ?? ['not shown'])[0])
  await ctx.close()
}
await b.close()
console.log(failed ? `\n${failed} FAILED` : '\nAll recovery checks passed.')
process.exit(failed ? 1 : 0)
