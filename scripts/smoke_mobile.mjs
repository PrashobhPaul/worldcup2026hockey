// Hockey.AI — premium-mobile smoke test (browser, run locally)
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core && npm run smoke:mobile
//
// Drives a real Chromium at a phone viewport (390×844) through the premium
// shell: the five-item bottom bar with folded siblings lighting their parent,
// the sync chip, the favourite-team flow end to end, and the Match Center
// pills in both played and upcoming states. Not in CI — CI has no browser.
let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.error('smoke_mobile needs playwright-core: npm i --no-save playwright-core')
  process.exit(2)
}
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:4173'
let failed = 0
const check = (n, c, d = '') => { if (c) console.log('  ok  ', n); else { failed++; console.log('  FAIL', n, d) } }

const b = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
const p = await ctx.newPage()
p.on('pageerror', e => { failed++; console.log('  PAGEERROR', e.message) })

await p.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(3500)

// ── Bottom bar: exactly five items, parent lit on folded siblings ──────────
const barItems = await p.locator('nav.fixed a').allInnerTexts()
check('bottom bar has exactly 5 items', barItems.length === 5, barItems.join(','))
check('bar is Home/Matches/Teams/Cup/Oracle',
  barItems.join(',').toUpperCase() === 'HOME,MATCHES,TEAMS,CUP,ORACLE', barItems.join(','))
const barBox = await p.locator('nav.fixed a').first().boundingBox()
check('bottom bar items are ≥44px tall', barBox.height >= 44, String(barBox.height))

// ── Sync chip in the header ────────────────────────────────────────────────
const headerTxt = (await p.locator('header').innerText()).replace(/\s+/g, ' ')
const refreshLabel = await p.locator('header button[aria-label*="Refresh data"], header button[aria-label*="sync failed"]').count()
check('the quiet refresh button is in the header', refreshLabel === 1)

// ── Favourite: invitation → star a team → Home leads with it ───────────────
let body = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
check('unset favourite shows the invitation', /Follow your team/.test(body))
await p.goto(ORIGIN + '/teams', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1200)
body = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
check('Teams shows the Teams/Players segmented control', /Players/.test(body))
// Following happens on the team page's proper button (no star-in-link on cards).
await p.goto(ORIGIN + '/teams/IND', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1500)
await p.locator('button', { hasText: 'Follow' }).first().click()
await p.waitForTimeout(500)
check('follow button flips to Following',
  await p.locator('button', { hasText: 'Following' }).count() === 1)
await p.goto(ORIGIN + '/teams', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1200)
check('the followed team card carries the brand ring',
  await p.locator('a[href="/teams/IND"].ring-1').count() === 1)
await p.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
// The favourite strip waits on the Monte-Carlo bundle — wait for it, not a timer.
const strip = await p.waitForSelector('text=FOLLOWING', { timeout: 20000 }).then(() => true).catch(() => false)
body = (await p.locator('body').innerText()).replace(/\s+/g, ' ')
check('Home leads with the followed team', strip && /India FOLLOWING/.test(body), body.slice(0, 300))
check('strip shows champion probability or elimination', /(champion|Out of title contention)/.test(body))
check('the invitation is gone once following', !/Follow your team — open any team/.test(body))

// ── Folded siblings keep the parent tab lit ────────────────────────────────
// Alias-lit tabs use data-active (styling) without claiming aria-current —
// on /players the *page* is SiblingNav's Players link, not the Teams tab.
await p.goto(ORIGIN + '/players', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1000)
let lit = await p.locator('nav.fixed a[data-active]').innerText()
check('on /players the Teams tab is lit', lit.trim().toUpperCase() === 'TEAMS', lit)
check('the lit alias tab does not claim aria-current',
  await p.locator('nav.fixed a[aria-current="page"]').count() === 0)
await p.goto(ORIGIN + '/ai-lab', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1000)
lit = await p.locator('nav.fixed a[data-active]').innerText()
check('on /ai-lab the Oracle tab is lit', lit.trim().toUpperCase() === 'ORACLE', lit)
await p.goto(ORIGIN + '/matches', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(800)
check('a true route match still claims aria-current',
  (await p.locator('nav.fixed a[aria-current="page"]').innerText()).trim().toUpperCase() === 'MATCHES')

// ── Match Center pills ─────────────────────────────────────────────────────
await p.goto(ORIGIN + '/matches/D1', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1500)
const pillTexts = await p.locator('div.sticky button').allInnerTexts()
check('completed match shows Match Center pills',
  pillTexts.some(t => /Timeline/.test(t)) && pillTexts.some(t => /Stats/.test(t)) && pillTexts.some(t => /Story/.test(t)),
  pillTexts.join(','))
check('pill order follows the page (Form before Timeline)',
  pillTexts.findIndex(t => /Form/.test(t)) < pillTexts.findIndex(t => /Timeline/.test(t)),
  pillTexts.join(','))
const pillBox = await p.locator('div.sticky button').first().boundingBox()
check('pills are ≥44px tall', pillBox.height >= 44, String(pillBox.height))
const before = await p.evaluate(() => window.scrollY)
await p.locator('div.sticky button', { hasText: 'Story' }).click()
await p.waitForTimeout(900)
const after = await p.evaluate(() => window.scrollY)
check('tapping a pill scrolls to the section', after > before + 200, `${before} -> ${after}`)

// Upcoming match: no Timeline/Stats pills, Preview present
await p.goto(ORIGIN + '/matches/S2G3', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1400)
const upPills = await p.locator('div.sticky button').allInnerTexts()
check('upcoming match has no Timeline/Stats pill',
  !upPills.some(t => /Timeline|Stats|Story/.test(t)), upPills.join(','))

// ── Desktop: all seven tabs still in the top nav ───────────────────────────
const d = await b.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } })
const dp = await d.newPage()
await dp.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
await dp.waitForTimeout(2000)
const topNav = await dp.locator('header nav a').allInnerTexts()
check('desktop top nav keeps all seven tabs',
  ['Home', 'Matches', 'Teams', 'Players', 'Tournament', 'Oracle', 'AI Lab'].every(t => topNav.includes(t)),
  topNav.join(','))

await b.close()
console.log(failed ? `\n${failed} FAILED` : '\nAll mobile checks passed.')
process.exit(failed ? 1 : 0)
