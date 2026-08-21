// Hockey.AI — the one team this reader follows.
//
// Stored in localStorage, deliberately NOT in Dexie: the 'hockeyai' database
// is a cache of public JSON whose recovery paths (a corrupt-store rebuild,
// the banner's "Reset app data") delete it without hesitation, and that is
// only safe because it holds no user-authored data. The favourite is the one
// thing the reader authors, so it lives outside the blast radius. One team,
// not a list — "your team" is a singular in sport.
import { useSyncExternalStore } from 'react'

const KEY = 'hockeyai:favourite-team'
const listeners = new Set()
const emit = () => listeners.forEach(fn => fn())

if (typeof window !== 'undefined') {
  // Another tab changing the favourite updates this one too.
  window.addEventListener('storage', e => { if (e.key === KEY) emit() })
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function read() {
  try { return localStorage.getItem(KEY) } catch { return null }
}

/** null when unset, else a team code ("IND"). Reactive across components. */
export function useFavourite() {
  return useSyncExternalStore(subscribe, read, () => null)
}

/** Follow the team; following the current favourite unfollows it. Synchronous
 *  read-modify-write, so a double-tap nets out instead of losing a toggle. */
export function toggleFavourite(code) {
  try {
    if (localStorage.getItem(KEY) === code) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, code)
  } catch { /* storage unavailable (private mode) — following just won't stick */ }
  emit()
}
