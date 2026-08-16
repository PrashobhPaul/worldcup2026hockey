import { useParams, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useTeam, phaseTag, formatDate } from '../components/MatchCard'
import { Skeleton } from '../components/shared'
import { deriveClock } from '../engine/clock'
import { derivePrediction, gradePrediction, resultDisplay } from '../engine/prediction'
import { ArrowLeft } from 'lucide-react'

function EventRow({ ev, homeCode }) {
  const isHome = ev.team === homeCode
  const icon = ev.type === 'goal' ? (ev.via === 'PC' ? '🔴' : ev.via === 'PS' ? '🎯' : '🏑')
    : ev.type === 'green_card' ? '🟩' : ev.type === 'yellow_card' ? '🟨' : ev.type === 'red_card' ? '🟥' : '•'
  return (
    <div className={`flex items-center gap-2 ${isHome ? 'flex-row' : 'flex-row-reverse text-right'}`}>
      <span className="font-mono text-[11px] font-bold text-brand">{ev.minute}'</span>
      <span>{icon}</span>
      <span className="text-sm font-medium">{ev.player}</span>
      {ev.type === 'goal' && <span className="font-mono text-[10px] text-pitch-400">{ev.via}</span>}
    </div>
  )
}

function quarterOf(minute) {
  if (minute > 45) return 'Q4'
  if (minute > 30) return 'Q3'
  if (minute > 15) return 'Q2'
  return 'Q1'
}

export default function MatchDetailPage() {
  const { matchId } = useParams()
  const match = useLiveQuery(() => db.matches.get(matchId), [matchId])
  const events = useLiveQuery(
    () => db.match_events.where('matchId').equals(matchId).sortBy('seq'),
    [matchId], [],
  )
  const prediction = useLiveQuery(
    () => db.predictions.where('matchId').equals(matchId).first(),
    [matchId],
  )
  const story = useLiveQuery(() => db.ai_stories.get(matchId), [matchId])
  const home = useTeam(match?.home)
  const away = useTeam(match?.away)

  if (match === undefined) return <Skeleton h={400} />
  if (!match) return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
      Match not found. <Link to="/matches" className="text-brand">← All matches</Link>
    </div>
  )

  const clock = deriveClock(match)
  const live = match.status === 'live'
  const done = match.status === 'completed'
  const res = done ? resultDisplay(match, home, away) : null
  const pred = prediction ? derivePrediction({ match, row: prediction }) : null
  const grade = prediction ? gradePrediction(match, prediction) : null
  const pc = match.penalty_corners

  const byQuarter = { Q1: [], Q2: [], Q3: [], Q4: [] }
  for (const ev of events ?? []) byQuarter[quarterOf(ev.minute)]?.push(ev)

  return (
    <div className="space-y-5">
      <Link to="/matches" className="inline-flex items-center gap-1.5 text-xs font-medium text-pitch-300 hover:text-brand">
        <ArrowLeft size={14} /> All matches
      </Link>

      {/* Score header */}
      <div className={`rounded-2xl border p-6 ${live ? 'border-live/40' : 'border-white/5'} bg-gradient-to-br from-pitch-800 to-pitch-900`}>
        <div className="mb-4 flex items-center justify-center gap-2 text-center">
          <span className="rounded bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">{phaseTag(match)}</span>
          <span className="font-mono text-[10px] text-pitch-400">
            {formatDate(match.date)} · {match.time} CET · {match.venue === 'AMV' ? 'Wagener Stadion, Amstelveen' : 'Royal Leopold Club, Brussels'}
          </span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Link to={`/teams/${match.home}`} className="flex flex-col items-center gap-1 text-center">
            <span className="text-5xl">{home?.flag ?? '🏑'}</span>
            <span className="text-sm font-bold">{home?.name ?? match.home}</span>
            <span className="font-mono text-[10px] text-pitch-400">FIH #{home?.fihRank ?? '—'}</span>
          </Link>
          <div className="flex flex-col items-center">
            {(done || live) ? (
              <>
                <div className={`font-mono text-4xl font-bold tracking-widest ${live ? 'text-live' : ''}`}>
                  {match.score?.home ?? 0}–{match.score?.away ?? 0}
                </div>
                <span className={`mt-1 rounded px-2 py-0.5 font-mono text-[11px] font-bold ${
                  live ? 'border border-live/30 bg-live/10 text-live' : 'bg-pitch-700 text-pitch-300'
                }`}>
                  {live && <span className="live-dot mr-1.5 inline-block" />}{clock.display}
                </span>
                {res?.decisiveLine && <span className="mt-1 font-mono text-[11px] text-brand">{res.decisiveLine}</span>}
              </>
            ) : (
              <div className="font-mono text-xl text-pitch-300">{match.time}</div>
            )}
          </div>
          <Link to={`/teams/${match.away}`} className="flex flex-col items-center gap-1 text-center">
            <span className="text-5xl">{away?.flag ?? '🏑'}</span>
            <span className="text-sm font-bold">{away?.name ?? match.away}</span>
            <span className="font-mono text-[10px] text-pitch-400">FIH #{away?.fihRank ?? '—'}</span>
          </Link>
        </div>
        {(done || live) && pc?.home != null && (
          <div className="mt-4 flex justify-center gap-6 border-t border-white/5 pt-3 font-mono text-xs text-pitch-300">
            <span>Penalty corners: <strong className="text-white">{pc.home}</strong> – <strong className="text-white">{pc.away}</strong></span>
          </div>
        )}
      </div>

      {/* Oracle panel */}
      {pred?.status === 'ready' && (
        <div className="rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">🎯 Oracle Pick</span>
            {grade === 'correct' && <span className="rounded bg-live/10 px-2 py-0.5 font-mono text-[10px] font-bold text-live">CORRECT ✓</span>}
            {grade === 'wrong' && <span className="rounded bg-red-400/10 px-2 py-0.5 font-mono text-[10px] font-bold text-red-400">WRONG ✗</span>}
            {grade === 'pending' && <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-[10px] font-bold text-brand">PENDING</span>}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold text-brand"
              style={{ background: `conic-gradient(var(--color-brand) ${pred.pickConfidencePct}%, var(--color-pitch-600) 0)` }}>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-pitch-800">{pred.pickConfidencePct}%</span>
            </div>
            <div className="flex-1">
              <div className="text-sm font-bold">
                {pred.pick === 'HOME' ? home?.name : pred.pick === 'AWAY' ? away?.name : 'Draw'}
                {pred.isKnockout ? ' to advance' : ' to win'}
              </div>
              {prediction.reason && <p className="mt-1 text-xs leading-relaxed text-pitch-300">{prediction.reason}</p>}
              <div className="mt-2 flex gap-3 font-mono text-[10px] text-pitch-400">
                <span>{home?.code} {Math.round(pred.reg.home * 100)}%</span>
                <span>Draw {Math.round(pred.reg.draw * 100)}%</span>
                <span>{away?.code} {Math.round(pred.reg.away * 100)}%</span>
                {pred.isKnockout && <span className="text-brand">SO path {Math.round(pred.paths.shootout * 100)}%</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quarter timeline */}
      {(done || live) && (events?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
          <h3 className="mb-3 font-display text-sm font-semibold">Match Timeline</h3>
          <div className="space-y-4">
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => byQuarter[q].length > 0 && (
              <div key={q}>
                <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-pitch-400">
                  <span className="h-px w-4 bg-white/10" />{q}
                </div>
                <div className="space-y-1.5">
                  {byQuarter[q].map((ev, i) => <EventRow key={i} ev={ev} homeCode={match.home} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI story */}
      {story && (
        <div className="rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4">
          <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-brand">🧠 AI Match Story</div>
          <p className="whitespace-pre-line text-sm leading-relaxed text-pitch-300">{story.story}</p>
          <div className="mt-3 border-t border-white/5 pt-2 font-mono text-[10px] text-pitch-400">
            Generated {new Date(story.generatedAt).toLocaleString()} · {story.model}
          </div>
        </div>
      )}
    </div>
  )
}
