import { useMemo, useState } from 'react'
import { useSwipeTabs } from '../components/useSwipeTabs'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { derivePrediction } from '../engine/prediction'
import { phaseLabel } from '../engine/clock'
import {
  deriveTelemetry, buildMomentumSeries, buildProbSeries,
  deriveComeback, buildInsights, buildDrivers, buildMatchDNA,
} from '../engine/insights'
import { formatDate, phaseTag } from '../components/MatchCard'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts'

const TABS = [
  { id: 'live', label: 'live' },
  { id: 'previews', label: 'previews' },
  { id: 'stories', label: 'stories' },
]

const TIP_STYLE = { background: '#111f4d', border: '1px solid rgba(255,181,71,.2)', borderRadius: 8, fontSize: 11 }

function LabCard({ title, icon, children, accent = 'var(--color-brand)' }) {
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: accent }}>
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  )
}

function MetricBar({ label, value, color, delta }) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex justify-between font-mono text-xs">
        <span className="font-bold" style={{ color }}>{label}</span>
        <span className="text-pitch-300">
          {value}
          {delta != null && delta !== 0 && (
            <span className={`ml-1.5 ${delta > 0 ? 'text-live' : 'text-red-400'}`}>
              {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}
            </span>
          )}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-pitch-600">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

function StatBlock({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-pitch-950/50 p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold">{value}</div>
      {sub && <div className="font-mono text-[10px] text-pitch-400">{sub}</div>}
    </div>
  )
}

function LivePanel({ matches, teams, byCode, initialMatchId, onSelectMatch }) {
  const [localId, setLocalId] = useState(null)
  const selectedId = localId ?? initialMatchId
  const setSelectedId = (id) => { setLocalId(id); onSelectMatch?.(id) }

  const candidates = useMemo(() => {
    const all = (matches ?? []).filter(m => m.home !== 'TBD')
    const live = all.filter(m => m.status === 'live')
    const done = all.filter(m => m.status === 'completed')
    const next = all.filter(m => m.status === 'scheduled')
    return [...live, ...done.slice(-3).reverse(), ...next.slice(0, 4)]
  }, [matches])

  const match = useMemo(() => {
    if (selectedId) return matches.find(m => m.id === selectedId)
    return candidates.find(m => m.status === 'live') ?? candidates[0]
  }, [selectedId, candidates, matches])

  const events = useLiveQuery(
    () => match ? db.match_events.where('matchId').equals(match.id).sortBy('seq') : [],
    [match?.id], [],
  )
  const allEvents = useLiveQuery(() => db.match_events.toArray(), [], [])
  const prediction = useLiveQuery(
    () => match ? db.predictions.where('matchId').equals(match.id).first() : undefined,
    [match?.id],
  )

  if (!match) return <div className="text-sm text-pitch-400">Intelligence will appear once fixtures load.</div>

  const home = byCode.get(match.home)
  const away = byCode.get(match.away)
  const pred = prediction ? derivePrediction({ match, row: prediction }) : null
  const tele = deriveTelemetry({ match, home, away, events, pred })
  const momentum = buildMomentumSeries({ match, events })
  const probSeries = buildProbSeries({ match, events, pred })
  const comeback = deriveComeback({ match, tele, home, away })
  const insights = buildInsights({ match, home, away, events, pred, tele })
  const drivers = buildDrivers({ match, home, away, pred })
  const dna = buildMatchDNA({ match, matches, allEvents })
  const live = match.status === 'live'
  const done = match.status === 'completed'

  return (
    <div>
      {/* Status banner + match selector */}
      <div className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[11px] ${
        live ? 'border-live/30 bg-live/5 text-live' : 'border-white/5 bg-pitch-800 text-pitch-400'
      }`}>
        {live ? <><span className="live-dot" /> Live · {tele.clock.display}</>
          : done ? <>No match live · showing a recent result</>
          : <>No match live · next push-back {formatDate(match.date)}, {match.time} CET</>}
      </div>

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

      {/* Match Intelligence header */}
      <div className="mb-4 rounded-2xl border border-white/5 bg-gradient-to-br from-pitch-800 to-pitch-900 p-5">
        <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-brand">🧠 Match Intelligence</div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 text-lg font-bold">
              {home?.flag} {match.home}
              <span className="text-sm text-pitch-400">vs</span>
              {away?.flag} {match.away}
            </div>
            <div className="mt-1 font-mono text-[11px] text-pitch-400">
              {phaseTag(match)} · {live ? `${phaseLabel(tele.clock.phase)} · ${tele.clock.display}`
                : done ? `${tele.clock.display} ${match.score?.home}-${match.score?.away}`
                : `push-back ${formatDate(match.date)}, ${match.time} CET`}
              {' · '}{match.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}
              {' · '}
              <Link to={`/matches/${match.id}`} className="text-brand hover:underline">Full match →</Link>
            </div>
          </div>
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-pitch-950/60">
            <span className="font-mono text-xl font-bold text-brand">{tele.overallScore}</span>
            <span className="font-mono text-[8px] uppercase tracking-widest text-pitch-400">/100</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatBlock label="Overall Score" value={`${tele.overallScore} / 100`} />
          <StatBlock label="AI Confidence" value={pred?.status === 'ready' ? `${pred.pickConfidencePct}%` : '—'} />
          <StatBlock label="Current State" value={
            done ? `FT · ${match.score?.home}-${match.score?.away}`
              : live ? (tele.goalDiff === 0 ? 'Level' : `${(tele.goalDiff > 0 ? home : away)?.name} in control`)
              : 'Pre-match'} />
          <StatBlock label="Chaos Index" value={`${tele.chaos}%`}
            sub={tele.chaos >= 75 ? 'High' : tele.chaos >= 50 ? 'Elevated' : 'Calm'} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LabCard title="AI Momentum" icon="⚡">
          <MetricBar label={home?.name ?? match.home} value={tele.homeMomentum} color="var(--color-brand)" delta={tele.homeDelta} />
          <MetricBar label={away?.name ?? match.away} value={tele.awayMomentum} color="#63b3ed" delta={tele.awayDelta} />
          <p className="mt-2 text-[10px] leading-relaxed text-pitch-400">
            Composite of FIH rating lean, goal difference and attacking moments in the last 15 minutes.
          </p>
        </LabCard>

        <LabCard title="Momentum Timeline" icon="📈" accent="#34d3ee">
          {momentum.length > 1 ? (
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={momentum} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <XAxis dataKey="min" tickFormatter={v => `${v}'`}
                  tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
                <YAxis domain={[-100, 100]} tickFormatter={v => `${Math.abs(v)}`}
                  tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={TIP_STYLE}
                  formatter={(v, name) => [Math.abs(v), name === 'home' ? match.home : match.away]}
                  labelFormatter={l => `${l}'`} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                {[15, 30, 45].map(q => <ReferenceLine key={q} x={q} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />)}
                <Area dataKey="home" stroke="var(--color-brand)" fill="var(--color-brand)" fillOpacity={0.2} strokeWidth={1.5} isAnimationActive={false} />
                <Area dataKey="away" stroke="#63b3ed" fill="#63b3ed" fillOpacity={0.2} strokeWidth={1.5} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-6 text-center text-xs text-pitch-400">Insufficient event data — the timeline appears once match events land.</p>
          )}
        </LabCard>

        <LabCard title="Win Probability Evolution" icon="📊" accent="#34d399">
          {probSeries.length > 1 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={probSeries} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <XAxis dataKey="min" tickFormatter={v => `${v}'`}
                    tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]}
                    tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={TIP_STYLE}
                    formatter={(v, name) => [`${v}%`, name === 'home' ? match.home : name === 'away' ? match.away : 'Draw']}
                    labelFormatter={l => `${l}'`} />
                  {[15, 30, 45].map(q => <ReferenceLine key={q} x={q} stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />)}
                  <Area dataKey="home" stroke="var(--color-brand)" fill="var(--color-brand)" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                  <Area dataKey="draw" stroke="#5b75a8" fill="#5b75a8" fillOpacity={0.08} strokeWidth={1.5} isAnimationActive={false} />
                  <Area dataKey="away" stroke="#63b3ed" fill="#63b3ed" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <StatBlock label="Push-back · 0'" value={`${probSeries[0].home}% / ${probSeries[0].draw}% / ${probSeries[0].away}%`} />
                <StatBlock label={`Latest · ${probSeries[probSeries.length - 1].min}'`}
                  value={`${probSeries[probSeries.length - 1].home}% / ${probSeries[probSeries.length - 1].draw}% / ${probSeries[probSeries.length - 1].away}%`} />
              </div>
            </>
          ) : pred?.status === 'ready' ? (
            <div className="flex gap-3 py-4 font-mono text-sm">
              <span className="text-brand">{match.home} {Math.round(pred.reg.home * 100)}%</span>
              <span className="text-pitch-400">Draw {Math.round(pred.reg.draw * 100)}%</span>
              <span className="text-sky-400">{match.away} {Math.round(pred.reg.away * 100)}%</span>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-white/10 py-4 text-center text-xs text-pitch-400">Computing prediction…</p>
          )}
        </LabCard>

        {!done && (
          <LabCard title="AI Pressure · next 10'" icon="🔥" accent="#fb923c">
            <MetricBar label={home?.name ?? match.home} value={tele.homePressure} color="#fb923c" />
            <MetricBar label={away?.name ?? match.away} value={tele.awayPressure} color="#f472b6" />
            <p className="mt-2 text-[10px] leading-relaxed text-pitch-400">
              Short-horizon threat from circle entries and penalty-corner traffic.
            </p>
          </LabCard>
        )}

        <LabCard title="Comeback" icon="🛡" accent="#22d3ee">
          <div className="text-sm font-bold">{comeback.headline}</div>
          <p className="mt-1 text-xs leading-relaxed text-pitch-300">{comeback.detail}</p>
          {comeback.subtext && <p className="mt-1.5 font-mono text-[10px] text-pitch-400">{comeback.subtext}</p>}
        </LabCard>

        {pred?.status === 'ready' && (
          <LabCard title="AI Confidence" icon="✨" accent="#60a5fa">
            <div className="flex items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full font-mono text-base font-bold text-brand"
                style={{ background: `conic-gradient(var(--color-brand) ${pred.pickConfidencePct}%, var(--color-pitch-600) 0)` }}>
                <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-pitch-800">{pred.pickConfidencePct}%</span>
              </div>
              <div>
                <div className="text-sm font-bold">
                  {(pred.pick === 'HOME' ? home : pred.pick === 'AWAY' ? away : null)?.name ?? 'Draw'} {pred.isKnockout ? 'advance' : 'win'}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-pitch-400">
                  {pred.pickConfidencePct >= 70 ? 'High confidence · stable model' : pred.pickConfidencePct >= 55 ? 'Moderate confidence' : 'Coin-flip territory'}
                </div>
                {pred.isKnockout && (
                  <div className="mt-1.5 font-mono text-[10px] text-pitch-300">
                    Regulation path {Math.round(pred.paths.regulation * 100)}% · Shootout path {Math.round(pred.paths.shootout * 100)}%
                  </div>
                )}
                {prediction?.reason && <p className="mt-1.5 text-[11px] leading-snug text-pitch-300">{prediction.reason}</p>}
              </div>
            </div>
          </LabCard>
        )}

        {drivers.length > 0 && (
          <LabCard title="Key Drivers" icon="🎯" accent="#34d399">
            <div className="space-y-2.5">
              {drivers.map((d, i) => (
                <div key={i} className="flex gap-2.5">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                    d.tone === 'pos' ? 'bg-live/10 text-live' : 'bg-brand/10 text-brand'
                  }`}>{i + 1}</span>
                  <div>
                    <div className="text-xs font-semibold">{d.title}</div>
                    <div className="text-[11px] leading-snug text-pitch-400">{d.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </LabCard>
        )}

        {insights.length > 0 && (
          <LabCard title="Tactical Insights" icon="💡" accent="#facc15">
            <ul className="space-y-2">
              {insights.map((s, i) => (
                <li key={i} className="rounded-lg border border-white/5 bg-pitch-950/40 px-3 py-2 text-xs leading-relaxed text-pitch-300">{s}</li>
              ))}
            </ul>
          </LabCard>
        )}

        {dna && (
          <LabCard title="Match DNA · from final data" icon="🧬" accent="#a78bfa">
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={dna} outerRadius="70%">
                <PolarGrid stroke="rgba(255,255,255,0.08)" />
                <PolarAngleAxis dataKey="axis" tick={{ fill: '#8fa3d1', fontSize: 10 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name={match.home} dataKey="home" stroke="var(--color-brand)" fill="var(--color-brand)" fillOpacity={0.2} isAnimationActive={false} />
                <Radar name={match.away} dataKey="away" stroke="#63b3ed" fill="#63b3ed" fillOpacity={0.2} isAnimationActive={false} />
                <Tooltip contentStyle={TIP_STYLE} formatter={v => `${v}%ile`} />
              </RadarChart>
            </ResponsiveContainer>
            <p className="text-[10px] leading-relaxed text-pitch-400">
              Each axis is this performance's percentile against every completed team-performance so far.
            </p>
          </LabCard>
        )}
      </div>
    </div>
  )
}

function PreviewsPanel({ matches, teams, byCode }) {
  const predictions = useLiveQuery(() => db.predictions.toArray(), [], [])
  const byMatch = new Map(predictions.map(p => [p.matchId, p]))

  const upcoming = (matches ?? [])
    .filter(m => m.status !== 'completed' && m.home !== 'TBD')
    .sort((a, b) => (a.status === 'live' ? -1 : b.status === 'live' ? 1 : a.kickoffUtc - b.kickoffUtc))
    .slice(0, 5)

  if (!upcoming.length) return <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">No upcoming matches to analyse.</div>

  return (
    <div>
      <div className="mb-4 rounded-xl border border-brand/20 bg-gradient-to-r from-brand/10 to-pitch-800 p-4">
        <div className="font-mono text-[11px] font-bold uppercase tracking-widest text-brand">📡 Next {upcoming.length} fixtures · engine forecast</div>
        <div className="mt-1 font-mono text-[10px] text-pitch-400">FIH-rank Elo + Poisson · picks frozen before push-back</div>
      </div>
      <div className="space-y-2.5">
        {upcoming.map(m => {
          const row = byMatch.get(m.id)
          const d = row ? derivePrediction({ match: m, row }) : null
          const h = byCode.get(m.home), a = byCode.get(m.away)
          const conf = d?.status === 'ready' ? d.confidence : null
          const tier = conf == null ? null : conf >= 0.55 ? ['high', 'text-live'] : conf >= 0.42 ? ['medium', 'text-sky-400'] : ['low', 'text-pitch-300']
          return (
            <div key={m.id} className="rounded-xl border border-white/5 bg-pitch-800 p-4">
              <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-pitch-400">
                <span className="uppercase tracking-wider">{phaseTag(m)} · {formatDate(m.date)}, {m.time} CET</span>
                {tier && <span className={`rounded bg-pitch-700 px-1.5 py-0.5 font-bold uppercase ${tier[1]}`}>{tier[0]}</span>}
              </div>
              <div className="mb-2.5 flex items-center gap-2 text-sm font-bold">
                <Link to={`/teams/${m.home}`} className="hover:text-brand">{h?.flag} {h?.name ?? m.home}</Link>
                <span className="text-[10px] font-normal text-pitch-400">vs</span>
                <Link to={`/teams/${m.away}`} className="hover:text-brand">{a?.flag} {a?.name ?? m.away}</Link>
              </div>
              {d?.status === 'ready' ? (
                <>
                  <div className="mb-1 flex h-2 overflow-hidden rounded-full">
                    <div style={{ width: `${d.reg.home * 100}%` }} className="bg-brand" />
                    <div style={{ width: `${d.reg.draw * 100}%` }} className="bg-pitch-600" />
                    <div style={{ width: `${d.reg.away * 100}%` }} className="bg-sky-400" />
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-pitch-400">
                    <span className="text-brand">{m.home} {Math.round(d.reg.home * 100)}%</span>
                    <span>Draw {Math.round(d.reg.draw * 100)}%</span>
                    <span className="text-sky-400">{Math.round(d.reg.away * 100)}% {m.away}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="font-mono text-xs">
                      Pick: <span className="font-bold text-brand">
                        {d.pick === 'HOME' ? h?.name : d.pick === 'AWAY' ? a?.name : 'Draw'} ({d.pickConfidencePct}%)
                      </span>
                    </span>
                    <Link to={`/matches/${m.id}`} className="font-mono text-[11px] text-brand hover:underline">Open match →</Link>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-white/10 py-3 text-center font-mono text-[11px] text-pitch-400">
                  Computing prediction…
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StoriesPanel({ matches, byCode }) {
  const stories = useLiveQuery(() => db.ai_stories.toArray(), [], [])
  const [openId, setOpenId] = useState(null)
  const byMatch = new Map(stories.map(s => [s.matchId, s]))

  const finished = (matches ?? [])
    .filter(m => m.status === 'completed' && m.score?.home != null)
    .sort((a, b) => b.kickoffUtc - a.kickoffUtc)

  if (!finished.length) {
    return <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
      No matches have finished yet. Stories appear here automatically after full-time.
    </div>
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">🧠 Post-match stories</h2>
        <span className="font-mono text-[10px] text-pitch-400">{finished.length} finished</span>
      </div>
      <div className="space-y-2">
        {finished.map(m => {
          const s = byMatch.get(m.id)
          const h = byCode.get(m.home), a = byCode.get(m.away)
          const open = openId === m.id
          return (
            <div key={m.id} className="rounded-xl border border-white/5 bg-pitch-800">
              <button onClick={() => setOpenId(open ? null : m.id)} className="flex w-full items-center gap-3 p-3.5 text-left">
                <span className="text-sm font-bold">{h?.flag} {m.home} {m.score.home} – {m.score.away} {m.away} {a?.flag}</span>
                <span className="ml-auto font-mono text-[10px] text-pitch-400">{formatDate(m.date)} · AI Story {s ? '✨' : '⏳'}</span>
              </button>
              {open && (
                <div className="border-t border-white/5 p-3.5">
                  {s ? (
                    <>
                      <p className="whitespace-pre-line text-sm leading-relaxed text-pitch-300">{s.story}</p>
                      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 font-mono text-[10px] text-pitch-400">
                        <span>Generated {new Date(s.generatedAt).toLocaleString()} · {s.model}</span>
                        <Link to={`/matches/${m.id}`} className="text-brand hover:underline">Open match →</Link>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-pitch-400">
                      Story lands after the GitHub Actions AI pipeline runs for this match — pre-generated with Claude, cached as static JSON, zero runtime API calls.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function AILabPage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : 'live'
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))

  const setTab = (t) => {
    const next = new URLSearchParams(params)
    t === 'live' ? next.delete('tab') : next.set('tab', t)
    setParams(next, { replace: true })
  }
  useSwipeTabs({
    count: TABS.length,
    index: TABS.findIndex(t => t.id === tab),
    onChange: i => setTab(TABS[i].id),
  })

  const setMatchParam = (id) => {
    const next = new URLSearchParams(params)
    id ? next.set('match', id) : next.delete('match')
    next.delete('tab')
    setParams(next, { replace: true })
  }

  if (matches === undefined) return <Skeleton h={500} />

  return (
    <div>
      <div className="mb-4 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🧠 AI Lab</h1>
        <p className="mt-1 text-xs text-pitch-400">
          Per-match AI insight — live momentum, upcoming-fixture previews and post-match stories, recalibrated after every completed match.
        </p>
      </div>

      <div className="sticky top-14 z-30 -mx-4 mb-5 flex gap-1.5 border-b border-white/5 bg-pitch-950/90 px-4 py-2 backdrop-blur-xl" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`rounded-md border px-3.5 py-1.5 font-mono text-xs font-semibold lowercase transition-colors ${
              tab === t.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'live' && (
        <LivePanel matches={matches} teams={teams} byCode={byCode}
          initialMatchId={params.get('match')} onSelectMatch={setMatchParam} />
      )}
      {tab === 'previews' && <PreviewsPanel matches={matches} teams={teams} byCode={byCode} />}
      {tab === 'stories' && <StoriesPanel matches={matches} byCode={byCode} />}
    </div>
  )
}
