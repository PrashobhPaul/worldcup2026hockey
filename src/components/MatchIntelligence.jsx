// The Match Intelligence panel — telemetry, momentum, win-probability
// evolution, drivers, insights and Match DNA for one match. Lived inside the
// AI Lab's live tab; extracted so the match page itself can carry the same
// intelligence as a section, computed from the same engine calls.
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { derivePrediction } from '../engine/prediction'
import { formatProbability } from '../engine/probability.js'
import { phaseLabel } from '../engine/clock'
import {
  deriveTelemetry, buildMomentumSeries, buildProbSeries,
  deriveComeback, buildInsights, buildDrivers, buildMatchDNA,
} from '../engine/insights'
import { formatDate, phaseTag } from './MatchCard'
import PredictionSplit from './PredictionSplit'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts'

export const TIP_STYLE = { background: '#111f4d', border: '1px solid rgba(255,181,71,.2)', borderRadius: 8, fontSize: 11 }

export function LabCard({ title, icon, children, accent = 'var(--color-brand)' }) {
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: accent }}>
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  )
}

export function MetricBar({ label, value, color, delta }) {
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

export function StatBlock({ label, value, sub }) {
  return (
    <div className="rounded-lg bg-pitch-950/50 p-2.5">
      <div className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-bold">{value}</div>
      {sub && <div className="font-mono text-[10px] text-pitch-400">{sub}</div>}
    </div>
  )
}

export default function MatchIntelligence({ match, matches, byCode, linkToMatch = true }) {
  const events = useLiveQuery(
    () => match ? db.match_events.where('matchId').equals(match.id).sortBy('seq') : [],
    [match?.id], [],
  )
  const allEvents = useLiveQuery(() => db.match_events.toArray(), [], [])
  // The ACTIVE pick, never a superseded erratum row — .first() by key order
  // would happily return the original of a revised pick.
  const prediction = useLiveQuery(
    () => match ? db.predictions.where('matchId').equals(match.id).toArray()
      .then(rows => rows.find(r => !r.superseded) ?? null) : undefined,
    [match?.id],
  )
  if (!match) return null

  const home = byCode.get(match.home)
  const away = byCode.get(match.away)
  const pred = prediction ? derivePrediction({ match, row: prediction }) : null
  const tele = deriveTelemetry({ match, home, away, events, pred })
  const momentum = buildMomentumSeries({ match, events })
  const probSeries = buildProbSeries({ match, events, pred })
  const comeback = deriveComeback({ match, tele, home, away })
  const insights = buildInsights({ match, home, away, events, pred, tele })
  const drivers = buildDrivers({ match, home, away, pred, allEvents })
  const dna = buildMatchDNA({ match, matches, allEvents })
  const live = match.status === 'live'
  const done = match.status === 'completed'

  return (
    <div>
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
                : `starts ${formatDate(match.date)}, ${match.time} CET`}
              {' · '}{match.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}
              {linkToMatch && (
                <>
                  {' · '}
                  <Link to={`/matches/${match.id}`} className="text-brand hover:underline">Full match →</Link>
                </>
              )}
            </div>
          </div>
          <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-pitch-950/60">
            <span className="font-mono text-xl font-bold text-brand">{tele.overallScore}</span>
            <span className="font-mono text-[8px] uppercase tracking-widest text-pitch-400">/100</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatBlock label="Overall Score" value={`${tele.overallScore} / 100`} />
          <StatBlock label="AI Confidence" value={pred?.status === 'ready' ? formatProbability(pred.confidence) : '—'} />
          <StatBlock label="Current State" value={
            done ? `FT · ${match.score?.home}-${match.score?.away}`
              : live ? (match.score?.home == null ? 'Awaiting score'
                : tele.goalDiff === 0 ? 'Level' : `${(tele.goalDiff > 0 ? home : away)?.name} in control`)
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
                <StatBlock label="Start · 0'" value={`${probSeries[0].home}% / ${probSeries[0].draw}% / ${probSeries[0].away}%`} />
                <StatBlock label={`Latest · ${probSeries[probSeries.length - 1].min}'`}
                  value={`${probSeries[probSeries.length - 1].home}% / ${probSeries[probSeries.length - 1].draw}% / ${probSeries[probSeries.length - 1].away}%`} />
              </div>
            </>
          ) : pred?.status === 'ready' ? (
            <PredictionSplit pred={pred} home={match.home} away={match.away} className="py-4" />
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
                style={{ background: `conic-gradient(var(--color-brand) ${pred.confidencePct}%, var(--color-pitch-600) 0)` }}>
                <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-pitch-800">{formatProbability(pred.confidence)}</span>
              </div>
              <div>
                <div className="text-sm font-bold">
                  {(pred.pick === 'HOME' ? home : pred.pick === 'AWAY' ? away : null)?.name ?? 'Draw'} {pred.isKnockout ? 'advance' : 'win'}
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-pitch-400">
                  {pred.confidence >= 0.70 ? 'High confidence · stable model' : pred.confidence >= 0.55 ? 'Moderate confidence' : 'Coin-flip territory'}
                </div>
                {pred.isKnockout && (
                  <div className="mt-1.5 font-mono text-[10px] text-pitch-300">
                    Regulation path {formatProbability(pred.paths.regulation)} · Shootout path {formatProbability(pred.paths.shootout)}
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
