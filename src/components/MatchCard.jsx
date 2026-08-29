import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { deriveClock, isLiveClock } from '../engine/clock'
import { useClockTick } from '../hooks/useClockTick'
import { derivePrediction, gradePrediction, resultDisplay } from '../engine/prediction'

export function useTeam(code) {
  return useLiveQuery(() => code ? db.teams.get(code) : undefined, [code])
}

export function phaseTag(match) {
  const map = {
    'pool': `Pool ${match.pool}`,
    'stage2': `Stage 2 · Pool ${match.pool}`,
    'classification': match.label || 'Classification',
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

function StatusBadge({ match, clock, live, waiting }) {
  if (live) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-live/30 bg-live/10 px-2 py-0.5 font-mono text-[11px] font-bold text-live">
        <span className="live-dot" /> {clock.display}
      </span>
    )
  }
  if (waiting) {
    return <span className="rounded bg-pitch-700 px-2 py-0.5 font-mono text-[11px] font-bold text-pitch-300">FT · score soon</span>
  }
  if (match.status === 'completed') {
    return <span className="rounded bg-pitch-700 px-2 py-0.5 font-mono text-[11px] font-bold text-pitch-300">{clock.display}</span>
  }
  return <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-[11px] font-bold text-brand">{match.time} CET</span>
}

function PredictionChip({ match }) {
  const row = useLiveQuery(
    () => db.predictions.where('matchId').equals(match.id).toArray()
      .then(rows => rows.find(p => !p.superseded) ?? null),
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

function ScorerLine({ match }) {
  const goals = useLiveQuery(
    () => db.match_events.where('matchId').equals(match.id).toArray()
      .then(evs => evs.filter(e => e.type === 'goal').sort((x, y) => x.minute - y.minute)),
    [match.id], [],
  )
  if (!goals.length) return null
  const line = goals
    .map(g => `${g.player?.split(' ').slice(-1)[0] ?? '?'} ${g.minute}'${g.via === 'PC' ? ' (PC)' : g.via === 'PS' ? ' (PS)' : ''}`)
    .join(', ')
  return (
    <p className="mt-2 line-clamp-1 font-mono text-[10px] leading-snug text-pitch-400">🏑 {line}</p>
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

// A fixture whose two nations are not yet decided still has an answer the app
// is willing to stand behind: the bracket projects it. `projection` carries
// that — {home, away} from the same bracket every other surface reads — and
// the card shows those nations in square brackets so a prediction can never be
// mistaken for a confirmed line-up. Without one the card falls back to the
// slot label ("Winner SF1"), which is all the schedule itself knows.
export default function MatchCard({ match, compact = false, projection = null }) {
  const home = useTeam(match.home)
  const away = useTeam(match.away)
  const projHome = useTeam(projection?.home)
  const projAway = useTeam(projection?.away)
  useClockTick(match)
  const clock = deriveClock(match)
  const isTBD = match.home === 'TBD' || match.away === 'TBD'
  const slot = side => (match.slotLabel ?? match.label)?.split(' vs ')[side === 'home' ? 0 : 1]?.trim() || 'TBD'
  const projected = isTBD && projection?.home && projection?.away
  const sideCode = side => {
    if (!isTBD) return side === 'home' ? match.home : match.away
    if (projected) return `[${side === 'home' ? projection.home : projection.away}]`
    return slot(side)
  }
  const done = match.status === 'completed'
  // The clock, not the stored status, decides what the card shows: a match
  // past push-back is live even if the data cron hasn't flipped it yet, and a
  // match past its window is over ("FT · score soon"), never stuck on Q1.
  const waiting = !done && clock.kind === 'FT_WAIT'
  const live = !done && !waiting && isLiveClock(clock)
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
        <StatusBadge match={match} clock={clock} live={live} waiting={waiting} />
        <span className="font-mono text-[10px] text-pitch-400">
          {formatDate(match.date)} · {match.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamSide team={projected ? projHome : home} code={sideCode('home')}
          align="left" isWinner={winner === 'H'} />
        <div className="flex min-w-[72px] flex-col items-center">
          {done || live || waiting ? (
            <div className="font-mono text-2xl font-bold tracking-wider">
              {/* In play, the card shows the last value the feed confirmed —
                  0-0 from push-back until the first update lands. A tie broken
                  in a shoot-out carries the shoot-out inline: 3 (3) – (4) 3,
                  regulation first, because the 3-3 is the hockey and the
                  bracketed pair is how the tie was settled. */}
              <span className={live ? 'text-live' : winner === 'H' ? 'text-white' : 'text-pitch-300'}>{match.score?.home ?? 0}</span>
              {res?.homeSO != null && <span className="ml-1 text-sm font-semibold text-brand">({res.homeSO})</span>}
              <span className="mx-1 text-pitch-400">–</span>
              {res?.awaySO != null && <span className="mr-1 text-sm font-semibold text-brand">({res.awaySO})</span>}
              <span className={live ? 'text-live' : winner === 'A' ? 'text-white' : 'text-pitch-300'}>{match.score?.away ?? 0}</span>
            </div>
          ) : (
            <div className="font-mono text-sm text-pitch-300">{match.time}</div>
          )}
          {res?.decisiveLine && (
            <div className="mt-0.5 text-center font-mono text-[10px] text-brand">{res.decisiveLine}</div>
          )}
        </div>
        <TeamSide team={projected ? projAway : away} code={sideCode('away')}
          align="right" isWinner={winner === 'A'} />
      </div>

      {projected && (
        <div className="mt-2 text-center font-mono text-[10px] text-pitch-400">
          projected from the bracket · {slot('home')} vs {slot('away')}
        </div>
      )}

      {!compact && (done || live) && <ScorerLine match={match} />}

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
