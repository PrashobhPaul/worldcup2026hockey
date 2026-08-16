import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { deriveClock } from '../engine/clock'
import { derivePrediction, gradePrediction, resultDisplay } from '../engine/prediction'

export function useTeam(code) {
  return useLiveQuery(() => code ? db.teams.get(code) : undefined, [code])
}

export function phaseTag(match) {
  const map = {
    'pool': `Pool ${match.pool}`,
    'quarter-final': 'Quarter-Final',
    'semi-final': 'Semi-Final',
    'bronze-final': 'Bronze Medal',
    'gold-final': 'Gold Final',
  }
  return map[match.phase] || match.phase
}

export function formatDate(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  })
}

function StatusBadge({ match, clock }) {
  if (match.status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-live/30 bg-live/10 px-2 py-0.5 font-mono text-[11px] font-bold text-live">
        <span className="live-dot" /> {clock.display}
      </span>
    )
  }
  if (match.status === 'completed') {
    return <span className="rounded bg-pitch-700 px-2 py-0.5 font-mono text-[11px] font-bold text-pitch-300">{clock.display}</span>
  }
  return <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-[11px] font-bold text-brand">{match.time} CET</span>
}

function PredictionChip({ match }) {
  const row = useLiveQuery(
    () => db.predictions.where('matchId').equals(match.id).first(),
    [match.id],
  )
  if (!row) return null
  const d = derivePrediction({ match, row })
  if (d.status !== 'ready') return null

  const pickTeam = d.pick === 'HOME' ? match.home : d.pick === 'AWAY' ? match.away : 'Draw'
  const grade = gradePrediction(match, row)
  const gradeStyle =
    grade === 'correct' ? 'border-live/30 bg-live/10 text-live' :
    grade === 'wrong' ? 'border-red-400/30 bg-red-400/10 text-red-400' :
    'border-brand/20 bg-brand/5 text-brand'

  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-bold ${gradeStyle}`}>
      🎯 {pickTeam} · {d.pickConfidencePct}%
      {grade === 'correct' && ' ✓'}
      {grade === 'wrong' && ' ✗'}
    </span>
  )
}

function TeamSide({ team, code, align, isWinner }) {
  return (
    <div className={`flex flex-col gap-0.5 ${align === 'right' ? 'items-end text-right' : 'items-start text-left'}`}>
      <span className="text-3xl leading-none">{team?.flag ?? '🏑'}</span>
      <span className={`text-sm font-semibold ${isWinner ? 'text-white' : 'text-pitch-300'}`}>
        {team?.name ?? code}
      </span>
      {team?.fihRank && <span className="font-mono text-[10px] text-pitch-400">FIH #{team.fihRank}</span>}
    </div>
  )
}

export default function MatchCard({ match, compact = false }) {
  const home = useTeam(match.home)
  const away = useTeam(match.away)
  const clock = deriveClock(match)
  const isTBD = match.home === 'TBD' || match.away === 'TBD'
  const done = match.status === 'completed'
  const live = match.status === 'live'
  const res = done ? resultDisplay(match, home, away) : null
  const winner = done && res ? (res.homeReg > res.awayReg ? 'H' : res.awayReg > res.homeReg ? 'A' : (res.homeSO != null ? (res.homeSO > res.awaySO ? 'H' : 'A') : 'D')) : null

  const pc = match.penalty_corners

  return (
    <Link to={isTBD ? '#' : `/matches/${match.id}`}
      className={`block rounded-xl border p-4 transition-colors ${
        live ? 'border-live/40 bg-pitch-800 shadow-[0_0_24px_rgba(34,197,94,0.08)]'
             : 'border-white/5 bg-pitch-800 hover:border-brand/20'
      }`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="rounded bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
          {phaseTag(match)}
        </span>
        <StatusBadge match={match} clock={clock} />
        <span className="font-mono text-[10px] text-pitch-400">
          {formatDate(match.date)} · {match.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamSide team={home} code={isTBD ? (match.label?.split('vs')[0]?.trim() || 'TBD') : match.home}
          align="left" isWinner={winner === 'H'} />
        <div className="flex min-w-[72px] flex-col items-center">
          {done || live ? (
            <div className="font-mono text-2xl font-bold tracking-wider">
              <span className={live ? 'text-live' : winner === 'H' ? 'text-white' : 'text-pitch-300'}>{match.score?.home ?? 0}</span>
              <span className="mx-1 text-pitch-400">–</span>
              <span className={live ? 'text-live' : winner === 'A' ? 'text-white' : 'text-pitch-300'}>{match.score?.away ?? 0}</span>
            </div>
          ) : (
            <div className="font-mono text-sm text-pitch-300">{match.time}</div>
          )}
          {res?.decisiveLine && (
            <div className="mt-0.5 text-center font-mono text-[10px] text-brand">{res.decisiveLine}</div>
          )}
        </div>
        <TeamSide team={away} code={isTBD ? (match.label?.split('vs')[1]?.trim() || 'TBD') : match.away}
          align="right" isWinner={winner === 'A'} />
      </div>

      {!compact && (
        <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2.5">
          {(done || live) && pc?.home != null ? (
            <span className="font-mono text-[10px] text-pitch-400">
              PC {pc.home} <span className="text-pitch-600">|</span> {pc.away}
            </span>
          ) : <span />}
          {!isTBD && <PredictionChip match={match} />}
        </div>
      )}
    </Link>
  )
}
