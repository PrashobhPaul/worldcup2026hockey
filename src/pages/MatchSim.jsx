import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { ArrowLeft } from 'lucide-react'
import { SIM_MATCH } from '../content/sim'
import { exhibitions, SIM_FORMATION } from '../engine/sim'
import Pitch from '../components/Pitch'

function SideLineup({ label, coach, players, byCode, accent, note }) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold" style={{ color: accent }}>{label}</h2>
      <p className="mb-2 font-mono text-[10px] text-pitch-400">✨ Coach: {coach} · 1-4-3-3 · {note}</p>
      <Pitch players={players} formation={SIM_FORMATION} byCode={byCode} accent={accent} />
      <ul className="mt-3 space-y-1">
        {players.map(p => (
          <li key={p.id} className="flex items-center gap-2 font-mono text-[11px] text-pitch-300">
            <span className="w-6 rounded bg-pitch-700 px-1 text-center text-[9px] font-bold">{p.pos}</span>
            <span>{byCode.get(p.nat)?.flag}</span>
            <Link to={`/players?player=${p.id}`} className="font-sans text-xs font-semibold text-white hover:text-brand">{p.player}</Link>
            <span className="text-pitch-400">({p.nat})</span>
            <span className="ml-auto text-pitch-400">{p.note ?? p.stat}</span>
            <span className="font-bold text-live">{p.rating}</span>
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
  const players = useLiveQuery(() => db.players.toArray(), [], [])
  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))
  // Both team sheets and every figure below them, computed from the record.
  // Every exhibition the app shows, from the one place that builds them, so a
  // card on the Matches list and the page it opens cannot disagree.
  const all = useMemo(() => exhibitions(players, matches, teams), [players, matches, teams])
  const fixture = all.find(f => f.id === simId)
  const sim = fixture?.sim ?? null
  const M = fixture
    ? { ...SIM_MATCH, homeLabel: fixture.homeLabel, awayLabel: fixture.awayLabel }
    : SIM_MATCH

  if (all.length && !fixture) {
    return (
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
        Simulation not found. <Link to="/ai-lab" className="text-brand">← AI Lab</Link>
      </div>
    )
  }

  if (!sim) {
    return (
      <div className="space-y-5">
        <Link to="/matches" className="inline-flex items-center gap-1.5 text-xs font-medium text-pitch-300 hover:text-brand">
          <ArrowLeft size={14} /> All matches
        </Link>
        <div className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm leading-relaxed text-pitch-400">
          These exhibitions are played between elevens the tournament picks for itself. They appear
          once the AI positional ratings do, after the first completed matches, and nothing is
          shown here in the meantime.
        </div>
      </div>
    )
  }

  const confidence = sim.cards.find(c => c.key === 'confidence')
  const drivers = sim.cards.filter(c => c.key === 'driver')
  const insights = sim.cards.filter(c => c.key === 'insight')
  const disclosure = sim.cards.find(c => c.key === 'disclosure')

  return (
    <div className="space-y-5">
      <Link to="/matches" className="inline-flex items-center gap-1.5 text-xs font-medium text-pitch-300 hover:text-brand">
        <ArrowLeft size={14} /> All matches
      </Link>

      {/* Sim header */}
      <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-pitch-800 to-pitch-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-brand">
            ✨ {M.statusChip}
          </span>
          <span className="font-mono text-[10px] text-pitch-400">{M.venueLabel}</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="text-left">
            <div className="text-sm font-bold">▸ {M.homeLabel}</div>
            <div className="font-mono text-[10px] text-pitch-400">{sim.result.home.toFixed(1)}% to win</div>
          </div>
          <div className="text-center">
            <div className="font-mono text-3xl font-bold tracking-widest">{sim.score.home}–{sim.score.away}</div>
            <div className="font-mono text-[10px] text-pitch-400">{sim.decider}</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold">{M.awayLabel}</div>
            <div className="font-mono text-[10px] text-pitch-400">{sim.result.away.toFixed(1)}% to win</div>
          </div>
        </div>
        {/* The scoreline is one draw from a distribution, so the distribution
            is printed beside it rather than left implied — and at the one
            precision the app prints a probability at. Rounded to whole numbers
            here, the header said "28% to win" above a legend reading 28.4%:
            the same number, twice, an inch apart. */}
        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-pitch-600">
          <div className="h-full bg-brand" style={{ width: `${sim.result.home}%` }} />
          <div className="h-full bg-pitch-400" style={{ width: `${sim.result.draw}%` }} />
          <div className="h-full bg-emerald-400" style={{ width: `${sim.result.away}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-pitch-400">
          <span>{sim.result.home.toFixed(1)}% {M.homeLabel}</span>
          <span>{sim.result.draw.toFixed(1)}% level</span>
          <span>{sim.result.away.toFixed(1)}% {M.awayLabel}</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SideLineup label={M.homeLabel} coach={M.homeCoach}
          note={fixture?.kind === 'nation'
            ? `picked from every nation except ${fixture.opponentName}`
            : 'top of every Top Performers board'}
          players={sim.home} byCode={byCode} accent="var(--color-brand)" />
        <SideLineup label={M.awayLabel} coach={M.awayCoach}
          note={fixture?.kind === 'nation'
            ? `the eleven ${fixture.opponentName} fielded most`
            : 'emerging players the Best XI did not take'}
          players={sim.away} byCode={byCode} accent="#34d399" />
      </div>

      {confidence && (
        <SimCard title="AI Confidence" icon="✨" accent="#22d3ee">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-bold">{confidence.title}</span>
            <span className="font-mono text-sm font-bold text-brand">{Math.max(sim.result.home, sim.result.away).toFixed(1)}%</span>
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
