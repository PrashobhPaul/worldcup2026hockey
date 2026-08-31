import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { db } from '../db'
import { Skeleton } from './shared'
import { DerivedBadge } from './hockeyIcons'

// The marks this tournament set.
//
// Every figure is computed by scripts/tournament_records.py from the published
// match record and checked against it by scripts/test_records.py, so nothing
// here is written by hand and nothing can outlive a corrected result.
//
// They are stated as THIS tournament's records and never as World Cup records.
// The difference is not pedantry: claiming an all-time record needs the other
// fifteen tournaments to compare against, and this app does not hold them.
// The History view says the same thing about its own sourcing.

function Holder({ h, byCode }) {
  const code = h.team ?? null
  const flag = code ? byCode.get(code)?.flag : null
  const label = h.player ?? h.teamName ?? null
  return (
    <li className="flex items-center gap-2 rounded-lg bg-pitch-950/40 px-2.5 py-1.5">
      {flag && <span className="text-base">{flag}</span>}
      <div className="min-w-0 flex-1">
        {label && (
          <div className="truncate text-xs font-semibold">
            {label}
            {h.player && h.teamName && (
              <span className="ml-1.5 font-mono text-[10px] font-normal text-pitch-400">{h.teamName}</span>
            )}
          </div>
        )}
        {h.line && (
          <div className="font-mono text-[11px] text-pitch-300">
            {h.matchId
              ? <Link to={`/matches/${h.matchId}`} className="hover:text-brand">{h.line}</Link>
              : h.line}
          </div>
        )}
        {(h.detail || h.minute != null) && (
          <div className="font-mono text-[10px] text-pitch-400">
            {h.minute != null ? `minute ${h.minute}` : h.detail}
          </div>
        )}
      </div>
      {h.label && <span className="font-mono text-[10px] text-pitch-400">{h.label}</span>}
    </li>
  )
}

function RecordCard({ rec, byCode }) {
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-display text-sm font-semibold">{rec.title}</h3>
        <span className="shrink-0 font-mono text-lg font-bold text-brand">{rec.value}</span>
      </div>
      {/* A tie is kept as a tie. Two nations that both won by six goals both
          hold the mark, and choosing one of them by alphabet would invent a
          ranking the sport does not have. */}
      {rec.holders.length > 1 && (
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-widest text-pitch-400">
          shared by {rec.holders.length}
        </p>
      )}
      <ul className="mt-2 space-y-1">
        {rec.holders.map((h, i) => <Holder key={i} h={h} byCode={byCode} />)}
      </ul>
      {rec.detail && <p className="mt-2 text-[11px] leading-relaxed text-pitch-400">{rec.detail}</p>}
    </div>
  )
}

export default function RecordsView({ byCode }) {
  const doc = useLiveQuery(() => db.meta.get('records'), [])
  if (doc === undefined) return <Skeleton h={400} />
  const records = doc?.records ?? []
  if (!records.length) {
    return (
      <p className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
        Records fill from the match record as the tournament is played.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/10 to-pitch-900 p-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">
          Records · this tournament
        </p>
        <h2 className="mt-1 font-display text-xl font-bold">🏑 The marks of 2026</h2>
        <p className="mt-2 text-xs leading-relaxed text-pitch-300">
          Every one computed from the {doc.matches} completed matches, not written down. These are
          this edition&apos;s records — <strong className="text-pitch-200">not</strong> all-time World Cup
          records: naming one of those needs the other fifteen tournaments to compare against, and
          the FIH&apos;s historical statistics are the authority on them.
        </p>
        <div className="mt-3"><DerivedBadge derived /></div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {records.map(rec => <RecordCard key={rec.key} rec={rec} byCode={byCode} />)}
      </div>

      <p className="rounded-xl border border-white/5 bg-pitch-800 p-3.5 font-mono text-[10px] leading-relaxed text-pitch-400">
        Reproduce these with python3 scripts/tournament_records.py. The committed file is checked
        against a fresh computation on every build, so a corrected result moves the record rather
        than leaving a stale one on this page.
      </p>
    </div>
  )
}
