// Hockey.AI — one quantity, one printed value, checked on the running app.
//
// The engine gates prove the numbers agree in memory. They cannot see what a
// reader sees, and that is where the app kept failing: the gold final's
// published pick reached the match card as "53%", the Oracle pick list as
// "53% conf" and the champion race as "52.0%" — three renderings of a single
// claim, on three screens of one app.
//
// So this walks the built app and scrapes the percentages out of the elements
// that render a given match's pick — the card that links to it, its detail
// page, its bracket tie, its row in the odds table — and holds every one of
// them against the published ledger. Scraping whole pages instead would be
// noise: a page prints many unrelated percentages, and a chaos index that
// happens to land near a pick is not a disagreement.
//
//   npm run build && npx vite preview --port 4181 &
//   npm i --no-save playwright-core && node scripts/smoke_one_value.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const O = process.env.SMOKE_ORIGIN ?? 'http://localhost:4181'

const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data', f), 'utf8'))
const matches = read('fixtures.json').matches
const predictions = read('predictions.json').predictions
const teams = read('teams.json').teams ?? read('teams.json')
const nameOf = code => teams.find(t => t.code === code)?.name ?? code

let fail = 0
const ok = (n, c, d = '') => { console.log(`  ${c ? 'ok  ' : 'FAIL'}   ${n}${!c && d ? ` — ${d}` : ''}`); if (!c) fail++ }

// formatProbability, as the app applies it. Kept literal rather than imported
// so a change to the shared formatter has to be made deliberately here too.
const fmt = p => `${(p * 100).toFixed(1)}%`
const pcts = s => [...String(s).matchAll(/\d{1,3}(?:\.\d+)?%/g)].map(m => m[0])

const byId = new Map(matches.map(m => [m.id, m]))
const isKO = m => m.phase !== 'pool' && m.phase !== 'stage2'

// Every pick the ledger has published on a match still to be played, folded to
// the numbers the app shows for it.
const claims = predictions
  .filter(p => !p.superseded && p.p_home_win != null)
  .map(p => ({ p, m: byId.get(p.matchId) }))
  .filter(r => r.m && r.m.status !== 'completed')
  .map(({ p, m }) => {
    const sum = p.p_home_win + (p.p_draw ?? 0) + p.p_away_win || 1
    const advHome = p.p_home_win + (p.p_draw ?? 0) / 2
    const allowed = isKO(m)
      ? [advHome, 1 - advHome, p.p_draw ?? 0, 1 - (p.p_draw ?? 0)]     // advance split + shoot-out path
      : [p.p_home_win / sum, (p.p_draw ?? 0) / sum, p.p_away_win / sum]
    return {
      m, knockout: isKO(m), advHome,
      pick: advHome >= 0.5 ? m.home : m.away,
      confidence: Math.max(advHome, 1 - advHome),
      allowed: new Set(allowed.map(fmt)),
    }
  })

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
const ctx = await b.newContext({ viewport: { width: 430, height: 932 } })
const page = await ctx.newPage()
// Every figure on these pages arrives from IndexedDB through a live query, so
// a fixed pause is a coin toss: at 1.5s the match cards still showed a
// placeholder crest and no pick at all, and every check over them passed by
// finding nothing. Wait for the text to stop changing instead.
const go = async route => {
  await page.goto(O + route, { waitUntil: 'domcontentloaded' })
  let last = null
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(400)
    const now = await page.evaluate(() => document.body?.innerText ?? '')
    if (now === last && now.length > 200) return
    last = now
  }
}

// Warm the local database once; every route below reuses it.
await page.goto(O + '/', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 20000 }).catch(() => {})
await page.waitForFunction(() => /FIH #\d/.test(document.body?.innerText ?? ''), null, { timeout: 25000 })

// ── 1. Every card that links to a match ───────────────────────────────────
// Home hero, the Matches list and the Oracle pick list all render the same
// pick inside an anchor pointing at the match.
console.log('\n1. Cards that link to a match')
const linked = new Map(claims.map(c => [c.m.id, []]))
// Matches opens on Results; a pick still to be played lives under Upcoming.
for (const [route, label] of [['/', 'Home'], ['/matches?tab=upcoming', 'Matches'],
                              ['/prediction-race?tab=picks', 'Oracle · Picks']]) {
  await go(route)
  for (const c of claims) {
    // Home carries only the next fixture, so absence here is not a fault —
    // what matters is that a card which IS shown states published figures.
    const texts = await page.$$eval(`a[href*="/matches/${c.m.id}"]`, els => els.map(e => e.innerText))
    for (const t of texts) linked.get(c.m.id).push({ label, found: pcts(t) })
  }
}
for (const c of claims) {
  const all = linked.get(c.m.id)
  const rows = all.filter(r => r.found.length)
  ok(`${c.m.id} is carried on a card`, all.length > 0)
  ok(`${c.m.id} states a probability on every card that shows it`,
     rows.length === all.length,
     `silent on ${all.filter(r => !r.found.length).map(r => r.label).join(', ')}`)
  for (const r of rows) {
    const stray = r.found.filter(s => !c.allowed.has(s))
    ok(`${c.m.id} on ${r.label} prints only published figures`, stray.length === 0,
       `${stray.join(', ')} — published ${[...c.allowed].join(' / ')}`)
  }
}

// ── 2. The match's own page ───────────────────────────────────────────────
// The confidence dial and the advance split sit in the prediction panel; the
// rest of the page is match telemetry and is not a probability.
console.log("\n2. The match's own page")
for (const c of claims) {
  await go(`/matches/${c.m.id}`)
  const found = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('div')].find(d =>
      /to advance|to win/.test(d.innerText) && /%/.test(d.innerText) && d.innerText.length < 900)
    return hit ? hit.innerText : ''
  })
  const stray = pcts(found).filter(s => !c.allowed.has(s))
  ok(`${c.m.id} detail page prints only published figures`,
     found !== '' && stray.length === 0,
     found === '' ? 'no prediction panel found' : `${stray.join(', ')} — published ${[...c.allowed].join(' / ')}`)
  ok(`${c.m.id} detail page states the pick at ${fmt(c.confidence)}`,
     pcts(found).includes(fmt(c.confidence)), pcts(found).join(', '))
}

// ── 3. Bracket, race and odds must say what the pick says ─────────────────
// With the semi-finals played, "who wins the gold final" and "who wins the
// tournament" are one question. The app answered it twice, differently.
console.log('\n3. Bracket · race · odds')
const gold = claims.find(c => c.m.phase === 'gold-final')
if (gold) {
  const want = fmt(gold.confidence)

  await go('/prediction-race?tab=bracket')
  const tie = await page.evaluate(id => {
    const hit = [...document.querySelectorAll('button, div')].find(e =>
      e.innerText.startsWith(id) && /%/.test(e.innerText) && e.innerText.length < 400)
    return hit ? hit.innerText : ''
  }, gold.m.id)
  const tieStray = pcts(tie).filter(s => !gold.allowed.has(s))
  ok('the bracket tie prints only published figures', tie !== '' && tieStray.length === 0,
     tie === '' ? 'tie card not found' : tieStray.join(', '))
  ok(`the bracket tie leads with ${want}`, pcts(tie).includes(want), pcts(tie).join(', '))

  await go('/prediction-race')
  const leader = await page.evaluate(() => {
    const hit = [...document.querySelectorAll('a')].find(e => /Race leader/i.test(e.innerText))
    return hit ? hit.innerText : ''
  })
  ok(`the champion race leader reads ${want}`, pcts(leader).includes(want),
     `${pcts(leader).join(', ')} — the race and the final are the same question`)

  await go('/prediction-race?tab=odds')
  const row = await page.evaluate(name => {
    const tr = [...document.querySelectorAll('tr')].find(r => r.innerText.includes(name))
    return tr ? tr.innerText : ''
  }, nameOf(gold.pick))
  ok(`the odds table gives ${gold.pick} ${want} for the trophy`, pcts(row).includes(want),
     `${pcts(row).join(', ')}`)
}

// ── 3b. The AI Lab board ──────────────────────────────────────────────────
// Its cards carry no link to the match, so section 1 cannot see them. They
// showed a three-way split with a draw on knockout ties for as long as the
// board has existed.
console.log('\n3b. AI Lab board')
await go('/ai-lab?tab=previews')
for (const c of claims) {
  // The innermost card, not an ancestor holding the whole board: an outer
  // container matches every name on the page and would have this check
  // reading one fixture's numbers against another's ledger row.
  const card = await page.evaluate(name => {
    const hits = [...document.querySelectorAll('div')].filter(d =>
      d.innerText.includes(name) && /Pick:/.test(d.innerText))
    const inner = hits.filter(d => !hits.some(o => o !== d && d.contains(o)))
    return inner.length === 1 ? inner[0].innerText : ''
  }, nameOf(c.pick))
  ok(`${c.m.id} is on the AI Lab board`, card !== '')
  if (!card) continue
  const stray = pcts(card).filter(s => !c.allowed.has(s))
  ok(`${c.m.id} on the AI Lab board prints only published figures`, stray.length === 0,
     `${stray.join(', ')} — published ${[...c.allowed].join(' / ')}`)
  ok(`${c.m.id} on the AI Lab board offers no draw on a knockout`,
     !c.knockout || !/Draw/.test(card), card.replace(/\n/g, ' | '))
}

// ── 4. The race axis spans the real fixture list ──────────────────────────
console.log('\n4. The race axis')
await go('/prediction-race')
const caption = await page.evaluate(() => document.body.innerText)
ok(`the race caption spans all ${matches.length} fixtures`,
   caption.includes(`(0 → ${matches.length})`) && caption.includes(`(0–${matches.length},`),
   caption.split('\n').filter(l => /0\s*(?:→|–)\s*\d/.test(l)).join(' | ') || 'no axis caption found')

await b.close()
console.log(fail ? `\n${fail} check(s) FAILED` : '\nOne value per quantity on every surface.')
process.exit(fail ? 1 : 0)
