import { Link } from 'react-router-dom'
import { teamKeyPlayers } from '../engine/impact'
import { LINES } from '../engine/bestXI'
import { DerivedBadge } from './hockeyIcons'

// Hockey.AI — who decides this for each side.
//
// Four questions, each answered by a name and the figure that answers it: who
// carries the scoring, who takes the corners, who is rated highest in his line
// and who is in goal. One player often answers several — the man on the
// corners is usually the man carrying the scoring — and when he does, the card
// says so rather than handing the next question to somebody with one goal.
//
// Everything on the card is countable from the official record. The share bar
// is the talisman measure: this player's goals against everything his side has
// scored, which is the difference between a forward who is his team's attack
// and one who is a passenger in it.

function ShareBar({ pct }) {
  return (
    <div className="mt-1.5">
      <div className="h-1 overflow-hidden rounded-full bg-pitch-700">
        <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="mt-1 font-mono text-[9px] text-brand">{pct}% of the side&apos;s goals</div>
    </div>
  )
}

function KeyPlayerBody({ card, flag }) {
  const p = card.impact.player
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        {card.labels.map(l => (
          <span key={l} className="rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-wider text-brand">
            {l}
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-sm leading-none">{flag ?? '🏑'}</span>
        <Link to={`/players?team=${p.team}`} className="min-w-0 flex-1 truncate text-xs font-bold hover:text-brand">
          {p.name}
        </Link>
        {card.impact.role && (
          <span className="shrink-0 rounded bg-pitch-700 px-1 py-0.5 font-mono text-[8px] uppercase text-pitch-300">
            {LINES.find(l => l.role === card.impact.role)?.short ?? card.impact.role}
          </span>
        )}
      </div>
      <div className="mt-0.5 font-mono text-[9.5px] leading-relaxed text-pitch-300">
        {card.stats.join(' · ')}
      </div>
      {card.share != null && <ShareBar pct={card.share} />}
    </>
  )
}

export function KeyPlayerCard({ card, flag }) {
  return (
    <li className="rounded-lg border border-white/5 bg-pitch-800 p-2.5">
      <KeyPlayerBody card={card} flag={flag} />
    </li>
  )
}

/** Same card, meant to sit inside one shared outer card instead of carrying its own border. */
export function KeyPlayerRow({ card, flag }) {
  return (
    <li className="px-3.5 py-2.5">
      <KeyPlayerBody card={card} flag={flag} />
    </li>
  )
}

/** One side's key players. */
export function KeyPlayerList({ squad, ctx, flag, limit }) {
  const cards = teamKeyPlayers(squad, ctx, limit ? { limit } : undefined)
  if (!cards.length) return null
  return <ul className="space-y-2">{cards.map(c => <KeyPlayerCard key={c.key} card={c} flag={flag} />)}</ul>
}

/** Both sides of a fixture, side by side. */
export default function KeyPlayers({ home, away, players, ctx, byCode }) {
  const squad = code => (players ?? []).filter(p => p.team === code)
  const side = code => ({ code, team: byCode.get(code), squad: squad(code) })
  const sides = [side(home), side(away)].filter(s => s.squad.length)
  if (sides.length < 2) return null
  return (
    <div>
      <h3 className="mb-2.5 flex items-baseline justify-between font-display text-sm font-semibold">
        Key players
        <span className="flex items-center gap-2 font-mono text-[10px] font-normal text-pitch-400">
          from this World Cup only <DerivedBadge derived />
        </span>
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {sides.map(s => (
          <div key={s.code}>
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="text-base leading-none">{s.team?.flag ?? '🏑'}</span>
              <Link to={`/teams/${s.code}`} className="text-xs font-bold hover:text-brand">
                {s.team?.name ?? s.code}
              </Link>
            </div>
            <KeyPlayerList squad={s.squad} ctx={ctx} flag={s.team?.flag} />
          </div>
        ))}
      </div>
    </div>
  )
}
