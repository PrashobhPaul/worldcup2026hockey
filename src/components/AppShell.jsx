import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { oracleRecord } from '../engine/prediction'
import { Home, CalendarDays, Users, UserRound, Trophy, Target, FlaskConical } from 'lucide-react'
import InstallPrompt from './InstallPrompt'
import { useSwipeTabs, SWIPE_PRIORITY } from './useSwipeTabs'

// One tab list, used by the desktop bar and the mobile bar alike — the app has
// the same tabs, in the same order, on every device.
const TABS = [
  { to: '/', label: 'Home', short: 'Home', icon: Home, end: true },
  { to: '/matches', label: 'Matches', short: 'Matches', icon: CalendarDays },
  { to: '/teams', label: 'Teams', short: 'Teams', icon: Users },
  { to: '/players', label: 'Players', short: 'Players', icon: UserRound },
  { to: '/tournament', label: 'Tournament', short: 'Cup', icon: Trophy },
  { to: '/prediction-race', label: 'Oracle', short: 'Oracle', icon: Target },
  { to: '/ai-lab', label: 'AI Lab', short: 'AI Lab', icon: FlaskConical },
]

function OracleChip() {
  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  const rec = oracleRecord(matches ?? [], predictions ?? [])
  return (
    <Link to="/prediction-race"
      className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-brand/20 bg-brand/10 px-2.5 py-1 font-mono text-xs text-brand">
      <span>🏑</span>
      <span>{rec.correct}/{rec.graded || '—'}</span>
      <span className="text-pitch-300">·</span>
      <span>{rec.accuracyPct != null ? `${rec.accuracyPct}%` : '—'}</span>
    </Link>
  )
}

export default function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Which tab is showing — deepest matching prefix wins so /teams/NED counts
  // as Teams. Detail pages that belong to no tab return -1 and don't swipe.
  const active = TABS.reduce((best, tab, i) => {
    const hit = tab.end ? pathname === '/' : pathname.startsWith(tab.to)
    return hit && (best < 0 || tab.to.length > TABS[best].to.length) ? i : best
  }, -1)

  useSwipeTabs({
    count: TABS.length,
    index: active,
    enabled: active >= 0,
    priority: SWIPE_PRIORITY.shell,
    onChange: i => navigate(TABS[i].to),
  })

  return (
    <div className="min-h-dvh pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-pitch-950/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="Hockey.AI — home">
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" className="h-8 w-8 rounded-lg" />
            <img src={`${import.meta.env.BASE_URL}hockeyai_name.png`} alt="Hockey.AI"
              className="h-6 w-auto sm:h-7" />
          </Link>
          <div className="no-scrollbar hidden items-center gap-0.5 overflow-x-auto md:flex">
            {TABS.map(t => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-pitch-800 text-brand' : 'text-pitch-300 hover:bg-pitch-800 hover:text-white'
                  }`}>
                {t.label}
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

      {/* Bottom nav (mobile) — same seven tabs as the desktop bar */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-white/5 bg-pitch-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="flex py-1.5">
          {TABS.map(({ to, short, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) =>
                `flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-0.5 py-1 text-[9px] font-semibold uppercase tracking-wide transition-colors ${
                  isActive ? 'text-brand' : 'text-pitch-400'
                }`}>
              <Icon size={19} strokeWidth={2.2} />
              <span className="w-full truncate text-center">{short}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
