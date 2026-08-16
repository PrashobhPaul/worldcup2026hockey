import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { computeStandings } from '../engine/standings'
import { StandingsTable, Skeleton, WinProbBar } from '../components/shared'
import { formatDate } from '../components/MatchCard'

const VIEWS = [
  { id: 'standings', label: 'Pool Standings' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'probability', label: 'Win Probability' },
]

const KO_PHASES = [
  ['quarter-final', 'Quarter-Finals'],
  ['semi-final', 'Semi-Finals'],
  ['bronze-final', 'Bronze Medal Match'],
  ['gold-final', '🥇 Gold Medal Final'],
]

export default function TournamentPage() {
  const [view, setView] = useState('standings')
  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])

  const loading = teams === undefined || matches === undefined
  const standings = computeStandings(teams ?? [], matches ?? [])
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))
  const knockouts = (matches ?? []).filter(m => m.phase !== 'pool')
  const sorted = [...(teams ?? [])].sort((a, b) => b.winProb - a.winProb)

  return (
    <div>
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">📊 Tournament</h1>
        <p className="mt-1 text-xs text-pitch-400">Standings computed live from completed matches</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {VIEWS.map(v => (
          <button key={v.id} onClick={() => setView(v.id)}
            className={`rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              view === v.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {v.label}
          </button>
        ))}
      </div>

      {loading ? <Skeleton h={500} /> : (
        <>
          {view === 'standings' && (
            <div className="space-y-5">
              {standings.map(pool => {
                const poolMatches = (matches ?? []).filter(m => m.pool === pool.id && m.phase === 'pool')
                const played = poolMatches.filter(m => m.status === 'completed').length
                return (
                  <div key={pool.id} className="rounded-xl border border-white/5 bg-pitch-800 p-4">
                    <div className="mb-3 flex items-baseline justify-between">
                      <h2 className="font-display text-base font-semibold">Pool {pool.id}</h2>
                      <span className="font-mono text-[10px] text-pitch-400">{played}/{poolMatches.length} played</span>
                    </div>
                    <StandingsTable standings={pool.standings} />
                  </div>
                )
              })}
            </div>
          )}

          {view === 'bracket' && (
            <div className="space-y-6">
              {KO_PHASES.map(([phase, label]) => {
                const phaseMatches = knockouts.filter(m => m.phase === phase)
                if (!phaseMatches.length) return null
                return (
                  <div key={phase}>
                    <h2 className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">{label}</h2>
                    <div className="space-y-2">
                      {phaseMatches.map(m => {
                        const h = byCode.get(m.home), a = byCode.get(m.away)
                        const isTBD = m.home === 'TBD'
                        return (
                          <div key={m.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-white/5 bg-pitch-800 px-3.5 py-2.5 text-sm">
                            <span className="font-medium">{isTBD ? '❓ TBD' : `${h?.flag} ${h?.name}`}</span>
                            <span className="font-mono text-xs text-pitch-400">vs</span>
                            <span className="font-medium">{isTBD ? 'TBD' : `${a?.flag} ${a?.name}`}</span>
                            <span className="ml-auto font-mono text-[10px] text-pitch-400">
                              {m.label} · {formatDate(m.date)} · {m.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <p className="font-mono text-[11px] text-pitch-400">Bracket slots fill automatically as pools complete (Aug 20).</p>
            </div>
          )}

          {view === 'probability' && (
            <div className="space-y-2">
              <p className="mb-3 text-xs text-pitch-400">All 16 teams ranked by AI tournament win probability. Recalibrated after every completed match.</p>
              {sorted.map(t => <WinProbBar key={t.code} team={t} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
