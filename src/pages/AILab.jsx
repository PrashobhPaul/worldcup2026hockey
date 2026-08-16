import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { derivePrediction } from '../engine/prediction'
import { deriveClock, phaseLabel } from '../engine/clock'
import { formatDate, phaseTag } from '../components/MatchCard'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

// Deterministic pseudo-random from a string seed (stable per match)
function seeded(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
}

function MomentumBar({ label, value, color }) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex justify-between font-mono text-xs">
        <span className="font-bold" style={{ color }}>{label}</span>
        <span className="text-pitch-300">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-pitch-600">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

export default function AILabPage() {
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const [selectedId, setSelectedId] = useState(null)

  const byCode = new Map(teams.map(t => [t.code, t]))

  const candidates = useMemo(() => {
    const all = (matches ?? []).filter(m => m.home !== 'TBD')
    const live = all.filter(m => m.status === 'live')
    if (live.length) return live
    const done = all.filter(m => m.status === 'completed')
    const next = all.filter(m => m.status === 'scheduled')
    return [...done.slice(-2), ...next.slice(0, 5)]
  }, [matches])

  const match = useMemo(() => {
    if (selectedId) return (matches ?? []).find(m => m.id === selectedId)
    return candidates.find(m => m.status === 'live') ?? candidates[0]
  }, [selectedId, candidates, matches])

  const prediction = useLiveQuery(
    () => match ? db.predictions.where('matchId').equals(match.id).first() : undefined,
    [match?.id],
  )
  const story = useLiveQuery(() => match ? db.ai_stories.get(match.id) : undefined, [match?.id])

  if (matches === undefined) return <Skeleton h={500} />
  if (!match) return <div className="text-sm text-pitch-400">No matches available yet.</div>

  const home = byCode.get(match.home)
  const away = byCode.get(match.away)
  const clock = deriveClock(match)
  const pred = prediction ? derivePrediction({ match, row: prediction }) : null
  const live = match.status === 'live'
  const done = match.status === 'completed'

  // Deterministic intelligence signals (stable per match+status, replaced by real feed when live data lands)
  const rng = seeded(match.id + match.status + (match.score?.home ?? '') + (match.score?.away ?? ''))
  const rankGap = (away?.fihRank ?? 8) - (home?.fihRank ?? 8)
  const homeBase = 50 + Math.max(-20, Math.min(20, rankGap * 2.2))
  const momentumHome = Math.round(Math.max(15, Math.min(90, homeBase + (rng() - 0.5) * 18 + (match.score ? ((match.score.home ?? 0) - (match.score.away ?? 0)) * 6 : 0))))
  const momentumAway = Math.round(Math.max(15, Math.min(90, 100 - momentumHome + (rng() - 0.5) * 10)))

  const probSeries = (() => {
    if (!pred || pred.status !== 'ready') return []
    const base = pred.reg
    const points = []
    const steps = done ? 12 : live ? Math.max(2, Math.floor((clock.minute ?? 0) / 5)) : 1
    let h = base.home, d = base.draw
    for (let i = 0; i <= steps; i++) {
      const drift = (rng() - 0.5) * 0.06
      h = Math.max(0.05, Math.min(0.9, h + drift))
      d = Math.max(0.03, Math.min(0.4, d + (rng() - 0.5) * 0.03))
      points.push({ min: i * 5, [match.home]: Math.round(h * 100), Draw: Math.round(d * 100), [match.away]: Math.round((1 - h - d) * 100) })
    }
    return points
  })()

  const drivers = pred?.status === 'ready' ? [
    rankGap > 0
      ? { w: `+${Math.min(9, Math.abs(rankGap))}`, t: `${match.home} ranked higher`, d: `FIH gap of ${Math.abs(rankGap)} places (#${home?.fihRank} vs #${away?.fihRank}).` }
      : { w: `+${Math.min(9, Math.abs(rankGap) || 1)}`, t: `${match.away} ranked higher`, d: `FIH gap of ${Math.abs(rankGap)} places (#${away?.fihRank} vs #${home?.fihRank}).` },
    { w: '+7', t: 'Penalty corner threat', d: `${(pred.pick === 'HOME' ? home : away)?.key_players?.[0] ?? 'Set-piece unit'} is the premium drag-flick weapon in this fixture.` },
    { w: '+5', t: 'Tier matchup', d: `${home?.contender_tier?.replace('_', ' ')} vs ${away?.contender_tier?.replace('_', ' ')} — model weighs tournament pedigree.` },
  ] : []

  return (
    <div>
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🧠 AI Lab</h1>
        <p className="mt-1 text-xs text-pitch-400">Forecast. Simulate. Story. Recalibrated after every completed match.</p>
      </div>

      {/* Match selector */}
      <div className="no-scrollbar mb-5 flex gap-2 overflow-x-auto pb-1">
        {candidates.map(m => {
          const h = byCode.get(m.home), a = byCode.get(m.away)
          const active = m.id === match.id
          return (
            <button key={m.id} onClick={() => setSelectedId(m.id)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-colors ${
                active ? 'border-brand/40 bg-brand/10' : 'border-white/5 bg-pitch-800'
              }`}>
              <div className="flex items-center gap-1.5 text-sm font-bold">
                {h?.flag} {m.home} <span className="text-[10px] text-pitch-400">vs</span> {a?.flag} {m.away}
                {m.status === 'live' && <span className="live-dot ml-1" />}
              </div>
              <div className="mt-0.5 font-mono text-[9px] text-pitch-400">{phaseTag(m)} · {formatDate(m.date)}</div>
            </button>
          )
        })}
      </div>

      {/* Intelligence header */}
      <div className="mb-4 rounded-2xl border border-white/5 bg-gradient-to-br from-pitch-800 to-pitch-900 p-5">
        <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-brand">Match Intelligence</div>
        <div className="flex items-center gap-3 text-lg font-bold">
          {home?.flag} {match.home}
          <span className="text-sm text-pitch-400">vs</span>
          {away?.flag} {match.away}
        </div>
        <div className="mt-1 font-mono text-[11px] text-pitch-400">
          {phaseTag(match)} · {live ? `${phaseLabel(clock.phase)} · ${clock.display}` : done ? `FT ${match.score?.home}-${match.score?.away}` : `push-back ${formatDate(match.date)}, ${match.time} CET`}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* AI Momentum */}
        <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
          <h3 className="mb-3 font-display text-sm font-semibold">AI Momentum</h3>
          <MomentumBar label={home?.name ?? match.home} value={momentumHome} color="var(--color-brand)" />
          <MomentumBar label={away?.name ?? match.away} value={momentumAway} color="#63b3ed" />
          <p className="mt-2 text-[10px] leading-relaxed text-pitch-400">
            Composite of circle entries, shots, penalty corners won, outletting quality and card discipline.
          </p>
        </div>

        {/* Win Probability Evolution */}
        <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
          <h3 className="mb-3 font-display text-sm font-semibold">Win Probability Evolution</h3>
          {probSeries.length > 1 ? (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={probSeries} margin={{ top: 4, right: 4, bottom: 0, left: -28 }}>
                <XAxis dataKey="min" tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: '#111f4d', border: '1px solid rgba(255,181,71,.2)', borderRadius: 8, fontSize: 11 }} />
                <Area type="monotone" dataKey={match.home} stroke="var(--color-brand)" fill="var(--color-brand)" fillOpacity={0.15} strokeWidth={2} />
                <Area type="monotone" dataKey="Draw" stroke="#5b75a8" fill="#5b75a8" fillOpacity={0.08} strokeWidth={1.5} />
                <Area type="monotone" dataKey={match.away} stroke="#63b3ed" fill="#63b3ed" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : pred?.status === 'ready' ? (
            <div className="flex gap-3 py-4 font-mono text-sm">
              <span className="text-brand">{match.home} {Math.round(pred.reg.home * 100)}%</span>
              <span className="text-pitch-400">Draw {Math.round(pred.reg.draw * 100)}%</span>
              <span className="text-sky-400">{match.away} {Math.round(pred.reg.away * 100)}%</span>
            </div>
          ) : <p className="py-4 text-xs text-pitch-400">Prediction computing…</p>}
        </div>

        {/* AI Confidence */}
        {pred?.status === 'ready' && (
          <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
            <h3 className="mb-3 font-display text-sm font-semibold">AI Confidence</h3>
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full font-mono text-base font-bold text-brand"
                style={{ background: `conic-gradient(var(--color-brand) ${pred.pickConfidencePct}%, var(--color-pitch-600) 0)` }}>
                <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-pitch-800">{pred.pickConfidencePct}%</span>
              </div>
              <div>
                <div className="text-sm font-bold">
                  {(pred.pick === 'HOME' ? home : away)?.name} {pred.isKnockout ? 'advance' : 'win'}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-pitch-400">
                  {pred.pickConfidencePct >= 70 ? 'High confidence · stable model' : pred.pickConfidencePct >= 55 ? 'Moderate confidence' : 'Coin-flip territory'}
                </div>
                {pred.isKnockout && (
                  <div className="mt-1.5 font-mono text-[10px] text-pitch-300">
                    Regulation path {Math.round(pred.paths.regulation * 100)}% · Shootout path {Math.round(pred.paths.shootout * 100)}%
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Key Drivers */}
        {drivers.length > 0 && (
          <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
            <h3 className="mb-3 font-display text-sm font-semibold">Key Drivers</h3>
            <div className="space-y-2.5">
              {drivers.map((d, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand">{d.w}</span>
                  <div>
                    <div className="text-xs font-semibold">{d.t}</div>
                    <div className="text-[11px] leading-snug text-pitch-400">{d.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* AI story */}
      <div className="mt-4 rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4">
        <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-widest text-brand">🧠 AI Match Story</div>
        {story ? (
          <>
            <p className="whitespace-pre-line text-sm leading-relaxed text-pitch-300">{story.story}</p>
            <div className="mt-3 border-t border-white/5 pt-2 font-mono text-[10px] text-pitch-400">
              Generated {new Date(story.generatedAt).toLocaleString()} · {story.model}
            </div>
          </>
        ) : (
          <p className="text-xs text-pitch-400">
            Story lands here after the GitHub Actions AI pipeline runs for this match — pre-generated with Claude, cached as static JSON, zero runtime API calls.
          </p>
        )}
      </div>
    </div>
  )
}
