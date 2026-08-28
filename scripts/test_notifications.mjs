// Hockey.AI — alerts have to work in all three places the app runs.
//
// They did not. notify.js gated everything on `typeof Notification`, which
// exists in a browser and in an installed web app but NOT in Android's web
// view — the app build has no service worker either, so the fallback was a
// constructor that is not there. alertsSupported() therefore returned false in
// the APK and the whole feature was silently absent on the one platform where
// people most expect a match alert.
//
// This drives the real module three times over, once per platform, with only
// the globals each platform actually provides:
//
//   browser          Notification + a service worker registration
//   installed webapp  same APIs, standalone display mode
//   android app       no Notification at all, Capacitor present instead
//
// Run: npm run test:notifications
import { readFileSync } from 'node:fs'

let failures = 0
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}   ${name}${detail && !cond ? ` — ${detail}` : ''}`)
  if (!cond) failures++
}

// notify.js is an ES module written against browser globals and Vite's
// import.meta.env, so it is exercised through a small transform rather than a
// bundler: the behaviour under test is the branching, not the imports.
const src = readFileSync(new URL('../src/notify.js', import.meta.url), 'utf8')

function loadModule({ notification, serviceWorker, capacitor, plugin }) {
  const store = new Map()
  const sandbox = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
    Notification: notification,
    navigator: { serviceWorker },
    window: { Capacitor: capacitor },
    db: { matches: { where: () => ({ equals: () => ({ or: () => ({ equals: () => ({ toArray: async () => [] }) }) }) }) } },
    shown: [],
    plugin,
    store,
  }

  let code = src
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/import\.meta\.env\.BASE_URL/g, '"/"')
    .replace(/\bexport\s+/g, '')
  // The dynamic plugin import is the one thing a plain evaluation cannot do,
  // so it is swapped for the stub. Exact text, not a pattern: if notify.js
  // rewrites this line the substitution stops matching and the assertion below
  // fails loudly rather than the test quietly exercising nothing.
  const IMPORT_CHAIN = `import('@capacitor/local-notifications')
      .then(m => m.LocalNotifications)
      .catch(() => null)`
  if (!code.includes(IMPORT_CHAIN)) {
    throw new Error('notify.js no longer contains the expected plugin import — update this test')
  }
  code = code.replace(IMPORT_CHAIN, 'Promise.resolve(plugin && plugin.LocalNotifications)')
  code += '\n;return { alertsSupported, alertsEnabled, enableAlerts, disableAlerts, show, isNative };'

  const keys = Object.keys(sandbox)
  const fn = new Function(...keys, code)
  return fn(...keys.map(k => sandbox[k]))
}

const swRegistration = {
  ready: null,
  showNotification(title, opts) { this._shown.push({ title, opts }); return Promise.resolve() },
  _shown: [],
}
swRegistration.ready = Promise.resolve(swRegistration)

console.log('Alerts across browser, installed web app and Android app\n')

// ---------------------------------------------------------------- browser --
{
  const reg = { _shown: [], showNotification(t, o) { this._shown.push({ t, o }); return Promise.resolve() } }
  const web = loadModule({
    notification: class { static permission = 'granted'; static requestPermission = async () => 'granted' },
    serviceWorker: { ready: Promise.resolve(reg) },
    capacitor: undefined,
    plugin: null,
  })
  ok('browser: alerts report as supported', web.alertsSupported())
  ok('browser: not enabled until the user turns them on', !web.alertsEnabled())
  const granted = await web.enableAlerts()
  ok('browser: enabling asks the browser and sticks', granted && web.alertsEnabled())
  await web.show('T', 'B', 'tag:1')
  ok('browser: shown through the service worker registration', reg._shown.length === 1,
     `registration received ${reg._shown.length}`)
}

// ------------------------------------------------------- installed webapp --
{
  const reg = { _shown: [], showNotification() { this._shown.push(1); return Promise.resolve() } }
  const app = loadModule({
    notification: class { static permission = 'granted'; static requestPermission = async () => 'granted' },
    serviceWorker: { ready: Promise.resolve(reg) },
    capacitor: undefined,
    plugin: null,
  })
  await app.enableAlerts()
  await app.show('T', 'B', 'tag:2')
  ok('installed web app: same path as the browser', app.alertsEnabled() && reg._shown.length === 1)
}

// ------------------------------------------------------------ android app --
{
  const calls = []
  const LocalNotifications = {
    checkPermissions: async () => ({ display: 'prompt' }),
    requestPermissions: async () => ({ display: 'granted' }),
    schedule: async payload => { calls.push(payload); return {} },
  }
  const native = loadModule({
    notification: undefined,                 // Android's web view has none
    serviceWorker: undefined,                // the app build ships no worker
    capacitor: { isNativePlatform: () => true },
    plugin: { LocalNotifications },
  })
  ok('android: supported even with no Notification API', native.alertsSupported())
  const granted = await native.enableAlerts()
  ok('android: permission requested and granted', granted && native.alertsEnabled())
  await native.show('Full-time', 'IND 3–2 BEL', 'ft:POS7')
  ok('android: raised through the native plugin', calls.length === 1,
     `plugin received ${calls.length} calls`)
  const n = calls[0]?.notifications?.[0]
  ok('android: carries a title, body and a numeric id',
     !!n && n.title === 'Full-time' && n.body === 'IND 3–2 BEL' && Number.isInteger(n.id) && n.id > 0,
     JSON.stringify(n))

  // Android keys notifications by number, so the same event must not land on
  // two different ids, and two different events must not collide on one.
  const a = loadModule({ notification: undefined, serviceWorker: undefined,
    capacitor: { isNativePlatform: () => true }, plugin: { LocalNotifications } })
  await a.show('x', 'y', 'ft:POS7')
  const same = calls[calls.length - 1].notifications[0].id === n.id
  await a.show('x', 'y', 'start:POS7')
  const diff = calls[calls.length - 1].notifications[0].id !== n.id
  ok('android: ids are stable per event and distinct between events', same && diff)
}

// A regression guard for the actual bug: the web path must never be the one
// chosen on native, because that is what silently disabled alerts in the APK.
{
  const native = loadModule({
    notification: undefined, serviceWorker: undefined,
    capacitor: { isNativePlatform: () => true }, plugin: { LocalNotifications: {
      checkPermissions: async () => ({ display: 'granted' }),
      requestPermissions: async () => ({ display: 'granted' }),
      schedule: async () => ({}) } },
  })
  ok('android: never falls back to the web Notification API', native.alertsSupported() === true)
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAlerts work in all three modes.')
process.exit(failures ? 1 : 0)
