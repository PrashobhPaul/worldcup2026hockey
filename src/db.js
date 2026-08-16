// Hockey.AI — Dexie (IndexedDB) schema
// Mirrors Soccer.AI's client datastore design, adapted for field hockey.
import Dexie from 'dexie'

export const db = new Dexie('hockeyai')

db.version(1).stores({
  teams: 'code, pool, fihRank, winProb',
  players: 'id, team, [team+position], position',
  matches: 'id, phase, pool, kickoffUtc, status, home, away',
  match_events: '++eid, matchId, [matchId+seq], type',
  predictions: 'id, matchId, source, [source+matchId]',
  ai_stories: 'matchId, generatedAt',
  user_state: 'id',
  meta: 'id',
})

export function getDb() {
  return db
}
