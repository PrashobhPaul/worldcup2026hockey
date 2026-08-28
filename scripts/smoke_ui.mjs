// Hockey.AI — the things you only find by looking at the running app.
//
// Four fixes are held here, each of which passed review as code and still
// looked wrong on a phone:
//
//   * A splash screen. The app used to show a blank page for as long as the
//     bundle took, in the browser as much as in the installed app. The splash
//     is plain markup in index.html so it paints with no JavaScript at all —
//     which is exactly the state asserted below.
//   * The tab loop. Swiping stopped dead at the first and last tab. It wraps
//     now, both ways. One swipe still moves one thing, so sub-tabs are walked
//     before the section changes; these checks care where a swipe lands, not
//     how many it took.
//   * The tournament header. The subtitle sat under the emblem instead of
//     beside it, and the title wrapped to two lines below 430px, so the block
//     ran half as tall again as the emblem it was meant to sit level with.
//   * Movement between tabs, so a change of view is visible.
//
// Needs the built app being served:
//   npm run build && npx vite preview --port 4181 &
//   npm i --no-save playwright-core && npm run smoke:ui

import { chromium } from 'playwright-core'
const EXE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const O = process.env.SMOKE_ORIGIN ?? 'http://localhost:4181'
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] })
let fail = 0
const ok = (n, c, d='') => { console.log(`  ${c?'ok  ':'FAIL'}   ${n}${!c&&d?` — ${d}`:''}`); if(!c) fail++ }

// --- splash on a cold load -------------------------------------------------
{
  // Block the bundle outright: the splash exists precisely for the window in
  // which the JavaScript has not arrived, so that is the state to assert on.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.route('**/*.js', r => r.abort())
  await p.goto(O + '/', { waitUntil: 'domcontentloaded' }).catch(() => {})
  const early = await p.evaluate(() => {
    const el = document.getElementById('splash')
    if (!el) return { present: false }
    const cs = getComputedStyle(el)
    return { present: true, visible: cs.visibility !== 'hidden' && cs.opacity !== '0',
             covers: el.getBoundingClientRect().height >= innerHeight - 2,
             hasLogo: !!el.querySelector('img')?.getAttribute('src') }
  })
  ok('splash paints with no JavaScript at all', early.present && early.visible, JSON.stringify(early))
  ok('splash covers the viewport and shows the badge', early.covers && early.hasLogo, JSON.stringify(early))
  await ctx.close()
}

{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.goto(O + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200)
  await p.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 15000 }).catch(() => {})
  ok('splash is removed once the app renders', await p.evaluate(() => !document.getElementById('splash')))
  await ctx.close()
}

// --- swipe wraps 360 both ways --------------------------------------------
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.goto(O + '/', { waitUntil: 'domcontentloaded' })
  // The first load registers a service worker and reloads once when it takes
  // control, so wait for the settled document rather than racing that reload.
  await p.waitForFunction(() => document.body && !document.getElementById('splash')
    && document.querySelectorAll('[role="tablist"], nav a').length > 0,
    null, { timeout: 20000 }).catch(() => {})
  await p.waitForTimeout(400)
  // Dispatched on <body>: the hook deliberately ignores gestures that start
  // inside something horizontally scrollable, and this is testing the tab
  // cycle, not that guard.
  const swipe = async dir => {
    const [fx, tx] = dir === 'left' ? [330, 60] : [60, 330]
    await p.evaluate(([a, z]) => {
      const opt = x => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: 400, bubbles: true })
      document.body.dispatchEvent(new PointerEvent('pointerdown', opt(a)))
      window.dispatchEvent(new PointerEvent('pointerup', opt(z)))
    }, [fx, tx])
    await p.waitForTimeout(420)
    return p.evaluate(() => location.pathname)
  }

  // One swipe moves one thing, and sub-tabs are walked before the section
  // changes — /matches has three boards, so it legitimately takes three swipes
  // to leave it. What matters here is that neither end is a dead stop.
  const home = await p.evaluate(() => location.pathname)
  ok('starts on Home', home === '/', home)

  const wrappedBack = await swipe('right')
  ok('swiping back from the first tab wraps to the last',
     wrappedBack === '/prediction-race', `got ${wrappedBack}`)

  // The last tab has sub-tabs of its own, so keep swiping until the section
  // actually changes — the point is where it lands, not how many swipes it took.
  let fwd = '/prediction-race'
  for (let i = 0; i < 6 && fwd === '/prediction-race'; i++) fwd = await swipe('left')
  ok('swiping on from the last tab wraps round to the first',
     fwd === '/', `got ${fwd}`)

  // And the whole loop is reachable going forward, sub-tabs and all.
  const visited = new Set([await p.evaluate(() => location.pathname)])
  for (let i = 0; i < 24; i++) visited.add(await swipe('left'))
  const tabs = ['/', '/matches', '/teams', '/tournament', '/prediction-race']
  ok('every top-level tab is reachable by swiping one way',
     tabs.every(t => visited.has(t)), [...visited].join(' '))

  await ctx.close()
}

// --- tournament header geometry -------------------------------------------
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  // On a cold profile the service worker takes control and reloads the page
  // once, which replaces the document underneath any element handle taken
  // before it. Waiting for the network to go idle puts that reload behind us,
  // so the measurements below are made against the document that stays.
  await p.goto(O + '/tournament', { waitUntil: 'networkidle', timeout: 60000 })
  const found = await p.waitForSelector('main img[src*="emblem"]', { timeout: 25000 }).catch(() => null)
  ok('tournament header renders', !!found)
  const g = await p.evaluate(() => {
    const img = document.querySelector('main img[src*="emblem"]')
    const h1 = document.querySelector('main h1')
    const sub = h1?.parentElement?.querySelector('p')
    if (!img || !h1 || !sub) return null
    const ib = img.getBoundingClientRect(), hb = h1.getBoundingClientRect(), sb = sub.getBoundingClientRect()
    const block = img.closest('div').parentElement.getBoundingClientRect()
    return { iconH: Math.round(ib.height), iconW: Math.round(ib.width),
             subLeftOfIconRight: Math.round(sb.left) > Math.round(ib.right) - 2,
             subBelowTitle: sb.top >= hb.bottom - 2,
             blockH: Math.round(block.height) }
  })
  ok('emblem is 64-72px', g && g.iconH >= 64 && g.iconH <= 72, JSON.stringify(g))
  ok('subtitle sits beside the emblem, not under it', g && g.subLeftOfIconRight, JSON.stringify(g))
  ok('subtitle sits below the title', g && g.subBelowTitle, JSON.stringify(g))
  ok('header block no taller than the emblem + its padding', g && g.blockH <= g.iconH + 34, JSON.stringify(g))
  await ctx.close()
}

// --- page transition class is applied --------------------------------------
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const p = await ctx.newPage()
  await p.goto(O + '/teams', { waitUntil: 'domcontentloaded' })
  await p.waitForFunction(() => document.querySelector('main'), null, { timeout: 20000 }).catch(() => {})
  const anim = await p.evaluate(() => {
    const m = document.querySelector('main')
    return { cls: m?.className.includes('page-enter'), name: getComputedStyle(m).animationName }
  })
  ok('routed view carries the entrance animation', anim.cls && anim.name === 'page-enter', JSON.stringify(anim))
  await ctx.close()
}

await b.close()
console.log(fail ? `\n${fail} failed` : '\nAll UI checks passed.')
process.exit(fail ? 1 : 0)
