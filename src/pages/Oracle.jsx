import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { activePredictions, derivePrediction, gradePrediction, oracleRecord } from '../engine/prediction'
import { useOracleBundle, buildRaceSeries } from '../engine/oracleBundle'
import { useSwipeTabs } from '../components/useSwipeTabs'
import { formatProbability } from '../engine/probability.js'
import { formatDate, phaseTag } from '../components/MatchCard'
import SiblingNav from '../components/SiblingNav'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'

const TABS = [
  { id: 'race', label: 'Race' },
  { id: 'odds', label: 'Odds' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'picks', label: 'Picks' },
]

const RACE_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#facc15', '#60a5fa', '#fb923c', '#34d399', '#c084fc', '#f87171', '#e879f9']

const SUBTITLES = {
  race: 'Champion-probability race · one simulation snapshot per completed match (0 → 32).',
  odds: 'Per-team stage odds · same engine snapshot as the race and bracket.',
  bracket: 'Live knockout bracket · pool standings drive every slot · engine predicts forward to the Gold Final.',
  picks: 'Every pick published before the match starts · graded publicly · no edits, no deletions.',
}

// The race leader, not the model's own report card — the header chip already
// carries the accuracy record, so the hero answers the reader's actual
// question: who is winning this thing, and on what form.
function RaceLeader({ bundle, teams, matches }) {
  if (!bundle) return null
  const lead = bundle.current.probabilities[0]
  const team = teams.find(t => t.code === lead?.teamId)
  if (!team) return null
  const byCode = new Map(teams.map(t => [t.code, t]))

  const played = matches.filter(m =>
    m.status === 'completed' && m.score?.home != null &&
    (m.home === team.code || m.away === team.code))
  const results = played.map(m => {
    const homeSide = m.home === team.code
    const gf = homeSide ? m.score.home : m.score.away
    const ga = homeSide ? m.score.away : m.score.home
    const opp = byCode.get(homeSide ? m.away : m.home)
    return { id: m.id, gf, ga, opp, r: gf > ga ? 'W' : gf === ga ? 'D' : 'L' }
  })
  const w = results.filter(r => r.r === 'W').length
  const d = results.filter(r => r.r === 'D').length
  const l = results.filter(r => r.r === 'L').length
  const gf = results.reduce((s, r) => s + r.gf, 0)
  const ga = results.reduce((s, r) => s + r.ga, 0)
  const n = results.length
  const formLine = n === 0 ? 'No matches played yet.' :
    `${l === 0 ? 'Unbeaten through' : `${w} win${w === 1 ? '' : 's'} in`} ${n} match${n === 1 ? '' : 'es'}` +
    `${l === 0 ? ` (${w}W${d ? ` ${d}D` : ''})` : d || l ? ` (${d}D ${l}L)` : ''} · ${gf} scored, ${ga} conceded.`

  return (
    <Link to={`/teams/${team.code}`}
      className="mb-5 block rounded-xl border-l-2 border-l-brand border-white/5 bg-pitch-800 p-4 transition-colors hover:border-brand/25">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">Race leader</span>
        <span className="font-mono text-[11px] text-pitch-300">after {bundle.current.completedMatches} completed matches</span>
      </div>
      <div className="mt-1.5 flex items-center gap-3">
        <span className="text-4xl">{team.flag}</span>
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight">{team.name}</div>
          <div className="font-mono text-[11px] text-pitch-400">{formLine}</div>
        </div>
        <span className="ml-auto font-mono text-3xl font-bold text-brand">{formatProbability(lead.champion)}</span>
      </div>
      {results.length > 0 && (
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto">
          {results.map(r => (
            <span key={r.id}
              className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] font-bold ${
                r.r === 'W' ? 'bg-live/15 text-live' : r.r === 'D' ? 'bg-pitch-700 text-pitch-300' : 'bg-red-400/10 text-red-400'
              }`}>
              {r.opp?.flag} {r.gf}–{r.ga}
            </span>
          ))}
        </div>
      )}
    </Link>
  )
}

function RaceTooltip({ active, payload, label, byCode }) {
  if (!active || !payload?.length) return null
  const rows = [...payload].filter(p => p.value > 0).sort((x, y) => y.value - x.value).slice(0, 6)
  return (
    <div className="rounded-lg border border-brand/20 bg-pitch-900/95 p-2.5 font-mono text-[11px] shadow-xl backdrop-blur">
      <div className="mb-1 text-pitch-400">After match #{label}</div>
      {rows.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.stroke }} />
          <span className="w-10">{byCode.get(p.dataKey)?.flag} {p.dataKey}</span>
          <span className="font-bold" style={{ color: p.stroke }}>{Number(p.value).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  )
}

function RaceTab({ bundle, teams }) {
  const { data, top, eliminated, byCode } = useMemo(() => buildRaceSeries(bundle, teams), [bundle, teams])
  const [focus, setFocus] = useState(null)
  if (!data.length) return <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">No completed matches yet — the race starts after the first result.</div>

  const currentMatch = data[data.length - 1].match
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {top.map((code, i) => (
          <button key={code} onClick={() => setFocus(focus === code ? null : code)}
            className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] transition-opacity ${
              focus && focus !== code ? 'opacity-40' : ''
            } ${focus === code ? 'border-brand/40 bg-brand/10' : 'border-white/5 bg-pitch-800'}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: RACE_COLORS[i % RACE_COLORS.length] }} />
            {byCode.get(code)?.flag} {code}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/5 bg-pitch-800 p-3">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data} margin={{ top: 8, right: 42, bottom: 4, left: -18 }}>
            <XAxis dataKey="match" type="number" domain={[0, 32]}
              tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={v => `${v}%`}
              tick={{ fill: '#5b75a8', fontSize: 9, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
            <Tooltip content={<RaceTooltip byCode={byCode} />} />
            <ReferenceLine x={currentMatch} stroke="rgba(255,255,255,0.35)" strokeDasharray="4 3"
              label={{ value: `#${currentMatch}`, fill: '#8fa3d1', fontSize: 9, position: 'top' }} />
            {eliminated.map(code => (
              <Line key={code} dataKey={code} type="stepAfter" dot={false} isAnimationActive={false}
                stroke="rgba(180,190,210,0.45)" strokeDasharray="4 3" strokeWidth={1}
                opacity={focus ? 0.15 : 1} />
            ))}
            {top.map((code, i) => (
              <Line key={code} dataKey={code} type="monotone" dot={false} isAnimationActive={false}
                stroke={RACE_COLORS[i % RACE_COLORS.length]}
                strokeWidth={focus === code ? 3 : 2}
                opacity={focus && focus !== code ? 0.18 : 1} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {eliminated.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">Out:</span>
          {eliminated.map(code => (
            <span key={code} className="rounded bg-pitch-800 px-1.5 py-0.5 font-mono text-[10px] text-pitch-400 line-through">
              {byCode.get(code)?.flag} {code}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 font-mono text-[10px] leading-relaxed text-pitch-400">
        X-axis: completed matches (0 at the start of the tournament, 32 at the Gold Final).
        Y-axis: model-estimated probability of lifting the trophy. Each finished result triggers a fresh Monte-Carlo run — {bundle.current.simulationCount.toLocaleString()} simulated tournaments per snapshot, seeded and reproducible. The right-hand end of every line is the same number the Tournament tab and Odds table show.
      </p>
    </div>
  )
}

function OddsTab({ bundle, teams }) {
  const byCode = new Map(teams.map(t => [t.code, t]))
  // Canonical current snapshot — already ranked and normalized.
  const snap = bundle.current
  const rows = snap.probabilities
  const pct = formatProbability
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h2 className="font-display text-base font-semibold">Champion Probabilities</h2>
      <p className="mb-3 mt-0.5 text-[11px] text-pitch-400">
        Snapshot {snap.snapshotId} · after {snap.completedMatches} results · {snap.simulationCount.toLocaleString()} simulations ·
        identical numbers across Race, Odds, Bracket, Tournament and Home.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-white/5 font-mono text-[10px] uppercase tracking-wider text-pitch-400">
              <th className="py-2 pl-1 text-left">#</th>
              <th className="py-2 text-left">Team</th>
              <th className="px-1.5 py-2 text-right">Last 8</th>
              <th className="px-1.5 py-2 text-right">SF</th>
              <th className="px-1.5 py-2 text-right">Final</th>
              <th className="px-1.5 py-2 text-right text-brand">Champion</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const t = byCode.get(r.teamId)
              const out = bundle.eliminationAt.has(r.teamId)
              return (
                <tr key={r.teamId} className={`border-b border-white/5 last:border-0 ${out ? 'opacity-50' : ''}`}>
                  <td className="py-2 pl-1 font-mono text-[11px] text-pitch-400">{r.rank}</td>
                  <td className="py-2">
                    <Link to={`/teams/${r.teamId}`} className="flex items-center gap-2 hover:text-brand">
                      <span>{t?.flag}</span>
                      <span className={`font-semibold ${out ? 'line-through' : ''}`}>{t?.name ?? r.teamName}</span>
                    </Link>
                  </td>
                  <td className="px-1.5 text-right font-mono text-[12px] text-pitch-300">{pct(r.top8)}</td>
                  <td className="px-1.5 text-right font-mono text-[12px] text-pitch-300">{pct(r.sf)}</td>
                  <td className="px-1.5 text-right font-mono text-[12px] text-pitch-300">{pct(r.final)}</td>
                  <td className="px-1.5 text-right font-mono text-[12px] font-bold text-brand">{pct(r.champion)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TieCard({ tie, byCode }) {
  const [open, setOpen] = useState(false)
  const h = byCode.get(tie.home), a = byCode.get(tie.away)
  const state = tie.played ? 'FINISHED' : tie.locked ? 'CONFIRMED' : 'PROJECTED'
  const pH = tie.pHomeAdvance

  if (tie.played) {
    return (
      <div className="rounded-xl border border-live/30 bg-pitch-800 p-3.5">
        <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
          <span className="text-pitch-400">{tie.id}</span>
          <span className="text-live">Finished</span>
        </div>
        <div className="flex items-center gap-2 text-sm font-bold">
          {byCode.get(tie.winner)?.flag} {byCode.get(tie.winner)?.name ?? tie.winner}
          <span className="font-mono text-[10px] font-normal text-live">100%</span>
        </div>
        {tie.loser && (
          <div className="mt-1 text-xs text-pitch-400 line-through">
            {byCode.get(tie.loser)?.flag} {byCode.get(tie.loser)?.name ?? tie.loser} eliminated
          </div>
        )}
      </div>
    )
  }

  const row = (code, team, prob) => (
    <div className="flex items-center gap-2.5">
      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-base ring-1 ${
        tie.locked ? 'ring-live/60' : 'ring-white/20 ring-dashed'
      }`} style={{ borderStyle: tie.locked ? 'solid' : 'dashed' }}>
        {team?.flag ?? '❓'}
      </span>
      <span className={`flex-1 text-sm ${tie.predicted === code ? 'font-bold' : 'text-pitch-300'}`}>
        {team?.name ?? code ?? 'TBD'}
      </span>
      {prob != null && tie.predicted === code && (
        <span className="font-mono text-xs font-bold text-brand">{Math.round(prob * 100)}%</span>
      )}
    </div>
  )

  return (
    <button onClick={() => setOpen(!open)}
      className="w-full rounded-xl border border-white/5 bg-pitch-800 p-3.5 text-left transition-colors hover:border-brand/20">
      <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
        <span className="text-pitch-400">{tie.id}</span>
        <span className={state === 'CONFIRMED' ? 'text-live' : 'text-pitch-400'}>
          {state === 'CONFIRMED' ? '● Locked' : '○ Projected'} · Advance %
        </span>
      </div>
      <div className="space-y-2">
        {row(tie.home, h, pH)}
        {pH != null && tie.home && tie.away && (
          <div className="flex justify-center">
            <span className="rounded bg-pitch-700 px-2 py-0.5 font-mono text-[10px] text-pitch-300">
              vs · {Math.round((tie.predicted === tie.home ? pH : 1 - pH) * 100)}% {tie.predicted}
            </span>
          </div>
        )}
        {row(tie.away, a, pH != null ? 1 - pH : null)}
      </div>
      {open && tie.match?.label && (
        <div className="mt-2 border-t border-white/5 pt-2 font-mono text-[10px] text-pitch-400">
          {tie.match.label} · {formatDate(tie.match.date)} · {tie.match.venue === 'AMV' ? 'Amstelveen' : 'Brussels'}
        </div>
      )}
    </button>
  )
}

function BracketTab({ bundle, teams }) {
  const byCode = new Map(teams.map(t => [t.code, t]))
  const groups = [
    ['Semi-Finals', bundle.bracket.ties.filter(t => t.group === 'semi')],
    ['Medal Matches', bundle.bracket.ties.filter(t => t.group === 'medal')],
    ['Classification (5th–16th)', bundle.bracket.ties.filter(t => t.group === 'classification')],
  ]
  const champLeader = bundle.current.probabilities[0]
  const champCode = champLeader?.teamId
  const gold = bundle.bracket.byId.get('GOLD')
  const decided = gold?.played

  return (
    <div className="space-y-6">
      <div className="mb-1 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-pitch-400">
        <span><span className="text-live">●</span> Locked</span>
        <span>○ Projected</span>
      </div>
      {groups.map(([label, ties]) => (
        <div key={label}>
          <h2 className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">{label}</h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {ties.map(tie => <TieCard key={tie.id} tie={tie} byCode={byCode} />)}
          </div>
        </div>
      ))}
      {champCode && (
        <div className="rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/10 to-pitch-900 p-5 text-center">
          <div className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">
            {decided ? '🏆 Champion' : '🏆 Predicted Champion'}
          </div>
          <div className="mt-2 text-3xl">{byCode.get(decided ? gold.winner : champCode)?.flag}</div>
          <div className="mt-1 font-display text-xl font-bold">{byCode.get(decided ? gold.winner : champCode)?.name}</div>
          {!decided && <div className="mt-1 font-mono text-sm text-brand">{formatProbability(champLeader.champion)} trophy</div>}
        </div>
      )}
      <p className="font-mono text-[10px] leading-relaxed text-pitch-400">
        Each forward tie shows the most likely matchup from current pool standings. The odds table integrates every
        possible bracket — never collapsed to the favourite.
      </p>
    </div>
  )
}

function PicksTab({ matches, predictions, teams }) {
  const byCode = new Map(teams.map(t => [t.code, t]))
  const byMatch = new Map(matches.map(m => [m.id, m]))
  const rows = activePredictions(predictions)
    .map(p => ({ p, m: byMatch.get(p.matchId) }))
    .filter(r => r.m)
    .sort((a, b) => b.m.kickoffUtc - a.m.kickoffUtc)
  const graded = rows.filter(r => r.m.status === 'completed')
  const pending = rows.filter(r => r.m.status !== 'completed')

  function PredCard({ p, m }) {
    const d = derivePrediction({ match: m, row: p })
    const grade = gradePrediction(m, p)
    const pickName = d.pick === 'HOME' ? byCode.get(m.home)?.name : d.pick === 'AWAY' ? byCode.get(m.away)?.name : 'Draw'
    const h = byCode.get(m.home), a = byCode.get(m.away)
    return (
      <Link to={`/matches/${m.id}`} className="flex items-center gap-3.5 rounded-xl border border-white/5 bg-pitch-800 p-3.5 transition-colors hover:border-brand/20">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold ${
          grade === 'correct' ? 'bg-live/10 text-live' :
          grade === 'wrong' ? 'bg-red-400/10 text-red-400' : 'bg-brand/10 text-brand'
        }`}>
          {grade === 'correct' ? '✓' : grade === 'wrong' ? '✗' : '⏳'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {h?.flag} {m.home} vs {a?.flag} {m.away}
          </div>
          <div className="font-mono text-[10px] text-pitch-400">
            {phaseTag(m)} · {formatDate(m.date)}
            {m.status === 'completed' && m.score?.home != null && ` · FT ${m.score.home}-${m.score.away}`}
            {p.basis === 'model-backfill' && <span className="ml-1.5 rounded bg-pitch-700 px-1 py-px text-[9px] uppercase">backfill</span>}
          </div>
          {p.reason && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-pitch-300">{p.reason}</p>}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-bold text-brand">{pickName}</div>
          <div className="font-mono text-[10px] text-pitch-400">{d.pickConfidencePct}% conf</div>
        </div>
      </Link>
    )
  }

  return (
    <div>
      {pending.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">⏳ Pending Picks</h2>
          <div className="space-y-2">{pending.map(r => <PredCard key={r.p.id} {...r} />)}</div>
        </section>
      )}
      <section>
        <h2 className="mb-2.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">📋 Graded Record</h2>
        {graded.length === 0
          ? <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">No graded picks yet.</div>
          : <div className="space-y-2">{graded.map(r => <PredCard key={r.p.id} {...r} />)}</div>}
      </section>
    </div>
  )
}

export default function OraclePage() {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(t => t.id === params.get('tab')) ? params.get('tab') : 'race'
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [])
  const predictions = useLiveQuery(() => db.predictions.toArray(), [])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const bundle = useOracleBundle(teams, matches)
  const calibration = useLiveQuery(() => db.meta.get('calibration'), [])
  const fallback = oracleRecord(matches ?? [], predictions ?? [])
  const rec = calibration
    ? { correct: calibration.correct, graded: calibration.matches, accuracyPct: calibration.accuracy_pct }
    : fallback

  const setTab = (t) => {
    const next = new URLSearchParams(params)
    t === 'race' ? next.delete('tab') : next.set('tab', t)
    setParams(next, { replace: true })
  }

  useSwipeTabs({
    count: TABS.length,
    index: TABS.findIndex(t => t.id === tab),
    onChange: i => setTab(TABS[i].id),
  })

  if (matches === undefined || predictions === undefined) return <Skeleton h={500} />

  return (
    <div>
      <SiblingNav items={[
        { to: '/prediction-race', label: '🎯 Oracle' },
        { to: '/ai-lab', label: '🧠 AI Lab' },
      ]} />
      <div className="mb-4 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🎯 Oracle</h1>
        {/* The live record is the Oracle's transparency headline — every tab,
            same one-line subtitle treatment as the Matches page. */}
        <p className="mt-1 text-xs text-pitch-400">
          {SUBTITLES[tab]}
          {rec.graded > 0 && <span className="text-brand"> · 🎯 {rec.correct}/{rec.graded} correct · {rec.accuracyPct}%</span>}
        </p>
      </div>

      <RaceLeader bundle={bundle} teams={teams} matches={matches} />

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

      {!bundle && tab !== 'picks'
        ? <Skeleton h={400} />
        : (
          <>
            {tab === 'race' && <RaceTab bundle={bundle} teams={teams} />}
            {tab === 'odds' && <OddsTab bundle={bundle} teams={teams} />}
            {tab === 'bracket' && <BracketTab bundle={bundle} teams={teams} />}
            {tab === 'picks' && <PicksTab matches={matches} predictions={predictions} teams={teams} />}
          </>
        )}
    </div>
  )
}
