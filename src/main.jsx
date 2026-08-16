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
