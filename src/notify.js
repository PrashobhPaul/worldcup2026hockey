// Hockey.AI — favourite-team match alerts, zero-backend edition.
//
// There is no push server, so these are honest about what a static PWA can
// do: while the app is open (or its tab is backgrounded), every data sync
// checks the followed team's fixtures and raises a system notification when
// a match is about to push back or a result has just been confirmed. Each
// alert fires once, tracked in localStorage. When the app is fully closed
// nothing can wake it — the copy in the UI says so.
import { db } from './db'

const FAV_KEY = 'hockeyai:favourite-team'
const ENABLED_KEY = 'hockeyai:alerts-enabled'
const SENT_KEY = 'hockeyai:alerts-sent'
const SOON_MIN = 30            // "starts soon" window before push-back
const RESULT_FRESH_H = 6       // don't announce results older than this

export function alertsSupported() {
  return typeof Notification !== 'undefined'
}

export function alertsEnabled() {
  try {
    return alertsSupported() && Notification.permission === 'granted'
      && localStorage.getItem(ENABLED_KEY) === '1'
  } catch { return false }
}

export async function enableAlerts() {
  if (!alertsSupported()) return false
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return false
  try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* private mode */ }
  return true
}

export function disableAlerts() {
  try { localStorage.setItem(ENABLED_KEY, '0') } catch { /* private mode */ }
}

function sentSet() {
  try { return new Set(JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]')) } catch { return new Set() }
}

function markSent(set, key) {
  set.add(key)
  try { localStorage.setItem(SENT_KEY, JSON.stringify([...set])) } catch { /* private mode */ }
}

async function show(title, body, tag) {
  try {
    const reg = await navigator.serviceWorker?.ready
    if (reg?.showNotification) return reg.showNotification(title, { body, tag, icon: `${import.meta.env.BASE_URL}icon-192.png` })
  } catch { /* fall through to page-scope notification */ }
  try { new Notification(title, { body, tag }) } catch { /* blocked */ }
}

/** Called after every successful sync — cheap, idempotent, once per event. */
export async function checkFavouriteAlerts() {
  if (!alertsEnabled()) return
  let fav = null
  try { fav = localStorage.getItem(FAV_KEY) } catch { return }
  if (!fav) return

  const now = Date.now()
  const sent = sentSet()
  const matches = await db.matches.where('home').equals(fav).or('away').equals(fav).toArray()
  for (const m of matches) {
    const opp = m.home === fav ? m.away : m.home
    const startKey = `start:${m.id}`
    if (m.status === 'scheduled' && !sent.has(startKey)
        && m.kickoffUtc - now > 0 && m.kickoffUtc - now < SOON_MIN * 60000) {
      markSent(sent, startKey)
      await show(`${fav} v ${opp} starts soon`, `Push-back ${m.time} CET — follow it live in Hockey.AI.`, startKey)
    }
    const ftKey = `ft:${m.id}`
    if (m.status === 'completed' && m.score?.home != null && !sent.has(ftKey)) {
      markSent(sent, ftKey)
      // Only announce a genuinely fresh result — a first sync on a new device
      // must not replay the whole tournament.
      if (now - m.kickoffUtc < RESULT_FRESH_H * 3600000) {
        await show(`Full-time: ${m.home} ${m.score.home}–${m.score.away} ${m.away}`,
          'Final score confirmed from the official record. Tap for the timeline and stats.', ftKey)
      }
    }
  }
}
