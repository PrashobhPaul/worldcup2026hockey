// Hockey.AI — favourite-team match alerts, zero-backend edition.
//
// There is no push server, so these are honest about what a static app can
// do: while the app is open (or backgrounded), every data sync checks the
// followed team's fixtures and raises a system notification when a match is
// about to push back or a result has just been confirmed. Each alert fires
// once, tracked in localStorage. When the app is fully closed nothing can wake
// it — the copy in the UI says so.
//
// Two ways of showing one, because the three places this app runs do not agree
// on what a notification is:
//
//   * Browser and installed web app — the Web Notifications API, shown through
//     the service worker registration so the notification outlives the page.
//   * The Android app — Android's web view implements no Notification API at
//     all, so `typeof Notification` is undefined there and the web path silently
//     reported alerts as unsupported. It goes through Capacitor's local
//     notifications instead, which are real Android notifications.
//
// Everything below picks between those two at runtime, so the same build works
// in all three and no caller has to know which one it is talking to.
import { db } from './db'

/** Running inside the Android app rather than a browser. */
const isNative = () =>
  typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true

// Loaded only on native, so the web bundle never pulls the plugin in.
let _plugin
async function nativeNotifications() {
  if (!isNative()) return null
  if (_plugin === undefined) {
    _plugin = import('@capacitor/local-notifications')
      .then(m => m.LocalNotifications)
      .catch(() => null)
  }
  return _plugin
}

/** A stable positive 31-bit id, since Android keys notifications by number. */
function idFromTag(tag) {
  let h = 5381
  for (let i = 0; i < tag.length; i++) h = ((h * 33) ^ tag.charCodeAt(i)) >>> 0
  return (h % 21474835) + 1
}

const FAV_KEY = 'hockeyai:favourite-team'
const ENABLED_KEY = 'hockeyai:alerts-enabled'
const SENT_KEY = 'hockeyai:alerts-sent'
const SOON_MIN = 30            // "starts soon" window before push-back
const RESULT_FRESH_H = 6       // don't announce results older than this

export function alertsSupported() {
  return isNative() || typeof Notification !== 'undefined'
}

export function alertsEnabled() {
  try {
    if (localStorage.getItem(ENABLED_KEY) !== '1') return false
    // On native the stored flag is only ever set after Android granted the
    // permission, so it is the whole answer. On the web the browser can revoke
    // permission behind our back, so ask it every time.
    return isNative() || (typeof Notification !== 'undefined' && Notification.permission === 'granted')
  } catch { return false }
}

export async function enableAlerts() {
  if (!alertsSupported()) return false
  if (isNative()) {
    const LN = await nativeNotifications()
    if (!LN) return false
    // Android 13+ prompts here; older versions report granted straight away.
    let granted = (await LN.checkPermissions())?.display
    if (granted !== 'granted') granted = (await LN.requestPermissions())?.display
    if (granted !== 'granted') return false
    try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* private mode */ }
    return true
  }
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
  if (isNative()) {
    const LN = await nativeNotifications()
    if (!LN) return
    try {
      await LN.schedule({ notifications: [{ id: idFromTag(tag), title, body, smallIcon: 'ic_launcher' }] })
    } catch { /* denied or unavailable */ }
    return
  }
  try {
    // Through the registration rather than the page, so the notification
    // survives the tab being closed. The app build has no service worker, but
    // it never reaches here — it took the native path above.
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
