// Hockey.AI — Data sync engine
// Soccer.AI pulls versioned snapshots via Cloudflare server functions.
// Hockey.AI keeps the same versioned-sync UX but sources from static JSON
// written by GitHub Actions (zero backend). data-version.json bumps -> full resync.
import { db } from './db'

const DATA_BASE = `${import.meta.env.BASE_URL}data`

async function fetchJSON(path) {
  const r = await fetch(`${DATA_BASE}/${path}?t=${Date.now()}`)
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`)
  return r.json()
}

let _syncPromise = null

export function syncData({ force = false } = {}) {
  if (_syncPromise) return _syncPromise
  _syncPromise = _sync(force).finally(() => { _syncPromise = null })
  return _syncPromise
}

async function _sync(force) {
  let remote
  try {
    remote = await fetchJSON('data-version.json')
  } catch (e) {
    // Offline — Dexie already has the last snapshot. PWA keeps working.
    return { status: 'offline' }
  }

  const localMeta = await db.meta.get('data')
  if (!force && localMeta && localMeta.version >= remote.version) {
    return { status: 'fresh', version: localMeta.version }
  }

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

  return { status: 'synced', version: remote.version }
}

// Poll for new data versions while the app is open (matches Soccer.AI's 60s cadence —
// the version check is one tiny JSON fetch, so live results land within a minute)
export function startAutoSync(intervalMs = 60 * 1000) {
  syncData()
  const id = setInterval(() => syncData(), intervalMs)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncData()
  })
  return () => clearInterval(id)
}
