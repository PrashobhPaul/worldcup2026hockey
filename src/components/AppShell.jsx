import { NavLink, Link, Outlet } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { oracleRecord } from '../engine/prediction'
import { Home, CalendarDays, Users, Trophy, Target, FlaskConical } from 'lucide-react'
import InstallPrompt from './InstallPrompt'

const topLinks = [
  { to: '/', label: 'Home', end: true },
  { to: '/matches', label: 'Matches' },
  { to: '/teams', label: 'Teams' },
  { to: '/players', label: 'Players' },
  { to: '/tournament', label: 'Tournament' },
  { to: '/prediction-race', label: 'Oracle' },
  { to: '/ai-lab', label: 'AI Lab' },
  { to: '/awards', label: 'Awards' },
]

const bottomLinks = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/matches', label: 'Matches', icon: CalendarDays },
  { to: '/teams', label: 'Teams', icon: Users },
  { to: '/tournament', label: 'Cup', icon: Trophy },
  { to: '/prediction-race', label: 'Oracle', icon: Target },
  { to: '/ai-lab', label: 'AI Lab', icon: FlaskConical },
]

function OracleChip() {
  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  const rec = oracleRecord(matches ?? [], predictions ?? [])
  return (
    <Link to="/prediction-race"
      className="ml-auto flex items-center gap-1.5 rounded-md border border-brand/20 bg-brand/10 px-2.5 py-1 font-mono text-xs text-brand">
      <span>🏑</span>
      <span>{rec.correct}/{rec.graded || '—'}</span>
      <span className="text-pitch-300">·</span>
      <span>{rec.accuracyPct != null ? `${rec.accuracyPct}%` : '—'}</span>
    </Link>
  )
}

export default function AppShell() {
  return (
    <div className="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-pitch-950/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="Hockey.AI" className="h-8 w-8 rounded-lg" />
            <span className="font-display text-lg font-700 tracking-tight text-brand">Hockey.AI</span>
            <span className="hidden border-l border-white/10 pl-2 text-xs text-pitch-300 sm:block">
              FIH World Cup 2026
            </span>
          </Link>
          <div className="no-scrollbar hidden items-center gap-0.5 overflow-x-auto md:flex">
            {topLinks.map(l => (
              <NavLink key={l.to} to={l.to} end={l.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-pitch-800 text-brand' : 'text-pitch-300 hover:bg-pitch-800 hover:text-white'
                  }`}>
                {l.label}
              </NavLink>
            ))}
          </div>
          <OracleChip />
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        <Outlet />
      </main>

      <InstallPrompt />

      <footer className="mt-10 hidden border-t border-white/5 px-4 py-6 text-center text-xs leading-relaxed text-pitch-400 md:block">
        <span className="font-display text-brand">Hockey.AI</span> · FIH Hockey World Cup 2026 · Men's<br />
        AI-powered analytics. Not affiliated with FIH. Sister app:{' '}
        <a href="https://fifa2026.prashobhpaul.com" className="text-brand hover:underline">Soccer.AI</a>
        {' · '}<Link to="/trust" className="text-brand hover:underline">Trust &amp; Privacy</Link>
      </footer>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/5 bg-pitch-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="flex justify-around py-1.5">
          {bottomLinks.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex min-w-[56px] flex-col items-center gap-0.5 rounded-lg px-3 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  isActive ? 'text-brand' : 'text-pitch-400'
                }`}>
              <Icon size={20} strokeWidth={2.2} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
