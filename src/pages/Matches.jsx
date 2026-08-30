import { useMemo, useState } from 'react'
import { useSwipeTabs } from '../components/useSwipeTabs'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import MatchCard, { formatDate } from '../components/MatchCard'
import { Skeleton } from '../components/shared'
import { oracleRecord, publishedAccuracy } from '../engine/prediction'
import StageSplit from '../components/StageSplit'
import { effectiveStatus } from '../engine/clock'
import { useOracleBundle } from '../engine/oracleBundle'
import { useNowTick } from '../hooks/useNowTick'
import { SIM_MATCH } from '../content/sim'
import { exhibitions } from '../engine/sim'

// The card only appears once the engine can actually pick both elevens: a
// link promising a simulated scoreline that resolves to "not yet" is worse
// than no link. The score shown is the one the sim page shows, from the same
// call, so the two can never disagree.
function SimulationCard({ fixtures }) {
  if (!fixtures?.length) return null
  return (
    <div id="sims" className="mb-4 scroll-mt-20">
      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-pitch-400">
        ✨ AI Simulations
      </div>
      <div className="space-y-2">
        {fixtures.map(f => (
          <Link key={f.id} to={`/match/sim/${f.id}`}
            className={`flex items-center gap-3 rounded-xl border p-3.5 transition-colors ${
              f.champion
                ? 'border-brand/40 bg-gradient-to-r from-brand/15 to-pitch-800 hover:border-brand/60'
                : 'border-white/5 bg-pitch-800 hover:border-brand/25'
            }`}>
            <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-widest ${
              f.champion ? 'border-brand/40 bg-brand/15 text-brand' : 'border-white/10 bg-pitch-700 text-pitch-300'
            }`}>
              {f.champion ? '🏆 Champions' : SIM_MATCH.statusChip}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {f.homeLabel} <span className="font-mono text-xs text-pitch-400">vs</span> {f.awayLabel}
            </span>
            <span className="shrink-0 font-mono text-sm font-bold text-brand">
              {f.sim.score.home}–{f.sim.score.away}
            </span>
          </Link>
        ))}
      </div>
      {/* A man turns out for his country, never against it — so each of these
          is played against a World XI picked without that nation in it, and
          they are five different World XIs rather than one sent out five
          times. Said once here rather than on every card. */}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-pitch-400">
        Exhibitions, not fixtures. Each nation meets a World XI picked without its own players.
      </p>
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
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  // The bracket is the app's one answer for a fixture whose nations are not
  // settled yet, so the medal matches read the same here as on the Cup and
  // Oracle tabs instead of showing "TBD" on one screen and a projection on
  // another.
  const bundle = useOracleBundle(teams, matches ?? [])
  const slotOf = id => bundle?.bracket?.byId?.get(id) ?? null

  const loading = matches === undefined
  const all = matches ?? []

  // The Oracle's accuracy rides the subtitle — one line, no extra strip, and
  // the SAME figure the Home hero prints. publishedAccuracy owns that choice
  // for every screen; reading a calibration field directly here is what put
  // 68% on this page while the hero said 78%.
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  const calibration = useLiveQuery(() => db.meta.get('calibration'), [])
  const rec = publishedAccuracy(calibration, oracleRecord(all, predictions))

  // Every exhibition, from the same engine the sim page uses, so a card and
  // the page it opens cannot print two scorelines.
  const players = useLiveQuery(() => db.players.toArray(), [], [])
  const sims = useMemo(() => exhibitions(players, matches ?? [], teams),
                       [players, matches, teams])

  // Membership follows the clock, not the stored status: a match past
  // push-back sits under Live (with its running clock and 0-0) the moment it
  // starts, even before the data cron flips it. The tick keeps that boundary
  // moving while the page is open.
  const nowTick = useNowTick()
  const effOf = m => effectiveStatus(m, nowTick)
  const counts = {
    results: all.filter(m => effOf(m) === 'completed').length,
    live: all.filter(m => effOf(m) === 'live').length,
    upcoming: all.filter(m => effOf(m) === 'scheduled').length,
  }

  const activeStatus = (STATUS_TABS.find(t => t.id === tab) ?? STATUS_TABS[0]).status
  const inStatus = all.filter(m => effOf(m) === activeStatus)

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
    byDate[date].every(m => effOf(m) === 'scheduled' && (m.kickoffUtc ?? 0) > now)
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
          {rec.graded > 0 && <span className="text-brand"> · 🎯 {rec.correct}/{rec.graded} correct · {rec.pct}%</span>}
          {rec.graded > 0 && rec.stages && (
            <> · <StageSplit stages={rec.stages} variant="inline" className="text-pitch-400" /></>
          )}
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

      {/* Results is where a reader lands once the tournament is over, and
          these exhibitions are the part of it that is still worth reading.
          They used to hang off the Live tab alone, which empties the moment
          the last match ends — published where nobody would find them. */}
      {(tab === 'results' || tab === 'live') && <SimulationCard fixtures={sims} />}

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
                {byDate[date].map(m => <MatchCard key={m.id} match={m} projection={slotOf(m.id)} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
