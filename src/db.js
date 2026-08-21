// Hockey.AI — Dexie (IndexedDB) schema
// Mirrors Soccer.AI's client datastore design, adapted for field hockey.
//
// Everything in here is a CACHE of public JSON that the pipeline publishes —
// there is no user-authored data in this database. That matters when something
// goes wrong: throwing the store away and refetching costs the reader a few
// seconds, so the recovery paths below never hesitate to do it.
import Dexie from 'dexie'

export const db = new Dexie('hockeyai')

const STORES = {
  teams: 'code, pool, fihRank, winProb',
  players: 'id, team, [team+position], position',
  matches: 'id, phase, pool, kickoffUtc, status, home, away',
  match_events: '++eid, matchId, [matchId+seq], type',
  predictions: 'id, matchId, source, [source+matchId]',
  ai_stories: 'matchId, generatedAt',
  user_state: 'id',
  meta: 'id',
}

db.version(1).stores(STORES)
// v2 adds the head-to-head archive, keyed by the sorted team pair ("FRA-RSA").
// Declared as its own version so an installed app upgrades in place instead of
// losing everything it already holds.
db.version(2).stores({ ...STORES, h2h: 'pair' })

// Another tab is holding this database open on an older schema, so our upgrade
// cannot run. Dexie's default is to wait — silently, forever, which renders as
// an app where every tab is empty and nothing explains why. Report it instead.
let _blocked = false
const blockedListeners = new Set()
export const isDbBlocked = () => _blocked
export function onDbBlocked(fn) {
  blockedListeners.add(fn)
  fn(_blocked)
  return () => blockedListeners.delete(fn)
}
db.on('blocked', () => {
  _blocked = true
  blockedListeners.forEach(fn => fn(true))
})

// A newer tab wants to upgrade the schema: let go of it and pick up the new
// build, rather than blocking that tab the way the one above was blocked.
db.on('versionchange', () => {
  db.close()
  if (typeof window !== 'undefined') window.location.reload()
})

/**
 * Open the database, and if it cannot be opened, rebuild it. A corrupt or
 * newer-than-expected store (a downgrade, an interrupted upgrade) otherwise
 * leaves every query pending and the whole app blank.
 */
export async function openDb() {
  try {
    await db.open()
    return { ok: true }
  } catch (err) {
    try {
      db.close()
      await Dexie.delete('hockeyai')
      await db.open()
      return { ok: true, rebuilt: true, error: err }
    } catch (fatal) {
      return { ok: false, error: fatal }
    }
  }
}

/** Throw the cache away and start again — the reset behind the banner button. */
export async function resetLocalData() {
  try { db.close() } catch { /* already closed */ }
  await Dexie.delete('hockeyai')
}

export function getDb() {
  return db
}
