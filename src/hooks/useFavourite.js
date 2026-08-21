// Hockey.AI — the one team this reader follows.
//
// Stored locally in Dexie (user_state), because the app has no backend and
// needs none for this: personalization is a property of the device, not of an
// account. One team, not a list — "your team" is a singular in sport.
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'

const KEY = 'favourite-team'

/** undefined while loading, null when unset, else a team code ("IND"). */
export function useFavourite() {
  // get() resolves to undefined for a missing key — indistinguishable from
  // useLiveQuery's still-loading undefined. toArray() resolves to [], which
  // is how "asked and answered: none" stays distinct from "still asking".
  const rows = useLiveQuery(() => db.user_state.where('id').equals(KEY).toArray(), [])
  if (rows === undefined) return undefined
  return rows[0]?.team ?? null
}

/** Star the team; starring the current favourite un-stars it. */
export async function toggleFavourite(code) {
  const row = await db.user_state.get(KEY)
  if (row?.team === code) await db.user_state.delete(KEY)
  else await db.user_state.put({ id: KEY, team: code, setAt: Date.now() })
}
