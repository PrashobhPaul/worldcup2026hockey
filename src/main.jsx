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
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  navigator.serviceWorker.ready.then(reg => {
    setInterval(() => reg.update().catch(() => {}), 60 * 1000)
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
