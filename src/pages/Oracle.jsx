import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { derivePrediction, gradePrediction, oracleRecord } from '../engine/prediction'
import { formatDate, phaseTag } from '../components/MatchCard'

export default function OraclePage() {
  const matches = useLiveQuery(() => db.matches.toArray(), [])
  const predictions = useLiveQuery(() => db.predictions.toArray(), [])
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])

  if (matches === undefined || predictions === undefined) return <Skeleton h={500} />

  const byCode = new Map(teams.map(t => [t.code, t]))
  const byMatch = new Map(matches.map(m => [m.id, m]))
  const rec = oracleRecord(matches, predictions)

  const rows = predictions
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
      <div className="mb-5 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🎯 The Oracle</h1>
        <p className="mt-1 text-xs text-pitch-400">
          Every pick published before push-back · graded publicly · no edits, no deletions
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {[
          [rec.accuracyPct != null ? `${rec.accuracyPct}%` : '—', 'Accuracy'],
          [`${rec.correct}/${rec.graded}`, 'Correct picks'],
          [rec.total, 'Total published'],
          [pending.length, 'Awaiting result'],
        ].map(([v, l]) => (
          <div key={l} className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-center">
            <div className="font-mono text-2xl font-bold text-brand">{v}</div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wider text-pitch-400">{l}</div>
          </div>
        ))}
      </div>

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
