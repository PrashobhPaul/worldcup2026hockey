import { useState } from 'react'
import { Link } from 'react-router-dom'
import { rowsFromFormation } from './Pitch'

// Goal method chips, using the abbreviations FIH match reports use:
// FG field goal · PC penalty corner · PS penalty stroke.
const VIA_LABEL = { PC: 'PC', PS: 'PS' }
const viaOf = ev => VIA_LABEL[ev.via] ?? 'FG'

/** Everything a single player did in this match, from the event ledger. */
function playerEvents(events, name) {
  if (!name) return { goals: [], cards: [] }
  const mine = events.filter(e => e.player && e.player === name)
  return {
    goals: mine.filter(e => e.type === 'goal').map(e => ({ minute: e.minute, via: viaOf(e) })),
    cards: mine.filter(e => e.type?.endsWith('_card')).map(e => ({ minute: e.minute, type: e.type })),
  }
}

// "Seve van Ass" -> "van Ass", "Thierry Brinkman" -> "Brinkman". Dropping the
// particle turns a Dutch or Spanish surname into a different word entirely.
const PARTICLES = new Set(['van', 'van der', 'van den', 'de', 'del', 'der', 'den',
  'dos', 'da', 'di', 'le', 'la', 'du', 'ter'])

export function shortName(full) {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full
  for (let take = 3; take >= 2; take--) {
    if (parts.length >= take) {
      const particle = parts.slice(-take, -1).join(' ').toLowerCase()
      if (PARTICLES.has(particle)) return parts.slice(-take).join(' ')
    }
  }
  return parts[parts.length - 1]
}

const CARD_STYLE = {
  green_card: 'bg-live/15 text-live',
  yellow_card: 'bg-yellow-400/15 text-yellow-300',
  red_card: 'bg-red-500/20 text-red-300',
}

function GoalChips({ goals }) {
  if (!goals.length) return null
  return (
    <>
      {goals.map((g, i) => (
        <span key={i} className="rounded bg-live/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-live">
          {g.via} {g.minute}&apos;
        </span>
      ))}
    </>
  )
}

function CardChips({ cards }) {
  return cards.map((c, i) => (
    <span key={i} className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${CARD_STYLE[c.type] ?? ''}`}>
      {c.type === 'green_card' ? 'G' : c.type === 'yellow_card' ? 'Y' : 'R'} {c.minute}&apos;
    </span>
  ))
}

/** Numbered shirts laid out on the pitch, hockey formation. */
function LineupPitch({ side, events, color }) {
  const rows = rowsFromFormation(
    side.startingXI.map(p => ({ ...p, pos: p.goalkeeper ? 'GK' : 'OUT' })),
    side.formation || '4-3-3',
  )
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0e3a6e] via-[#0b2f5c] to-[#082347]">
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

      <span className="absolute right-3 top-2.5 font-mono text-[10px] font-bold tracking-widest text-white/60">
        {(side.formation || '4-3-3').split('').join(' ')}
      </span>

      <div className="absolute inset-0 flex flex-col-reverse justify-around py-4">
        {rows.map((row, ri) => (
          <div key={ri} className="flex justify-around">
            {row.map(p => {
              const { goals, cards } = playerEvents(events, p.name)
              return (
                <div key={p.playerId ?? p.name} className="flex w-16 flex-col items-center gap-0.5">
                  <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-pitch-950/85 font-mono text-xs font-bold text-white ring-2"
                    style={{ '--tw-ring-color': color }}>
                    {p.number ?? '–'}
                    {p.captain && (
                      <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand font-mono text-[8px] font-bold text-black">C</span>
                    )}
                    {goals.length > 0 && (
                      <span className="absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-live font-mono text-[9px] font-bold text-black"
                        title={goals.map(g => `${g.via} ${g.minute}'`).join(' · ')}>
                        {goals.length}
                      </span>
                    )}
                    {cards.length > 0 && (
                      <span className={`absolute -bottom-1 -right-1 h-3 w-2 rounded-[2px] ${
                        cards.some(c => c.type === 'red_card') ? 'bg-red-500'
                          : cards.some(c => c.type === 'yellow_card') ? 'bg-yellow-400' : 'bg-live'
                      }`} />
                    )}
                  </span>
                  <span className="max-w-full truncate text-center text-[9px] font-semibold leading-tight text-white/90">
                    {shortName(p.name)}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function PlayerRow({ p, events, sub }) {
  const { goals, cards } = playerEvents(events, p.name)
  return (
    <li className="flex items-center gap-2.5 px-3.5 py-2">
      <span className="w-6 shrink-0 text-center font-mono text-[11px] text-pitch-400">{p.number ?? '–'}</span>
      {p.playerId
        ? <Link to={`/players?player=${p.playerId}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-brand">{p.name}</Link>
        : <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.name}</span>}
      {p.captain && <span className="rounded bg-brand/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand">C</span>}
      {p.goalkeeper && <span className="rounded bg-sky-400/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">GK</span>}
      {sub && p.onAt && (
        <span className="font-mono text-[10px] text-live">↑ {p.onAt}</span>
      )}
      <GoalChips goals={goals} />
      <CardChips cards={cards} />
    </li>
  )
}

/**
 * Match team sheet — pitch view plus the full list, per team.
 * Official FIH sheets are shown as official; anything the engine composed from
 * the known squad says so, and a team with no publishable sheet says that
 * plainly rather than inventing names.
 */
export default function LineupSheet({ match, events = [], home, away }) {
  const [side, setSide] = useState('home')
  const lineups = match.lineups
  const teams = { home, away }

  if (!lineups?.home || !lineups?.away) {
    return (
      <section className="rounded-xl border border-white/5 bg-pitch-800 p-4">
        <h2 className="font-display text-lg font-semibold">Line-ups</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-pitch-400">
          The team sheets for this match are not published yet. Hockey.AI shows official FIH
          team lists as soon as the match report carries them, and never fills a pitch with
          invented names in the meantime.
        </p>
      </section>
    )
  }

  const active = lineups[side]
  const team = teams[side]
  const official = lineups.source === 'official' || lineups.source === 'manual'
  // Between "we made this up" and "FIH published it" sits the real case: every
  // name is off the official team list, and only the eleven who start is ours.
  const listed = !official && lineups.home.fromTeamList && lineups.away.fromTeamList

  return (
    <section className="rounded-xl border border-white/5 bg-pitch-800 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Line-ups</h2>
        <span className={`font-mono text-[10px] uppercase tracking-widest ${
          official ? 'text-live' : listed ? 'text-brand' : 'text-pitch-400'}`}>
          {official ? 'Confirmed · FIH team list'
            : listed ? 'Official squad · estimated XI'
              : 'Estimated · engine team sheet'}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-1.5" role="tablist">
        {['home', 'away'].map(s => (
          <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)}
            className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
              side === s ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-950/40 text-pitch-400'
            }`}>
            <span>{teams[s]?.flag}</span>
            <span>{teams[s]?.name ?? match[s]}</span>
          </button>
        ))}
      </div>

      <LineupPitch side={active} events={events} color={team?.color ?? 'var(--color-brand)'} />

      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Starting XI</h3>
          <span className="rounded bg-pitch-700 px-1.5 py-0.5 font-mono text-[10px] text-pitch-300">{active.startingXI.length}</span>
        </div>
        <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-950/30">
          {active.startingXI.map(p => <PlayerRow key={p.playerId ?? p.name} p={p} events={events} />)}
        </ul>
      </div>

      {active.substitutes?.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-baseline justify-between">
            <h3 className="font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Substitutes</h3>
            <span className="rounded bg-pitch-700 px-1.5 py-0.5 font-mono text-[10px] text-pitch-300">{active.substitutes.length}</span>
          </div>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-950/30">
            {active.substitutes.map(p => <PlayerRow key={p.playerId ?? p.name} p={p} events={events} sub />)}
          </ul>
          <p className="mt-1.5 font-mono text-[10px] text-pitch-400">
            Hockey uses rolling substitutions — players come on and off repeatedly; the time shown is first entry.
          </p>
        </div>
      )}

      {active.coach && (
        <div className="mt-4">
          <h3 className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Team staff</h3>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-950/30">
            <li className="flex items-center gap-2.5 px-3.5 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{active.coach}</span>
              <span className="rounded bg-pitch-700 px-1.5 py-0.5 font-mono text-[10px] text-pitch-300">Coach</span>
            </li>
          </ul>
        </div>
      )}

      {!official && (
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-pitch-400">
          {listed
            ? 'Every player named here is on the official FIH entry list for this squad. Which eleven of them start is Hockey.AI’s call — ranked on caps, form and AI rating, deterministic per match. It is replaced by the official team sheet the moment FIH publishes one.'
            : 'Composed from the squad Hockey.AI holds for each nation — real players only, deterministic per match. It is replaced by the official team list the moment FIH publishes one.'}
        </p>
      )}
    </section>
  )
}
