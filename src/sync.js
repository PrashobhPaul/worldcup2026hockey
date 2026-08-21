// Hockey.AI — Data sync engine
// Soccer.AI pulls versioned snapshots via Cloudflare server functions.
// Hockey.AI keeps the same versioned-sync UX but sources from static JSON
// written by GitHub Actions (zero backend). data-version.json bumps -> full resync.
import { db, openDb } from './db'
import { needsResync } from './syncPolicy'

const DATA_BASE = `${import.meta.env.BASE_URL}data`

async function fetchJSON(path) {
  const r = await fetch(`${DATA_BASE}/${path}?t=${Date.now()}`)
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json()
}

let _syncPromise = null

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
  } catch (e) {
    // Offline. With a populated cache the PWA carries on as normal; with an
    // empty one there is nothing to show, and the reader has to be told.
    const empty = await storeIsEmpty()
    setStatus({ state: empty ? 'error' : 'offline', empty, error: empty ? 'Could not reach the data feed.' : null })
    return { status: 'offline' }
  }

  const localMeta = await db.meta.get('data')
  // A version stamp equal to the server's is NOT proof the tables have rows —
  // an evicted store, a rolled-back write or a half-finished upgrade all leave
  // the stamp behind. Check the rows themselves (see syncPolicy.js).
  const empty = await storeIsEmpty()
  const decision = needsResync({ force, empty, localMeta, remote })
  if (!decision.resync) {
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

  const teams = (teamsDoc.teams || []).map(t => ({
    ...t,
    fihRank: t.fih_rank,
    winProb: t.win_prob,
    intro: t.intro,
  }))

  const matches = (fixturesDoc.matches || []).map(m => ({
    ...m,
    kickoffUtc: new Date(`${m.date}T${m.time}:00+02:00`).getTime(), // CET summer = +02:00
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
      await db.meta.put({ id: 'data', version: remote.version, updatedAt: remote.updated_at, syncedAt: Date.now() })
    })

  setStatus({ state: 'synced', version: remote.version, empty: false, error: null })
  return { status: 'synced', version: remote.version }
}

// Poll for new data versions while the app is open (matches Soccer.AI's 60s cadence —
// the version check is one tiny JSON fetch, so live results land within a minute)
export function startAutoSync(intervalMs = 60 * 1000) {
  syncData()
  // A failed first sync leaves the app with nothing to draw, so retry sooner
  // than the steady-state minute — and stop retrying fast once it lands.
  let quick = setInterval(() => {
    if (_status.state === 'error' || _status.empty) syncData({ force: true })
    else { clearInterval(quick); quick = null }
  }, 8000)
  const id = setInterval(() => syncData(), intervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncData()
  })
  return () => clearInterval(id)
}
