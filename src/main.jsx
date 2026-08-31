import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import { startAutoSync } from './sync'
import AppShell from './components/AppShell'
import ErrorBoundary from './components/ErrorBoundary'
import HomePage from './pages/Home'
import MatchesPage from './pages/Matches'
import MatchDetailPage from './pages/MatchDetail'
import TeamsPage from './pages/Teams'
import TeamDetailPage from './pages/TeamDetail'
import PlayersPage from './pages/Players'
import TournamentPage from './pages/Tournament'
import OraclePage from './pages/Oracle'
import AILabPage from './pages/AILab'
import AwardsRedirect from './pages/Awards'
import TrustPage from './pages/Trust'
import MatchSimPage from './pages/MatchSim'

startAutoSync()

// Keep the installed app honest with the central data source. The service
// worker already serves /data/ network-first, so an open app resyncs within a
// minute; this handles the *shell*. When a new deploy's worker activates it
// takes control (clientsClaim), which fires controllerchange — reload once so
// the running app swaps to the fresh build instead of lingering on the old one.
// And poll for a new worker so a long-open app doesn't sit on a stale version.
if ('serviceWorker' in navigator) {
  // Reload on an UPDATE, never on the first install.
  //
  // clientsClaim makes a newly installed worker take control of the page that
  // installed it, which fires controllerchange on a first visit exactly as it
  // does on a real update. Reloading there threw away a page that already had
  // the newest build: the app loaded, synced, and then did the whole thing a
  // second time — which is the flicker of the match count climbing and the
  // chip dropping back into SYNCING moments after it had settled.
  //
  // A first visit has no controller to change FROM. Remembering whether one
  // was there at startup is the whole difference between an update and an
  // install.
  const hadController = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    window.location.reload()
  })
  navigator.serviceWorker.ready.then(reg => {
    // Half-hourly, not every minute. This is a network request per tick for a
    // new build, and with the tournament closed there is nothing behind it
    // often enough to justify sixty of them an hour on a phone.
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000)
  }).catch(() => {})
}

// A deploy replaces every hashed asset at once. An installed app holding a
// half-updated precache can end up asking for a chunk that no longer exists —
// the import fails, nothing renders, and no amount of reloading helps because
// the stale shell is served from the cache each time. Clear the worker and its
// caches, once per session, and reload into the current build.
const RECOVERED = 'hockeyai:recovered-stale-build'
const isLoadFailure = x => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .* failed/i
  .test(String(x?.message ?? x ?? ''))

async function recoverFromStaleBuild() {
  if (sessionStorage.getItem(RECOVERED)) return   // one attempt — never a loop
  sessionStorage.setItem(RECOVERED, String(Date.now()))
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? []
    await Promise.all(regs.map(r => r.unregister()))
    const keys = (await window.caches?.keys?.()) ?? []
    await Promise.all(keys.map(k => caches.delete(k)))
  } catch { /* nothing cached to clear */ }
  window.location.reload()
}

window.addEventListener('error', e => {
  if (isLoadFailure(e?.error ?? e?.message) || (e?.target?.tagName === 'SCRIPT' && e.target.src)) {
    recoverFromStaleBuild()
  }
}, true)
window.addEventListener('unhandledrejection', e => {
  if (isLoadFailure(e?.reason)) recoverFromStaleBuild()
})
// The app got as far as running, so this session is not stuck on a stale build.
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem(RECOVERED), 5000)
})

// Honor Vite's base path (e.g. /worldcup2026hockey/ on GitHub Pages)
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/matches', element: <MatchesPage /> },
      { path: '/matches/:matchId', element: <MatchDetailPage /> },
      { path: '/teams', element: <TeamsPage /> },
      { path: '/teams/:teamCode', element: <TeamDetailPage /> },
      { path: '/players', element: <PlayersPage /> },
      { path: '/tournament', element: <TournamentPage /> },
      { path: '/prediction-race', element: <OraclePage /> },
      { path: '/ai-lab', element: <AILabPage /> },
      { path: '/awards', element: <AwardsRedirect /> },
      { path: '/trust', element: <TrustPage /> },
      { path: '/match/sim/:simId', element: <MatchSimPage /> },
      { path: '*', element: <HomePage /> },
    ],
  },
], { basename })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Take the splash down once there is something behind it. requestAnimationFrame
// waits for the first painted frame, so the app is never revealed mid-render.
// The timeout is the safety net: a splash that outlives a failed start would
// hide the error boundary behind a screen that looks like loading forever.
function dismissSplash() {
  const el = document.getElementById('splash')
  if (!el || el.classList.contains('is-done')) return
  el.classList.add('is-done')
  setTimeout(() => el.remove(), 400)
}
requestAnimationFrame(() => requestAnimationFrame(dismissSplash))
setTimeout(dismissSplash, 6000)
