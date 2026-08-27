// Hockey.AI — every-route smoke test.
//
// Vite compiles JSX without resolving identifiers, so a reference to a name
// that is not in scope builds cleanly and throws only when that screen
// renders. That has shipped twice. This drives a real browser over every
// route in the app — every team, a played and an unplayed match, every tab and
// subtab — and fails on any page error or console error.
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core && npm run smoke:routes
import { readFileSync } from 'node:fs'
let chromium
try { ({ chromium } = await import('playwright-core')) } catch {
  console.error('smoke_routes needs playwright-core: npm i --no-save playwright-core')
  process.exit(2)
}
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const ORIGIN = process.env.SMOKE_ORIGIN ?? 'http://localhost:4173'

const url = new URL('../public/data/', import.meta.url)
const read = n => JSON.parse(readFileSync(new URL(n, url)))
const FIXTURES = read('fixtures.json')
const TEAMS = read('teams.json')

const played = FIXTURES.matches.find(m => m.status === 'completed' && m.score?.home != null)
const ahead = FIXTURES.matches.find(m => m.status !== 'completed' && m.home !== 'TBD')

const ROUTES = [
  '/',
  '/matches', '/matches?tab=upcoming', '/matches?tab=live', '/matches?tab=results',
  '/teams', '/teams?filter=oracle', '/teams?filter=oracle&xi=rising',
  '/tournament', '/tournament?tab=standings', '/tournament?tab=bracket',
  '/tournament?tab=stats', '/tournament?tab=awards', '/tournament?tab=awards&awards=potm',
  '/tournament?tab=best', '/tournament?tab=best&xi=rising',
  // The simulated exhibition draws two engine-picked elevens now. It was not
  // on this list while it was a static table, which is how it went a fortnight
  // showing players who never travelled.
  '/match/sim/sim_best_xi_vs_rising_xi',
  '/prediction-race', '/lab', '/players',
  ...TEAMS.teams.map(t => `/teams/${t.code}`),
  played && `/matches/${played.id}`,
  ahead && `/matches/${ahead.id}`,
].filter(Boolean)

const b = await chromium.launch({ executablePath: EXECUTABLE, args: ['--no-sandbox'] })
const ctx = await b.newContext({ serviceWorkers: 'block' })
// The app asks for a web font at load. In a sandbox with no egress that
// request sits for twelve seconds before it gives up, on every single route.
// Nothing outside the preview server is part of what this test checks.
await ctx.route('**/*', r =>
  new URL(r.request().url()).hostname === 'localhost' ? r.continue() : r.abort())
const page = await ctx.newPage()

let failed = 0
let current = ''
const problems = []
page.on('pageerror', e => { problems.push([current, 'pageerror', e.message]) })
page.on('console', m => {
  if (m.type() !== 'error') return
  const t = m.text()
  // A data file the preview server has not been asked for yet is not a bug in
  // the page; anything the app itself throws is.
  if (/favicon|net::ERR_/i.test(t)) return
  problems.push([current, 'console', t])
})

for (const route of ROUTES) {
  current = route
  const before = problems.length
  await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(route === ROUTES[0] ? 2500 : 450)
  // Some routes exist only to redirect — /tournament?tab=bracket sends the
  // reader to the one bracket view. Judge where they land, not where they left.
  // A screen that threw during render leaves an empty main. Poll rather than
  // guess a delay: a route that only redirects has two renders to get through.
  let body = ''
  for (let i = 0; i < 12 && body.trim().length < 20; i++) {
    body = await page.evaluate(
      () => (document.querySelector('main') ?? document.body)?.innerText ?? '')
    if (body.trim().length < 20) await page.waitForTimeout(250)
  }
  const broke = problems.length > before
  const empty = body.trim().length < 20
  if (broke || empty) {
    failed++
    console.log('  FAIL', route, empty && !broke ? '(rendered nothing)' : '')
    for (const [, kind, msg] of problems.slice(before)) console.log(`        ${kind}: ${msg}`)
  } else {
    console.log('  ok  ', route)
  }
}

await b.close()
console.log(failed
  ? `\n${failed} of ${ROUTES.length} routes failed.`
  : `\nAll ${ROUTES.length} routes rendered with no page errors.`)
process.exit(failed ? 1 : 0)
