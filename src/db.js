// Hockey.AI — Dexie (IndexedDB) schema
// Mirrors Soccer.AI's client datastore design, adapted for field hockey.
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

export function getDb() {
  return db
}
