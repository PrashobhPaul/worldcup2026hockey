import { Link } from 'react-router-dom'
import { bestXI } from '../engine/bestXI'
import { DerivedBadge } from './hockeyIcons'

// Hockey.AI — a squad's best XI, drawn in the shape hockey is played in.
//
// The shirts are placed by role, never by rating alone: the back four is the
// back four. A shirt whose player the record gives no role to says so on its
// face rather than passing itself off as a defender.

function Shirt({ slot, teamColor, label }) {
  const p = slot.player
  const surname = label ?? p.name.split(' ').slice(-1)[0]
  return (
    <div className="flex w-[4.4rem] flex-col items-center gap-0.5">
      <span
        className={`relative flex h-9 w-9 items-center justify-center rounded-full font-mono text-[11px] font-bold ring-2 ${
          slot.offRole ? 'bg-pitch-950/60 text-pitch-400 ring-dashed' : 'bg-pitch-950/85 text-white'
        }`}
        style={{ '--tw-ring-color': slot.offRole ? 'rgba(255,255,255,.18)' : teamColor }}
        title={slot.offRole ? 'Role not on the record' : undefined}>
        {p.number ?? '—'}
        {p.is_captain && (
          <span className="absolute -right-1 -top-1 rounded-full bg-brand px-1 font-mono text-[7px] font-bold text-pitch-950">C</span>
        )}
      </span>
      <span className="max-w-full truncate text-center text-[9px] font-semibold leading-tight text-white/90">
        {surname}
      </span>
      {p.ai_rating != null && (
        <span className={`font-mono text-[8px] font-bold ${slot.offRole ? 'text-pitch-500' : 'text-live'}`}>
          {p.ai_rating}
        </span>
      )}
    </div>
  )
}

/**
 * Shirt labels. A surname is enough until two players share it — India field
 * five Singhs, and five shirts reading "Singh" name nobody. Where a surname
 * repeats, the given name joins it.
 */
function shirtLabels(slots) {
  const surnameOf = p => p.name.split(' ').slice(-1)[0]
  const counts = new Map()
  for (const s of slots) counts.set(surnameOf(s.player), (counts.get(surnameOf(s.player)) ?? 0) + 1)
  const labels = new Map()
  for (const s of slots) {
    const parts = s.player.name.split(' ')
    const surname = parts.slice(-1)[0]
    labels.set(s.player.id,
      counts.get(surname) > 1 && parts.length > 1 ? `${parts[0]} ${surname}` : surname)
  }
  return labels
}

export default function BestElevenPitch({ squad, teamColor = 'var(--color-brand)' }) {
  const xi = bestXI(squad)
  if (xi.size < 11) return null
  const labels = shirtLabels(xi.lines.flatMap(l => l.slots))

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0e3a6e] via-[#0b2f5c] to-[#082347]">
        <svg viewBox="0 0 300 400" className="absolute inset-0 h-full w-full opacity-30"
          fill="none" stroke="#8fd0ff" strokeWidth="1.5" aria-hidden="true">
          <rect x="8" y="8" width="284" height="384" rx="4" />
          <line x1="8" y1="200" x2="292" y2="200" />
          <line x1="8" y1="104" x2="292" y2="104" strokeDasharray="6 5" />
          <line x1="8" y1="296" x2="292" y2="296" strokeDasharray="6 5" />
          <path d="M 86 392 A 64 64 0 0 1 214 392" />
          <path d="M 86 8 A 64 64 0 0 0 214 8" />
          <rect x="126" y="384" width="48" height="8" />
          <rect x="126" y="8" width="48" height="8" />
        </svg>
        <div className="relative flex aspect-[3/4] flex-col-reverse justify-around py-3">
          {xi.lines.map(line => (
            <div key={line.role} className="flex justify-around">
              {line.slots.map(slot => (
                <Shirt key={slot.player.id} slot={slot} teamColor={teamColor}
                  label={labels.get(slot.player.id)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-pitch-400">
        <span>{xi.formation}</span>
        <span>·</span>
        <span>{xi.officialCount} role{xi.officialCount === 1 ? '' : 's'} stated by the FIH</span>
        <span>·</span>
        <span>{xi.derivedCount} derived by Hockey.AI</span>
        {xi.unplacedCount > 0 && (
          <>
            <span>·</span>
            <span className="text-pitch-500">
              {xi.unplacedCount} shirt{xi.unplacedCount === 1 ? '' : 's'} the record gives no role to (dashed)
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/** The rest of the squad, under the pitch, ordered by the same index. */
export function RemainingSquad({ squad, teamCode }) {
  const xi = bestXI(squad)
  if (!xi.bench.length) return null
  return (
    <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
      {xi.bench.map(p => (
        <li key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
          <span className="w-7 shrink-0 rounded bg-pitch-700 px-1.5 py-0.5 text-center font-mono text-[10px] text-pitch-300">
            {p.number ?? '—'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold">
              {p.name}
              {p.is_captain && <span className="ml-1.5 text-brand">Ⓒ</span>}
            </div>
            <div className="font-mono text-[9px] uppercase tracking-wide text-pitch-400">
              {p.position_effective ?? 'Role not on the record'}
              {p.goals ? ` · ${p.goals}G` : ''}
              {p.pc_scored ? ` · ${p.pc_scored} PC` : ''}
            </div>
          </div>
          {p.ai_rating != null && (
            <span className="font-mono text-[11px] font-bold text-pitch-300">{p.ai_rating}</span>
          )}
        </li>
      ))}
    </ol>
  )
}

/** Departmental leaders for one nation. */
export function TeamToppers({ rows, teamFlag }) {
  if (!rows?.length) return null
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(r => (
        <div key={r.key} className="rounded-xl border border-white/5 bg-pitch-800 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{r.label}</span>
            <DerivedBadge derived={r.derived} />
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-sm leading-none">{teamFlag ?? '🏑'}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-bold">{r.player.name}</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-brand">{r.stat}</div>
        </div>
      ))}
    </div>
  )
}

/** One row of a results card — the scoreline, deeplinked to the match. */
export function ScoreRow({ match, teamCode, byCode }) {
  // Every match at this World Cup is played at a neutral ground, so there is
  // no home side to name: the fixture list's home/away is a listing order.
  const isHome = match.home === teamCode
  const opp = isHome ? match.away : match.home
  const us = isHome ? match.score?.home : match.score?.away
  const them = isHome ? match.score?.away : match.score?.home
  const outcome = us > them ? 'W' : us < them ? 'L' : 'D'
  const tone = outcome === 'W' ? 'bg-live/15 text-live'
    : outcome === 'L' ? 'bg-red-400/15 text-red-400' : 'bg-pitch-700 text-pitch-300'
  return (
    <li>
      <Link to={`/matches/${match.id}`}
        className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-pitch-700/40">
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[10px] font-bold ${tone}`}>
          {outcome}
        </span>
        <span className="text-base leading-none">{byCode?.get(opp)?.flag ?? '🏑'}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">
            v {byCode?.get(opp)?.name ?? opp}
          </div>
          <div className="font-mono text-[9px] text-pitch-400">
            {match.label || match.id} · {match.date}
          </div>
        </div>
        <span className="font-mono text-sm font-bold tracking-wider">{us}–{them}</span>
        <span className="text-pitch-400">›</span>
      </Link>
    </li>
  )
}
