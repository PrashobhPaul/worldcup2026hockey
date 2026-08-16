import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard, { formatDate } from '../components/MatchCard'
import { Skeleton } from '../components/shared'

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'live', label: '🔴 Live' },
  { id: 'completed', label: 'Played' },
  { id: 'scheduled', label: 'Upcoming' },
]
const POOL_TABS = ['all', 'A', 'B', 'C', 'D', 'knockout']

export default function MatchesPage() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(params.get('tab') || 'all')
  const [pool, setPool] = useState(params.get('pool') || 'all')
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])

  const loading = matches === undefined
  const all = matches ?? []

  const counts = {
    all: all.length,
    live: all.filter(m => m.status === 'live').length,
    completed: all.filter(m => m.status === 'completed').length,
    scheduled: all.filter(m => m.status === 'scheduled').length,
  }

  const filtered = all.filter(m => {
    const statusOk = tab === 'all' ? true : m.status === tab
    const poolOk = pool === 'all' ? true : pool === 'knockout' ? m.phase !== 'pool' : m.pool === pool
    return statusOk && poolOk
  })

  const byDate = {}
  for (const m of filtered) (byDate[m.date] ??= []).push(m)

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
          {counts.completed} of {counts.all} fixtures{counts.live > 0 && <span className="text-live"> · {counts.live} LIVE</span>}
        </p>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
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

      {loading ? <Skeleton h={400} /> : (
        <div className="space-y-2.5">
          {Object.keys(byDate).length === 0 && (
            <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
              No matches match this filter.
            </div>
          )}
          {Object.entries(byDate).sort().map(([date, dayMatches]) => (
            <div key={date}>
              <div className="my-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-wider text-pitch-400">
                <span className="h-px flex-1 bg-white/5" />
                {formatDate(date)}
                <span className="h-px flex-1 bg-white/5" />
              </div>
              <div className="space-y-2.5">
                {dayMatches.map(m => <MatchCard key={m.id} match={m} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
