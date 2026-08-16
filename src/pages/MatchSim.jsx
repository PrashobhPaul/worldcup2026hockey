import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { ArrowLeft } from 'lucide-react'
import { SIM_ID, SIM_MATCH, SIM_LINEUPS, SIM_CARDS } from '../content/sim'

function rowsFromFormation(players, formation) {
  const gk = players.filter(p => p.pos === 'GK')
  const outfield = players.filter(p => p.pos !== 'GK')
  const segs = formation.split('-').map(Number)
  const rows = [gk]
  let i = 0
  for (const n of segs) { rows.push(outfield.slice(i, i + n)); i += n }
  return rows
}

function Pitch({ players, formation, byCode, accent }) {
  const rows = rowsFromFormation(players, formation)
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0e3a6e] via-[#0b2f5c] to-[#082347]">
      {/* Hockey pitch markings */}
      <svg viewBox="0 0 300 400" className="absolute inset-0 h-full w-full opacity-30" fill="none" stroke="#8fd0ff" strokeWidth="1.5">
        <rect x="8" y="8" width="284" height="384" rx="4" />
        <line x1="8" y1="200" x2="292" y2="200" />
        <line x1="8" y1="104" x2="292" y2="104" strokeDasharray="6 5" />
        <line x1="8" y1="296" x2="292" y2="296" strokeDasharray="6 5" />
        <path d="M 86 392 A 64 64 0 0 1 214 392" />
        <path d="M 86 8 A 64 64 0 0 0 214 8" />
        <rect x="126" y="384" width="48" height="8" />
        <rect x="126" y="8" width="48" height="8" />
      </svg>
      <div className="absolute inset-0 flex flex-col-reverse justify-around py-3">
        {rows.map((row, ri) => (
          <div key={ri} className="flex justify-around">
            {row.map(p => (
              <div key={p.player} className="flex w-16 flex-col items-center gap-0.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pitch-950/80 text-lg ring-2"
                  style={{ '--tw-ring-color': accent }}>
                  {byCode.get(p.nat)?.flag ?? '🏑'}
                </span>
                <span className="max-w-full truncate text-center text-[9px] font-semibold leading-tight text-white/90">
                  {p.player.split(' ').slice(-1)[0]}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function SideLineup({ label, coach, formation, players, byCode, accent }) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold" style={{ color: accent }}>{label}</h2>
      <p className="mb-2 font-mono text-[10px] text-pitch-400">✨ Coach: {coach} · {formation}</p>
      <Pitch players={players} formation={formation} byCode={byCode} accent={accent} />
      <ul className="mt-3 space-y-1">
        {players.map(p => (
          <li key={p.player} className="flex items-center gap-2 font-mono text-[11px] text-pitch-300">
            <span className="w-6 rounded bg-pitch-700 px-1 text-center text-[9px] font-bold">{p.pos}</span>
            <span>{byCode.get(p.nat)?.flag}</span>
            <span className="font-sans text-xs font-semibold text-white">{p.player}</span>
            <span className="text-pitch-400">({p.nat})</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SimCard({ title, icon, children, accent = 'var(--color-brand)' }) {
  return (
    <div className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <h3 className="mb-3 flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: accent }}>
        <span>{icon}</span> {title}
      </h3>
      {children}
    </div>
  )
}

export default function MatchSimPage() {
  const { simId } = useParams()
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))

  if (simId !== SIM_ID) {
    return (
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
        Simulation not found. <Link to="/ai-lab" className="text-brand">← AI Lab</Link>
      </div>
    )
  }

  const confidence = SIM_CARDS.find(c => c.key === 'confidence')
  const drivers = SIM_CARDS.filter(c => c.key === 'driver')
  const insights = SIM_CARDS.filter(c => c.key === 'insight')
  const disclosure = SIM_CARDS.find(c => c.key === 'disclosure')

  return (
    <div className="space-y-5">
      <Link to="/matches" className="inline-flex items-center gap-1.5 text-xs font-medium text-pitch-300 hover:text-brand">
        <ArrowLeft size={14} /> All matches
      </Link>

      {/* Sim header */}
      <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-pitch-800 to-pitch-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-brand">
            ✨ {SIM_MATCH.statusChip}
          </span>
          <span className="font-mono text-[10px] text-pitch-400">{SIM_MATCH.venueLabel}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="text-left">
            <div className="text-sm font-bold">▸ {SIM_MATCH.homeLabel}</div>
            <div className="font-mono text-[10px] text-pitch-400">{SIM_MATCH.homeFormation}</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-3xl font-bold tracking-widest">{SIM_MATCH.result.home}–{SIM_MATCH.result.away}</div>
            <div className="font-mono text-[10px] text-pitch-400">{SIM_MATCH.result.decider}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold">{SIM_MATCH.awayLabel}</div>
            <div className="font-mono text-[10px] text-pitch-400">{SIM_MATCH.awayFormation}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SideLineup label={SIM_MATCH.homeLabel} coach={SIM_MATCH.homeCoach} formation={SIM_MATCH.homeFormation}
          players={SIM_LINEUPS.home} byCode={byCode} accent="var(--color-brand)" />
        <SideLineup label={SIM_MATCH.awayLabel} coach={SIM_MATCH.awayCoach} formation={SIM_MATCH.awayFormation}
          players={SIM_LINEUPS.away} byCode={byCode} accent="#34d399" />
      </div>

      {confidence && (
        <SimCard title="AI Confidence" icon="✨" accent="#22d3ee">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-bold">{confidence.title}</span>
            <span className="font-mono text-sm font-bold text-brand">{confidence.value}%</span>
          </div>
          <div className="mb-2 h-2 overflow-hidden rounded-full bg-pitch-600">
            <div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-deep" style={{ width: `${confidence.value}%` }} />
          </div>
          <p className="text-xs leading-relaxed text-pitch-300">{confidence.detail}</p>
        </SimCard>
      )}

      <SimCard title="Key Drivers" icon="🎯" accent="#a78bfa">
        <div className="space-y-2">
          {drivers.map((d, i) => (
            <div key={i} className="rounded-lg border border-white/5 bg-pitch-950/40 p-3">
              <div className="mb-1 font-mono text-[10px] font-bold uppercase tracking-widest text-pitch-300">{d.title}</div>
              <p className="text-xs leading-relaxed text-pitch-300">{d.detail}</p>
            </div>
          ))}
        </div>
      </SimCard>

      <SimCard title="Tactical Insights" icon="💡" accent="#facc15">
        <div className="space-y-2">
          {insights.map((d, i) => (
            <p key={i} className="rounded-lg border border-white/5 bg-pitch-950/40 p-3 text-xs leading-relaxed text-pitch-300">{d.detail}</p>
          ))}
        </div>
      </SimCard>

      {disclosure && (
        <p className="rounded-xl border border-white/5 bg-pitch-800 p-3.5 font-mono text-[10px] leading-relaxed text-pitch-400">
          {disclosure.detail}
        </p>
      )}
    </div>
  )
}
