import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard from '../components/MatchCard'
import { SectionHead, Skeleton, StandingsTable, WinProbBar } from '../components/shared'
import { computeStandings } from '../engine/standings'
import { oracleRecord } from '../engine/prediction'
import { FlaskConical, Target, BarChart3, Users } from 'lucide-react'

const quickLinks = [
  { to: '/ai-lab', icon: FlaskConical, title: 'AI Lab', sub: 'Match intelligence' },
  { to: '/prediction-race', icon: Target, title: 'Oracle', sub: 'Prediction race' },
  { to: '/tournament', icon: BarChart3, title: 'Standings', sub: 'All 4 pools' },
  { to: '/players', icon: Users, title: 'Players', sub: 'Stats & profiles' },
]

export default function HomePage() {
  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  const [pool, setPool] = useState('A')

  const loading = teams === undefined || matches === undefined
  const today = new Date().toISOString().slice(0, 10)
  const todayMatches = (matches ?? []).filter(m => m.date === today)
  const upcoming = (matches ?? []).filter(m => m.status !== 'completed').slice(0, 3)
  const showMatches = todayMatches.length ? todayMatches : upcoming
  const liveNow = (matches ?? []).some(m => m.status === 'live')

  const standings = computeStandings(teams ?? [], matches ?? [])
  const poolStandings = standings.find(p => p.id === pool)?.standings ?? []

  const sorted = [...(teams ?? [])].sort((a, b) => b.winProb - a.winProb)
  const favourites = sorted.filter(t => t.contender_tier === 'favourite')
  const darkHorses = sorted.filter(t => t.contender_tier === 'dark_horse')

  const completed = (matches ?? []).filter(m => m.status === 'completed' && m.score?.home != null)
  const latest = completed[completed.length - 1]
  const rec = oracleRecord(matches ?? [], predictions ?? [])

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-pitch-800 to-pitch-900 p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-16 top-1/2 hidden h-64 w-64 -translate-y-1/2 rounded-full border border-brand/10 sm:block">
          <div className="absolute inset-5 rounded-full border border-brand/5" />
        </div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-pitch-300">
          🏑 Men's · Aug 15–30 · Belgium & Netherlands
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">
          Hockey<span className="text-brand">.AI</span>
        </h1>
        <p className="mt-2 max-w-md text-sm text-pitch-300">
          AI stories, match intelligence, simulations and visual analytics for every FIH Hockey World Cup 2026 fixture.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
          {liveNow && (
            <span className="flex items-center gap-1.5 rounded-md border border-live/30 bg-live/10 px-2.5 py-1 text-live">
              <span className="live-dot" /> Live Now
            </span>
          )}
          <span className="rounded-md border border-white/5 bg-pitch-800 px-2.5 py-1 text-pitch-300">🌍 16 Nations</span>
          <span className="rounded-md border border-white/5 bg-pitch-800 px-2.5 py-1 text-pitch-300">🏑 32 Matches</span>
          <span className="rounded-md border border-brand/20 bg-brand/10 px-2.5 py-1 text-brand">🤖 AI Predictions</span>
        </div>
      </section>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {quickLinks.map(({ to, icon: Icon, title, sub }) => (
          <Link key={to} to={to}
            className="rounded-xl border border-white/5 bg-pitch-800 p-3.5 text-center transition-colors hover:border-brand/25">
            <Icon size={18} className="mx-auto mb-1.5 text-brand" />
            <div className="text-sm font-bold">{title}</div>
            <div className="text-[11px] text-pitch-400">{sub}</div>
          </Link>
        ))}
      </div>

      {/* Today's matches */}
      <section>
        <SectionHead title={todayMatches.length ? "🔴 Today's Matches" : '⏭ Next Matches'} to="/matches" toLabel="All matches →" />
        {loading ? <Skeleton h={260} /> : (
          <div className="space-y-2.5">
            {showMatches.length
              ? showMatches.map(m => <MatchCard key={m.id} match={m} />)
              : <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">No matches scheduled.</div>}
          </div>
        )}
      </section>

      {/* Standings preview */}
      <section>
        <SectionHead title="📊 Pool Standings" to="/tournament" toLabel="Full table →" />
        <div className="mb-3 flex gap-1.5">
          {['A', 'B', 'C', 'D'].map(p => (
            <button key={p} onClick={() => setPool(p)}
              className={`rounded-md border px-3 py-1 font-mono text-xs font-semibold transition-colors ${
                pool === p ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
              }`}>
              Pool {p}
            </button>
          ))}
        </div>
        {loading ? <Skeleton h={220} /> : (
          <div className="rounded-xl border border-white/5 bg-pitch-800 p-3">
            <StandingsTable standings={poolStandings} />
          </div>
        )}
      </section>

      {/* Win probability */}
      <section>
        <SectionHead title="📈 Tournament Win Probability" sub="Recalibrated after every match" />
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-pitch-400">⭐ Favourites</p>
        <div className="space-y-2">
          {loading ? <Skeleton h={200} /> : favourites.map(t => <WinProbBar key={t.code} team={t} />)}
        </div>
        <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-pitch-400">🐎 Dark Horses</p>
        <div className="space-y-2">
          {loading ? <Skeleton h={130} /> : darkHorses.map(t => <WinProbBar key={t.code} team={t} />)}
        </div>
      </section>

      {/* Oracle preview */}
      <section>
        <SectionHead title="🎯 The Oracle" to="/prediction-race" toLabel="Full record →" />
        <div className="flex items-center gap-5 rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4">
          <div className="text-center">
            <div className="font-mono text-3xl font-bold text-brand">{rec.accuracyPct != null ? `${rec.accuracyPct}%` : '—'}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-pitch-400">Accuracy</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-3xl font-bold text-brand">{rec.correct}/{rec.graded}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-pitch-400">Correct picks</div>
          </div>
          <p className="flex-1 text-xs leading-relaxed text-pitch-300">
            Every pick published before push-back, graded publicly. No edits. No deletions.
          </p>
        </div>
      </section>

      {/* Latest result */}
      {latest && (
        <section>
          <SectionHead title="⚡ Latest Result" to="/matches?tab=completed" toLabel="All results →" />
          <MatchCard match={latest} />
        </section>
      )}
    </div>
  )
}
