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

// The competition has three acts, and that is the only cut the fixture list
// needs — Stage 1 pools A–D, the Stage 2 crossover pools E–H, then the matches
// that decide a placing. Pool-by-pool chips belonged to a one-stage format;
// they split 24 fixtures six ways and had nothing to say about the other 26.
const KNOCKOUT_PHASES = new Set(['classification', 'semi-final', 'bronze-final', 'gold-final'])
const STAGE_TABS = [
  { id: 'stage1', label: 'Stage 1', match: m => m.phase === 'pool' },
  { id: 'stage2', label: 'Stage 2', match: m => m.phase === 'stage2' },
  { id: 'knockouts', label: 'Knockouts', match: m => KNOCKOUT_PHASES.has(m.phase) },
]
const DEFAULT_TAB = 'results'

/** Which act a fixture belongs to, or null if a new phase ever slips through. */
const stageOf = m => STAGE_TABS.find(s => s.match(m))?.id ?? null

export default function MatchesPage() {
  const [params, setParams] = useSearchParams()
  const initialTab = STATUS_TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : DEFAULT_TAB
  const [tab, setTab] = useState(initialTab)
  // null = follow the tab. An explicit chip pins a stage until the reader
  // changes status tab, at which point we go back to following.
  const [stage, setStage] = useState(
    STAGE_TABS.some(s => s.id === params.get('stage')) ? params.get('stage') : null)
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])

  const loading = matches === undefined
  const all = matches ?? []

  const counts = {
    results: all.filter(m => m.status === 'completed').length,
    live: all.filter(m => m.status === 'live').length,
    upcoming: all.filter(m => m.status === 'scheduled').length,
  }

  const activeStatus = (STATUS_TABS.find(t => t.id === tab) ?? STATUS_TABS[0]).status
  const inStatus = all.filter(m => m.status === activeStatus)

  // With no "All" chip a stage is always selected, so the one we select for the
  // reader has to be the one they came to see: the act the tab's first-listed
  // match belongs to. Results and Live read newest-first, so that is the latest
  // act with a result; Upcoming reads soonest-first, so it is the next act to
  // be played. Falls back to Stage 1 only when the tab is empty.
  const lead = inStatus.reduce((best, m) => {
    if (!best) return m
    const ka = m.kickoffUtc ?? 0, kb = best.kickoffUtc ?? 0
    return activeStatus === 'scheduled' ? (ka < kb ? m : best) : (ka > kb ? m : best)
  }, null)
  const activeStage = stage ?? (lead ? stageOf(lead) : null) ?? STAGE_TABS[0].id
  const stageMatch = (STAGE_TABS.find(s => s.id === activeStage) ?? STAGE_TABS[0]).match
  const filtered = inStatus.filter(stageMatch)

  useSwipeTabs({
    count: STATUS_TABS.length,
    index: Math.max(0, STATUS_TABS.findIndex(t => (t.id ?? t) === tab)),
    onChange: i => selectTab(STATUS_TABS[i].id),
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

  const writeParams = mutate => {
    const next = new URLSearchParams(params)
    mutate(next)
    setParams(next, { replace: true })
  }

  // Changing act is explicit and sticky; changing status starts following
  // again, so Upcoming never opens on an act that has already been played.
  const selectStage = id => {
    setStage(id)
    writeParams(next => next.set('stage', id))
  }
  const selectTab = id => {
    setTab(id)
    setStage(null)
    writeParams(next => { next.set('tab', id); next.delete('stage') })
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
          <button key={t.id} onClick={() => selectTab(t.id)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {t.label} <span className="ml-1 font-mono text-[10px] opacity-70">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {STAGE_TABS.map(s => (
          <button key={s.id} onClick={() => selectStage(s.id)}
            className={`rounded-md border px-3 py-1 font-mono text-xs font-semibold transition-colors ${
              activeStage === s.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {s.label} <span className="ml-1 text-[10px] opacity-70">{inStatus.filter(s.match).length}</span>
          </button>
        ))}
      </div>

      {tab === 'results' && !loading && <OracleRecordStrip matches={all} />}
      {tab === 'live' && <SimulationCard />}

      {loading ? <Skeleton h={400} /> : (
        <div className="space-y-2.5">
          {Object.keys(byDate).length === 0 && (
            <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
              No {(STATUS_TABS.find(t => t.id === tab) ?? STATUS_TABS[0]).label.replace('🔴 ', '').toLowerCase()} matches in this stage.
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
