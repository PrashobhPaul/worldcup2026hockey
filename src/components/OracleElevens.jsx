import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Pitch from './Pitch'
import { xiRows } from '../engine/bestXI'
import { eliteTiers, pickSquad, pickRisingSquad, componentRaw } from '../engine/squad'
import { ImpactBadge } from './hockeyIcons'

// Hockey.AI — the two squads the Oracle picks, shared by the Tournament tab
// and the Teams tab's Oracle chip. One computation, one component: a reader
// who has seen this on either page never has to wonder if the other one
// agrees with it.

export function SquadList({ rows, byCode, accent, note, isBench = false }) {
  return (
    <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
      {rows.map(p => (
        <li key={p.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
          <span className="w-24 shrink-0 truncate font-mono text-[9px] font-bold uppercase tracking-wider"
            style={{ color: accent }} title={p.slot.why}>{p.slot.label}</span>
          <span>{byCode.get(p.team)?.flag}</span>
          <Link to={`/teams/${p.team}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-brand">{p.name}</Link>
          {isBench && <ImpactBadge goals={p.impact_sub_goals} />}
          <span className="hidden font-mono text-[10px] text-pitch-400 sm:inline">{note(p)}</span>
          <span className="font-mono text-sm font-bold text-live">{p.ai_rating}</span>
        </li>
      ))}
    </ol>
  )
}

// The figure that won each shirt, printed on the shirt. A team picked by role
// has to say what the role was and what the player did to fill it, or it is
// a leaderboard with position labels stuck on it.
const SLOT_FIGURE = {
  keeper: p => `${componentRaw(p, 'on_pitch_defence')?.toFixed(2)} conceded`,
  battery: p => `${p.pc_scored + p.ps_scored} set-piece goals`,
  anchor: p => `${componentRaw(p, 'on_pitch_defence')?.toFixed(2)} conceded`,
  engine: p => `${p.starts} starts`,
  creator: p => `${p.goals} goals, weighted`,
  talisman: p => `${Math.round((componentRaw(p, 'talisman') ?? 0) * 100)}% of his side`,
  finisher: p => `${p.fg_scored} field goals`,
  bench: p => `${p.starts} starts`,
}
export const figureOf = p => (SLOT_FIGURE[p.slot.key] ?? (x => `${x.starts} starts`))(p)

export default function OracleElevens({ players, byCode, matches, xi, setXi }) {
  const start = useMemo(() => {
    const first = (matches ?? []).reduce((min, m) => (!min || m.date < min ? m.date : min), null)
    return first ? new Date(`${first}T00:00:00Z`) : null
  }, [matches])
  const tiers = useMemo(() => eliteTiers(matches), [matches])
  const best = useMemo(() => pickSquad(players, tiers), [players, tiers])
  const rising = useMemo(
    () => (start ? pickRisingSquad(players, start, tiers) : null), [players, start, tiers])

  const showRising = xi === 'rising' && rising && !rising.shortfall
  const active = showRising ? rising : best
  const accent = showRising ? '#34d399' : 'var(--color-brand)'

  if (!best.xi.length) {
    return <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
      The squad appears once the Player Index lands — after the first completed matches.
    </div>
  }
  const pitch = xiRows(active.xi)

  return (
    <div className="space-y-4">
      {rising && !rising.shortfall && (
        <div className="flex gap-1.5">
          {[['best', '👑', "Tournament's Best XV"], ['rising', '🌱', 'Rising Stars XV']].map(([id, glyph, label]) => (
            <button key={id} onClick={() => setXi(id)}
              className={`rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                (id === 'rising') === showRising
                  ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
              }`}>
              {glyph} {label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-base font-semibold" style={{ color: accent }}>
            {showRising ? '🌱 Rising Stars XI' : "👑 Tournament's Best XI"}
          </h2>
          <p className="mb-2 font-mono text-[10px] leading-relaxed text-pitch-400">
            {showRising
              ? `✨ 1-4-3-3 · aged ${rising.rung.maxAge} or under on the opening day`
              : <>✨ 1-4-3-3 · picked shirt by shirt from the{' '}
                <Link to="/tournament?tab=stats" className="text-brand hover:underline">Player Index</Link>{' '}
                components · {best.semiCount} of 11 from the semi-finalists</>}
          </p>
          <Pitch players={pitch} formation="4-3-3" byCode={byCode} accent={accent} />
        </div>
        <div className="space-y-3">
          <SquadList rows={active.xi} byCode={byCode} accent={accent} note={figureOf} />
          <div>
            <h3 className="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">
              Substitutes
            </h3>
            <SquadList rows={active.bench} byCode={byCode} accent={accent} note={figureOf} isBench />
          </div>
        </div>
      </div>

      <p className="rounded-xl border-l-2 border-white/5 bg-pitch-800 p-3.5 text-xs leading-relaxed text-pitch-300"
        style={{ borderLeftColor: accent }}>
        {showRising
          ? <>Every shirt is filled on the component that defines it, and every player’s age is the
            FIH entry list’s own date of birth. Under-23 from the eight nations still standing is the
            rule this selection wants; the record does not allow it — the whole tournament has
            {' '}{rising.tried[0].field} players aged 22 or under in the top eight, none of them a
            goalkeeper, and only four under-23 defenders anywhere, where an XI needs four. It is
            picked at {rising.rung.maxAge} and under across every nation, which is the first rule that
            can field fifteen.</>
          : <>Not the eleven highest ratings — the eleven shirts. The keeper on his side’s record while
            he was on the pitch, two drag flickers on corners converted, two anchors on goals conceded
            per match started, a match-winner on goals weighted by what they were worth, two engines on
            the matches a coach trusted them with, a talisman on his share of his own side’s scoring
            and two finishers on field goals. Every pick comes from the eight nations that reached the
            crossover pools, and {best.semiCount} of the eleven from the four semi-finalists.</>}
      </p>
      <p className="font-mono text-[10px] leading-relaxed text-pitch-400">
        Recomputed after every completed match. No editorial overrides.
      </p>
    </div>
  )
}
