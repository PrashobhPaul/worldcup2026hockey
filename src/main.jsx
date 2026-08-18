import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles.css'
import { startAutoSync } from './sync'
import AppShell from './components/AppShell'
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
    <RouterProvider router={router} />
  </React.StrictMode>,
)
