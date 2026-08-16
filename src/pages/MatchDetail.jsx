import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useTeam, phaseTag, formatDate } from '../components/MatchCard'
import { Skeleton } from '../components/shared'
import { deriveClock } from '../engine/clock'
import { derivePrediction, gradePrediction, resultDisplay } from '../engine/prediction'
import { ArrowLeft } from 'lucide-react'
import { EventIcon } from '../components/eventIcons'

function EventRow({ ev, homeCode, homeFlag, awayFlag }) {
  const isHome = ev.team === homeCode
  return (
    <div className={`flex items-center gap-2.5 ${isHome ? 'flex-row' : 'flex-row-reverse text-right'}`}>
      <span className="flex h-9 w-8 shrink-0 items-center justify-center rounded-md bg-pitch-950/60 font-mono text-[11px] font-bold text-brand">
        {ev.minute}'
      </span>
      <EventIcon ev={ev} />
      <div className={isHome ? '' : 'text-right'}>
        <div className="text-sm font-medium">
          {ev.player}
          {ev.type === 'goal' && <span className="ml-1.5 rounded bg-pitch-700 px-1 py-0.5 font-mono text-[9px] font-bold text-pitch-300">{ev.via}</span>}
        </div>
        {ev.assist && <div className="font-mono text-[10px] text-pitch-400">assist: {ev.assist}</div>}
      </div>
      {ev.type === 'goal' && ev._score && (
        <span className={`rounded-md bg-pitch-950/60 px-1.5 py-1 font-mono text-[10px] font-bold text-pitch-300 ${isHome ? 'ml-auto' : 'mr-auto'}`}>
          {homeFlag} {ev._score.h}–{ev._score.a} {awayFlag}
        </span>
      )}
    </div>
  )
}

function StatBar({ label, home, away, asPercent }) {
  if (home == null || away == null) return null
  const total = asPercent ? 100 : (home + away) || 1
  return (
    <div className="mb-2.5">
      <div className="mb-1 grid grid-cols-[2.5rem_1fr_2.5rem] items-baseline gap-2 font-mono text-xs">
        <span className="font-bold text-brand">{home}{asPercent && '%'}</span>
        <span className="text-center text-[10px] uppercase tracking-wider text-pitch-400">{label}</span>
        <span className="text-right font-bold text-sky-400">{away}{asPercent && '%'}</span>
      </div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full">
        <div className="rounded-l-full bg-brand" style={{ width: `${(home / total) * 100}%` }} />
        <div className="flex-1 rounded-r-full bg-sky-400/70" />
      </div>
    </div>
  )
}

function MatchStatsPanel({ match, live }) {
  const s = match.stats
  if (!s?.home || !s?.away) {
    return (
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-1 font-display text-sm font-semibold">Match stats</h3>
        <p className="text-xs text-pitch-400">Stats land with the next data update after full-time.</p>
      </div>
    )
  }
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
        Match stats
        <span className="font-mono text-[10px] font-normal text-pitch-400">
          {live ? 'Live · refreshes 60s' : 'Final'}{match.enrichment === 'estimated' && ' · est.'}
        </span>
      </h3>
      <StatBar label="Possession" home={s.home.possession} away={s.away.possession} asPercent />
      <StatBar label="Shots" home={s.home.shots} away={s.away.shots} />
      <StatBar label="Circle entries" home={s.home.circle_entries} away={s.away.circle_entries} />
      <StatBar label="Penalty corners" home={s.home.penalty_corners} away={s.away.penalty_corners} />
      <div className="mt-3 flex justify-between border-t border-white/5 pt-2.5 font-mono text-[11px] text-pitch-300">
        <span>🟩 {s.home.green_cards} · 🟨 {s.home.yellow_cards} · 🟥 {s.home.red_cards}</span>
        <span className="text-[10px] uppercase tracking-wider text-pitch-400">Cards</span>
        <span>🟩 {s.away.green_cards} · 🟨 {s.away.yellow_cards} · 🟥 {s.away.red_cards}</span>
      </div>
    </div>
  )
}

function CommentaryFeed({ match, home, away }) {
  const [showAll, setShowAll] = useState(false)
  const beats = [...(match.commentary ?? [])].sort((x, y) => y.minute - x.minute || y.seq - x.seq)
  if (!beats.length) return null
  const visible = showAll ? beats : beats.slice(0, 10)
  const colorOf = code => code === match.home ? home?.color : code === match.away ? away?.color : null
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
        Running commentary
        <span className="font-mono text-[10px] font-normal text-pitch-400">
          {match.status === 'live' ? 'Live · running' : 'Full match'} · {beats.length} beats
        </span>
      </h3>
      <div className="space-y-2">
        {visible.map((b, i) => (
          <div key={`${b.seq}-${i}`} className="flex items-start gap-2.5">
            <span className="mt-0.5 w-8 shrink-0 rounded bg-pitch-950/60 py-0.5 text-center font-mono text-[10px] font-bold text-pitch-300">
              {b.minute}'
            </span>
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: colorOf(b.team) ?? 'var(--color-pitch-600)' }} />
            <p className="text-xs leading-relaxed text-pitch-300">{b.text}</p>
          </div>
        ))}
      </div>
      {beats.length > 10 && (
        <button onClick={() => setShowAll(!showAll)} className="mt-2.5 font-mono text-[11px] text-brand hover:underline">
          {showAll ? 'Show less' : `Show all ${beats.length} beats`}
        </button>
      )}
    </div>
  )
}

function quarterOf(minute) {
  if (minute > 45) return 'Q4'
  if (minute > 30) return 'Q3'
  if (minute > 15) return 'Q2'
  return 'Q1'
}

function AlsoLiveStrip({ currentId }) {
  const live = useLiveQuery(
    () => db.matches.where('status').equals('live').toArray(), [], [])
  const others = live.filter(m => m.id !== currentId)
  if (!others.length) return null
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto">
      {others.map(m => (
        <Link key={m.id} to={`/matches/${m.id}`}
          className="flex shrink-0 items-center gap-2 rounded-lg border border-live/30 bg-pitch-800 px-3 py-1.5 font-mono text-xs">
          <span className="live-dot" />
          <span className="font-bold">{m.home} {m.score?.home ?? 0}–{m.score?.away ?? 0} {m.away}</span>
        </Link>
      ))}
    </div>
  )
}

function tournamentForm(matches, code) {
  return matches
    .filter(m => m.status === 'completed' && m.score?.home != null && (m.home === code || m.away === code))
    .map(m => {
      const gf = m.home === code ? m.score.home : m.score.away
      const ga = m.home === code ? m.score.away : m.score.home
      const opp = m.home === code ? m.away : m.home
      return { id: m.id, result: gf > ga ? 'W' : gf < ga ? 'L' : 'D', gf, ga, opp, home: m.home === code }
    })
}

function FormRow({ name, form }) {
  return (
    <div>
      <div className="text-xs font-semibold">{name}</div>
      <div className="mt-1 font-mono text-[10px] text-pitch-400">
        {form.length
          ? `${form.filter(f => f.result === 'W').length}W ${form.filter(f => f.result === 'D').length}D ${form.filter(f => f.result === 'L').length}L this tournament`
          : 'No completed matches yet'}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {[...form].reverse().map(f => (
          <span key={f.id} title={`${f.home ? 'vs' : '@'} ${f.opp} ${f.gf}-${f.ga}`}
            className={`flex h-5 w-5 items-center justify-center rounded font-mono text-[10px] font-bold ${
              f.result === 'W' ? 'bg-live/15 text-live' : f.result === 'L' ? 'bg-red-400/15 text-red-400' : 'bg-pitch-700 text-pitch-300'
            }`}>
            {f.result}
          </span>
        ))}
      </div>
    </div>
  )
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
  const allMatches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [], [])
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

  // Progressive scoreboard: annotate each goal with the score at that moment
  let _h = 0, _a = 0
  const annotated = (events ?? []).map(ev => {
    if (ev.type !== 'goal') return ev
    if (ev.team === match.home) _h++
    else _a++
    return { ...ev, _score: { h: _h, a: _a } }
  })
  const byQuarter = { Q1: [], Q2: [], Q3: [], Q4: [] }
  for (const ev of annotated) byQuarter[quarterOf(ev.minute)]?.push(ev)

  const homeForm = tournamentForm(allMatches, match.home).filter(f => f.id !== match.id)
  const awayForm = tournamentForm(allMatches, match.away).filter(f => f.id !== match.id)
  const h2h = allMatches.filter(m =>
    m.id !== match.id && m.status === 'completed' && m.score?.home != null &&
    ((m.home === match.home && m.away === match.away) || (m.home === match.away && m.away === match.home)))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <Link to="/matches" className="inline-flex items-center gap-1.5 text-xs font-medium text-pitch-300 hover:text-brand">
          <ArrowLeft size={14} /> All matches
        </Link>
        <Link to={`/ai-lab?match=${match.id}`} className="text-xs font-medium text-brand hover:underline">
          🧠 AI Lab breakdown →
        </Link>
      </div>

      <AlsoLiveStrip currentId={match.id} />

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

      {/* Tournament form */}
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
          Recent form <span className="font-mono text-[10px] font-normal text-pitch-400">this tournament</span>
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <FormRow name={home?.name ?? match.home} form={homeForm} />
          <FormRow name={away?.name ?? match.away} form={awayForm} />
        </div>
      </div>

      {/* Head to head */}
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h3 className="mb-2 flex items-baseline justify-between font-display text-sm font-semibold">
          Head to head <span className="font-mono text-[10px] font-normal text-pitch-400">in tournament</span>
        </h3>
        {h2h.length ? (
          <div className="space-y-1.5">
            {h2h.map(m => (
              <Link key={m.id} to={`/matches/${m.id}`}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-pitch-950/40 px-3 py-2 font-mono text-xs transition-colors hover:border-brand/20">
                <span className="font-bold">{m.home} {m.score.home} – {m.score.away} {m.away}</span>
                <span className="text-[10px] text-pitch-400">{phaseTag(m)} · {formatDate(m.date)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-pitch-400">No prior meeting in this tournament yet.</p>
        )}
      </div>

      {/* Quarter timeline */}
      {(done || live) && (events?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
          <h3 className="mb-3 flex items-baseline justify-between font-display text-sm font-semibold">
            Match Timeline
            <span className="font-mono text-[10px] font-normal text-pitch-400">
              scorers + minutes{match.enrichment === 'estimated' && ' · est. from final score'}
            </span>
          </h3>
          <div className="space-y-4">
            {['Q1', 'Q2', 'Q3', 'Q4'].map(q => byQuarter[q].length > 0 && (
              <div key={q}>
                <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-pitch-400">
                  <span className="h-px w-4 bg-white/10" />{q}
                </div>
                <div className="space-y-2">
                  {byQuarter[q].map((ev, i) => (
                    <EventRow key={i} ev={ev} homeCode={match.home}
                      homeFlag={home?.flag} awayFlag={away?.flag} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match stats */}
      {(done || live) && <MatchStatsPanel match={match} live={live} />}

      {/* Running commentary */}
      {(done || live) && <CommentaryFeed match={match} home={home} away={away} />}

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
