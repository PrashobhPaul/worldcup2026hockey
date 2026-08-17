import { useState } from 'react'
import { useSwipeTabs } from '../components/useSwipeTabs'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard, { formatDate } from '../components/MatchCard'
import { Skeleton } from '../components/shared'
import { oracleRecord } from '../engine/prediction'
import { SIM_ID, SIM_MATCH } from '../content/sim'

function OracleRecordStrip({ matches }) {
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  const rec = oracleRecord(matches, predictions)
  if (!rec.graded) return null
  return (
    <Link to="/prediction-race"
      className="mb-4 flex items-center justify-between rounded-lg border border-brand/20 bg-brand/5 px-3.5 py-2 font-mono text-[11px] transition-colors hover:border-brand/40">
      <span className="text-pitch-300">🎯 AI pre-match picks</span>
      <span className="font-bold text-brand">{rec.correct}/{rec.graded} correct · {rec.accuracyPct}%</span>
    </Link>
  )
}

function SimulationCard() {
  return (
    <div className="mb-4">
      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-pitch-400">✨ AI Simulation</div>
      <Link to={`/match/sim/${SIM_ID}`}
        className="flex items-center gap-3 rounded-xl border border-brand/20 bg-gradient-to-r from-brand/10 to-pitch-800 p-3.5 transition-colors hover:border-brand/40">
        <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest text-brand">
          {SIM_MATCH.statusChip}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {SIM_MATCH.homeLabel} <span className="font-mono text-xs text-pitch-400">vs</span> {SIM_MATCH.awayLabel}
        </span>
        <span className="font-mono text-sm font-bold text-brand">{SIM_MATCH.result.home}–{SIM_MATCH.result.away}</span>
      </Link>
    </div>
  )
}

// Three sections, no "All": Upcoming (what's next), Live (in play), and
// Results (played). Each tab maps to a fixture status. Results leads because a
// running tournament is read newest-result-first; if a match is live the badge
// pulls the eye to it.
const STATUS_TABS = [
  { id: 'results', label: 'Results', status: 'completed' },
  { id: 'live', label: '🔴 Live', status: 'live' },
  { id: 'upcoming', label: 'Upcoming', status: 'scheduled' },
]
const POOL_TABS = ['all', 'A', 'B', 'C', 'D', 'knockout']
const DEFAULT_TAB = 'results'

export default function MatchesPage() {
  const [params, setParams] = useSearchParams()
  const initialTab = STATUS_TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : DEFAULT_TAB
  const [tab, setTab] = useState(initialTab)
  const [pool, setPool] = useState(params.get('pool') || 'all')
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])

  const loading = matches === undefined
  const all = matches ?? []

  const counts = {
    results: all.filter(m => m.status === 'completed').length,
    live: all.filter(m => m.status === 'live').length,
    upcoming: all.filter(m => m.status === 'scheduled').length,
  }

  const activeStatus = (STATUS_TABS.find(t => t.id === tab) ?? STATUS_TABS[0]).status
  const filtered = all.filter(m => {
    const statusOk = m.status === activeStatus
    const poolOk = pool === 'all' ? true : pool === 'knockout' ? m.phase !== 'pool' : m.pool === pool
    return statusOk && poolOk
  })

  useSwipeTabs({
    count: STATUS_TABS.length,
    index: Math.max(0, STATUS_TABS.findIndex(t => (t.id ?? t) === tab)),
    onChange: i => setFilter('tab', STATUS_TABS[i].id ?? STATUS_TABS[i], setTab),
  })

  // Within a day, Results/Live read newest-first (latest match on top, scroll
  // down toward the opening fixture — the order the official and competitor
  // apps use); Upcoming reads soonest-first ("what's next"). Days sort the same
  // way: most-recent day on top for played/live, nearest day on top for future.
  const now = Date.now()
  const byDate = {}
  for (const m of filtered) (byDate[m.date] ??= []).push(m)
  const dayIsFuture = date =>
    byDate[date].every(m => m.status === 'scheduled' && (m.kickoffUtc ?? 0) > now)
  for (const [date, day] of Object.entries(byDate)) {
    const asc = dayIsFuture(date)
    day.sort((a, b) => asc ? a.kickoffUtc - b.kickoffUtc : b.kickoffUtc - a.kickoffUtc)
  }
  const orderedDates = Object.keys(byDate).sort((a, b) => {
    const fa = dayIsFuture(a), fb = dayIsFuture(b)
    if (fa !== fb) return fa ? 1 : -1
    const ka = byDate[a][0].kickoffUtc ?? 0, kb = byDate[b][0].kickoffUtc ?? 0
    return fa ? ka - kb : kb - ka
  })

  const setFilter = (key, value, setter) => {
    setter(value)
    const next = new URLSearchParams(params)
    value === 'all' ? next.delete(key) : next.set(key, value)
    setParams(next, { replace: true })
  }

  return (
    <div>
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🏑 Matches</h1>
        <p className="mt-1 text-xs text-pitch-400">
          {counts.results} of {all.length} fixtures{counts.live > 0 && <span className="text-live"> · {counts.live} LIVE</span>}
        </p>
      </div>

      <div className="sticky top-14 z-30 -mx-4 mb-3 flex gap-1.5 overflow-x-auto border-b border-white/5 bg-pitch-950/90 px-4 py-2 backdrop-blur-xl no-scrollbar" role="tablist">
        {STATUS_TABS.map(t => (
          <button key={t.id} onClick={() => setFilter('tab', t.id, setTab)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {t.label} <span className="ml-1 font-mono text-[10px] opacity-70">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {POOL_TABS.map(p => (
          <button key={p} onClick={() => setFilter('pool', p, setPool)}
            className={`rounded-md border px-3 py-1 font-mono text-xs font-semibold capitalize transition-colors ${
              pool === p ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {p === 'all' ? 'All Pools' : p === 'knockout' ? 'Knockouts' : `Pool ${p}`}
          </button>
        ))}
      </div>

      {tab === 'results' && !loading && <OracleRecordStrip matches={all} />}
      {tab === 'live' && <SimulationCard />}

      {loading ? <Skeleton h={400} /> : (
        <div className="space-y-2.5">
          {Object.keys(byDate).length === 0 && (
            <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
              No matches match this filter.
            </div>
          )}
          {orderedDates.map(date => (
            <div key={date}>
              <div className="my-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-pitch-400">
                <span className="h-px flex-1 bg-white/5" />
                {formatDate(date)}
                <span className="h-px flex-1 bg-white/5" />
              </div>
              <div className="space-y-2.5">
                {byDate[date].map(m => <MatchCard key={m.id} match={m} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
