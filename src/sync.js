// Hockey.AI — Data sync engine
// Soccer.AI pulls versioned snapshots via Cloudflare server functions.
// Hockey.AI keeps the same versioned-sync UX but sources from static JSON
// written by GitHub Actions (zero backend). data-version.json bumps -> full resync.
import { db, openDb } from './db'
import { needsResync } from './syncPolicy'

// Where the numbers come from.
//
// The web app reads the copy deployed beside it, so a relative path is right:
// whatever host serves the app also holds its data.
//
// The Android app has no site to sit beside. It carries the interface inside
// the APK and reads the same central files over the network, so it is handed
// an absolute URL at build time. That is the whole reason it does not depend
// on the website being up or on a domain resolving — the two are separate
// clients of one source, not one wrapped around the other.
const SHIPPED_BASE = `${import.meta.env.BASE_URL}data`
const DATA_BASE = import.meta.env.VITE_DATA_BASE || SHIPPED_BASE

// The APK also carries the data as it stood when it was built. On the web
// these are the same path and this is a no-op; in the app it is the difference
// between a first launch with no signal showing the tournament and showing
// nothing at all. It is only ever a floor — the central copy is tried first
// every time, and the moment one is reachable it replaces this.
const SHIPPED_COPY = DATA_BASE === SHIPPED_BASE ? null : SHIPPED_BASE

async function fetchJSON(path) {
  // A fetch with no timeout can hang forever on a flaky mobile connection —
  // and because syncData() dedupes onto the in-flight promise, one hung fetch
  // used to freeze sync for the life of the tab: the chip stuck on OFFLINE and
  // the refresh tap returned the same dead promise. Abort makes every sync
  // attempt settle, so retries and taps always get a fresh one.
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12000)
  try {
    // No `?t=` cache-buster. It made every request a URL the service worker
    // had never seen, so the NetworkFirst rule for /data/ could never fall
    // back to its cache: on a slow connection the network raced past the
    // handler's timeout, the cache lookup missed on that unique URL, and the
    // fetch rejected — which the chip then reported as OFFLINE on a device
    // that was plainly online. `no-store` keeps the response fresh without
    // inventing a new URL, and leaves the worker a stable key to cache under
    // so the app genuinely works offline.
    const r = await fetch(`${DATA_BASE}/${path}`, { signal: ctrl.signal, cache: 'no-store' })
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
    return await r.json()
  } catch (err) {
    if (!SHIPPED_COPY) throw err
    // Unreachable central copy, and the app has its own on disk. Read that
    // rather than open on nothing. The status still tells the truth about the
    // network — see the end of _sync.
    const r = await fetch(`${SHIPPED_COPY}/${path}`)
    if (!r.ok) throw err
    return await r.json()
  } finally {
    clearTimeout(timer)
  }
}

let _syncPromise = null
let _versionFails = 0

/**
 * Does the device itself report no network?
 *
 * `navigator.onLine` is only trustworthy in the negative — false means there
 * is definitively no connection, while true only means an interface is up. So
 * it gates the word OFFLINE and is never taken as proof of health.
 */
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

// What the last sync attempt did. The UI subscribes so an empty database can
// say WHY it is empty instead of rendering blank tabs — the failure mode this
// app shipped with: sync silently gave up, every page had nothing to draw, and
// nothing on screen admitted it.
let _status = { state: 'starting', error: null, version: null, empty: true, at: 0 }
const listeners = new Set()

export function getSyncStatus() { return _status }
export function subscribeSync(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function setStatus(next) {
  _status = { ..._status, ...next, at: Date.now() }
  listeners.forEach(fn => fn(_status))
}

/** Is the cache actually populated? A version stamp is not evidence of rows. */
async function storeIsEmpty() {
  try {
    const [teams, matches] = await Promise.all([db.teams.count(), db.matches.count()])
    return teams === 0 || matches === 0
  } catch {
    return true
  }
}

export function syncData({ force = false } = {}) {
  if (_syncPromise) return _syncPromise
  _syncPromise = _sync(force)
    .catch(async err => {
      // Never let a failed sync become an unhandled rejection and a blank app.
      setStatus({ state: 'error', empty: await storeIsEmpty(), error: String(err?.message ?? err) })
      return { status: 'error', error: err }
    })
    .finally(() => { _syncPromise = null })
  return _syncPromise
}

async function _sync(force) {
  const opened = await openDb()
  if (!opened.ok) {
    setStatus({ state: 'error', error: 'The local database could not be opened.', empty: true })
    return { status: 'db-error' }
  }

  let remote
  try {
    remote = await fetchJSON('data-version.json')
    _versionFails = 0
  } catch (e) {
    _versionFails++
    const empty = await storeIsEmpty()
    if (empty) {
      // Nothing to show — the reader has to be told immediately.
      setStatus({ state: 'error', empty, error: 'Could not reach the data feed.' })
    } else if (isOffline()) {
      // The device itself says there is no network. That is the only thing
      // OFFLINE is allowed to mean — the word has to be worth reading.
      setStatus({ state: 'offline', empty, error: null })
    } else if (_versionFails >= 5) {
      // Online, data on the device, and the feed unreachable for five straight
      // polls: a real fault, and a failure to reach the feed rather than an
      // absent network. It reads RETRY, not OFFLINE.
      setStatus({ state: 'error', empty, error: 'Could not reach the data feed.' })
    }
    // Otherwise keep the last good state. A failed check with data already on
    // the device is not news: the site redeploys after every data push
    // (several times an hour on match days), a request landing mid-swap can
    // 404, and a slow mobile response can time out. None of that means the
    // reader is offline, and saying so on a working phone is exactly what made
    // the indicator meaningless.
    return { status: 'retry' }
  }

  const localMeta = await db.meta.get('data')
  // A version stamp equal to the server's is NOT proof the tables have rows —
  // an evicted store, a rolled-back write or a half-finished upgrade all leave
  // the stamp behind. Check the rows themselves (see syncPolicy.js).
  const empty = await storeIsEmpty()
  const decision = needsResync({ force, empty, localMeta, remote })
  if (!decision.resync) {
    // The calibration stat must not depend on a full resync: a device that
    // synced the current version under an older build would otherwise show
    // the fallback number until the next version bump. It is a 200-byte
    // fetch — keep it current on every check.
    const cal = await fetchJSON('model-calibration.json').catch(() => null)
    if (cal) {
      const stored = await db.meta.get('calibration').catch(() => null)
      if (!stored || stored.updated_at !== cal.updated_at) {
        await db.meta.put({ id: 'calibration', ...cal }).catch(() => {})
      }
    }
    setStatus({ state: 'fresh', version: localMeta?.version ?? null, empty: false, error: null })
    return { status: 'fresh', version: localMeta?.version ?? null }
  }

  setStatus({ state: 'syncing', error: null })
  const [teamsDoc, fixturesDoc, playersDoc, predictionsDoc, storiesDoc, h2hDoc] = await Promise.all([
    fetchJSON('teams.json'),
    fetchJSON('fixtures.json'),
    fetchJSON('players.json'),
    fetchJSON('predictions.json').catch(() => ({ predictions: [] })),
    fetchJSON('ai-stories.json').catch(() => ({ stories: [] })),
    // Harvested from the official TMS match pages; absent on a first deploy
    // before the pipeline has run, which must not break the sync.
    fetchJSON('h2h.json').catch(() => ({ pairs: {} })),
  ])
  // Model calibration (as-of-then replay) — optional, shown on the Trust page.
  const calibration = await fetchJSON('model-calibration.json').catch(() => null)
  // Team component ratings — absent on a first deploy before the pipeline has
  // run, which must not break the sync.
  const teamRatings = await fetchJSON('team-ratings.json').catch(() => null)
  // This tournament's records, and the roll of past World Cups. Both are
  // optional in exactly the way the two above are: a deploy that predates
  // them must still sync, and the views that read them draw nothing rather
  // than breaking.
  const records = await fetchJSON('records.json').catch(() => null)
  const history = await fetchJSON('world-cup-history.json').catch(() => null)
  // The official award winners, once the FIH has announced them. Optional in
  // the same way: before the announcement there is no file and the Awards tab
  // shows the race alone, which is what it showed all fortnight.
  const awards = await fetchJSON('awards.json').catch(() => null)

  const teams = (teamsDoc.teams || []).map(t => ({
    ...t,
    fihRank: t.fih_rank,
    winProb: t.win_prob,
    intro: t.intro,
  }))

  const matches = (fixturesDoc.matches || []).map(m => ({
    ...m,
    kickoffUtc: new Date(`${m.date}T${m.time}:00+02:00`).getTime(), // CET summer = +02:00
    // A live match's running score (pipeline live_score) surfaces through the
    // same score field every card and panel already reads — through the
    // in-play window AND the score-wait after it, whatever the stored status
    // says. The confirmed final always wins once written; liveScoreAt marks
    // the provenance so the match page can say the number is live rather
    // than full-time.
    ...(m.status !== 'completed' && m.score?.home == null && m.live_score
      ? { score: { home: m.live_score.home, away: m.live_score.away }, liveScoreAt: m.live_score.at }
      : {}),
  }))

  const events = []
  for (const m of fixturesDoc.matches || []) {
    ;(m.events || []).forEach((ev, i) => {
      events.push({ matchId: m.id, seq: i, ...ev })
    })
  }

  await db.transaction('rw',
    [db.teams, db.matches, db.match_events, db.players, db.predictions, db.ai_stories, db.h2h, db.meta],
    async () => {
      await Promise.all([
        db.teams.clear(), db.matches.clear(), db.match_events.clear(),
        db.players.clear(), db.predictions.clear(), db.ai_stories.clear(),
        db.h2h.clear(),
      ])
      await db.teams.bulkPut(teams)
      await db.matches.bulkPut(matches)
      if (events.length) await db.match_events.bulkPut(events)
      await db.players.bulkPut(playersDoc.players || [])
      if (predictionsDoc.predictions?.length) await db.predictions.bulkPut(predictionsDoc.predictions)
      if (storiesDoc.stories?.length) await db.ai_stories.bulkPut(storiesDoc.stories)
      const h2hRows = Object.entries(h2hDoc.pairs || {})
        .map(([pair, meetings]) => ({ pair, meetings, since: h2hDoc.since ?? null }))
      if (h2hRows.length) await db.h2h.bulkPut(h2hRows)
      await db.meta.put({
        id: 'data',
        version: remote.version,
        fingerprint: remote.fingerprint ?? null,
        updatedAt: remote.updated_at,
        syncedAt: Date.now(),
      })
      if (calibration) await db.meta.put({ id: 'calibration', ...calibration })
      if (teamRatings) await db.meta.put({ id: 'teamRatings', ...teamRatings })
      if (records) await db.meta.put({ id: 'records', ...records })
      if (history) await db.meta.put({ id: 'history', ...history })
      if (awards) await db.meta.put({ id: 'awards', ...awards })
    })

  // Data is loaded either way, but the light reports the network, not the
  // database: an app that just read its own shipped copy because nothing was
  // reachable is offline, and has to say so.
  setStatus({
    state: isOffline() ? 'offline' : 'synced',
    version: remote.version, empty: false, error: null,
  })
  // Favourite-team alerts ride the sync: fresh data in, notifications out.
  // Lazy import keeps the sync path free of any Notification-API coupling.
  import('./notify.js').then(n => n.checkFavouriteAlerts()).catch(() => {})
  return { status: 'synced', version: remote.version }
}

// Poll for new data versions while the app is open (matches Soccer.AI's 60s cadence —
// the version check is one tiny JSON fetch, so live results land within a minute)
export function startAutoSync(intervalMs = 60 * 1000) {
  syncData()
  // A failed first sync leaves the app with nothing to draw, so retry sooner
  // than the steady-state minute — and stop retrying fast once it lands.
  let quick = setInterval(() => {
    if (_status.state === 'error' || _status.state === 'offline' || _status.empty) syncData({ force: true })
    else { clearInterval(quick); quick = null }
  }, 8000)
  const id = setInterval(() => syncData(), intervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncData()
  })
  // The instant the network returns, resync — don't sit amber for up to a
  // minute waiting for the next poll.
  window.addEventListener('online', () => {
    _versionFails = 0
    syncData({ force: true })
  })
  // And the instant it goes, say so, instead of waiting for polls to fail
  // first. The device knows before any fetch does.
  window.addEventListener('offline', async () => {
    setStatus({ state: 'offline', empty: await storeIsEmpty(), error: null })
  })
  return () => clearInterval(id)
}
