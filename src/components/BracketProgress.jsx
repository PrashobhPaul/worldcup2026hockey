import { Link } from 'react-router-dom'
import { buildBracket } from '../engine/bracket'

// Hockey.AI — the medal path, in the shape the FIH's own tournament diagram
// draws it: the four Stage-1 pools at the corners, the two crossover pools
// inside them, the semi-finals below and the final above.
//
// It is a record, not a forecast. Every slot prints the label the diagram
// prints — "1st Pool A", "Winner Semi 1" — and names a nation only where the
// match record settles it. The Oracle's bracket, which is the one that
// carries odds, stays where it is; nothing here predicts anything.

const GOLD = 'var(--color-brand)'

function Chip({ children }) {
  return (
    <span className="inline-block rounded-md bg-brand/15 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-brand ring-1 ring-brand/30">
      {children}
    </span>
  )
}

function Panel({ title, children, className = '' }) {
  return (
    <div className={`rounded-xl border border-brand/20 bg-pitch-800/80 p-3 ${className}`}>
      <div className="mb-2 text-center"><Chip>{title}</Chip></div>
      {children}
    </div>
  )
}

/** One nation on a line: flag, name, and whatever the row is marked with. */
function TeamLine({ code, byCode, label, mark, dim = false, strong = false }) {
  const t = byCode.get(code)
  const body = (
    <span className={`flex min-w-0 flex-1 items-center gap-1.5 ${dim ? 'text-pitch-400' : ''}`}>
      <span className="text-sm leading-none">{t?.flag ?? '·'}</span>
      <span className={`truncate text-[11px] ${strong ? 'font-bold' : 'font-semibold'}`}>
        {t?.name ?? label}
      </span>
    </span>
  )
  return (
    <div className="flex items-center gap-1.5 px-1.5 py-[5px]">
      {mark != null && (
        <span className="w-3.5 shrink-0 text-center font-mono text-[9px] text-brand">{mark}</span>
      )}
      {code ? (
        <Link to={`/teams/${code}`} className="flex min-w-0 flex-1 hover:text-brand">{body}</Link>
      ) : body}
    </div>
  )
}

/** A Stage-1 pool at a corner of the diagram, in final table order. */
function PoolBox({ pool, byCode }) {
  return (
    <Panel title={`Pool ${pool.id}`}>
      <div className="divide-y divide-white/5">
        {pool.rows.map(r => (
          <TeamLine key={r.team} code={r.team} byCode={byCode} mark={r.pos}
            dim={!r.advanced} strong={r.advanced} />
        ))}
      </div>
      <p className="mt-2 px-1.5 font-mono text-[9px] leading-tight text-pitch-400">
        {pool.settled ? 'Top two crossed over' : 'Table not final'}
      </p>
    </Panel>
  )
}

/** A crossover pool: who entered it, and where each of them finished. */
function CrossoverBox({ pool, byCode }) {
  return (
    <Panel title={`Pool ${pool.id}`}>
      <div className="divide-y divide-white/5">
        {pool.entries.map(e => (
          <div key={e.team}>
            <div className="px-1.5 pt-1 font-mono text-[8.5px] uppercase tracking-wider text-pitch-400">
              {e.label}
            </div>
            <TeamLine code={e.team} byCode={byCode} mark={e.pos ?? null}
              dim={pool.complete && e.pos > 2} strong={pool.complete && e.pos <= 2} />
          </div>
        ))}
      </div>
      <p className="mt-2 px-1.5 font-mono text-[9px] leading-tight text-pitch-400">
        {pool.complete ? 'Top two reach the semi-finals' : 'Pool still being played'}
      </p>
    </Panel>
  )
}

/** One tie: two slots, the score if it has been played. */
function Tie({ tie, byCode, accent = false }) {
  if (!tie) return null
  const row = (side, score) => {
    const t = side.team ? byCode.get(side.team) : null
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-4 shrink-0 text-center text-sm leading-none">{t?.flag ?? '·'}</span>
        <span className={`min-w-0 flex-1 truncate text-[11px] ${t ? 'font-bold' : 'font-semibold text-pitch-400'}`}>
          {t?.name ?? side.label}
        </span>
        {t && <span className="shrink-0 font-mono text-[8.5px] text-pitch-400">{side.label}</span>}
        {score != null && <span className="w-4 shrink-0 text-right font-mono text-xs font-bold">{score}</span>}
      </div>
    )
  }
  const body = (
    <div className={`space-y-1 rounded-lg border p-2 ${
      accent ? 'border-brand/40 bg-brand/5' : 'border-white/10 bg-pitch-950/40'}`}>
      {row(tie.home, tie.score?.[0])}
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-white/10" />
        <span className="font-mono text-[8px] uppercase tracking-widest text-pitch-400">vs</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      {row(tie.away, tie.score?.[1])}
    </div>
  )
  return tie.id ? <Link to={`/matches/${tie.id}`} className="block hover:opacity-90">{body}</Link> : body
}

export default function BracketProgress({ teams, matches }) {
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))
  const bracket = buildBracket(teams, matches)
  // An empty store is the client still syncing, not a tournament without a
  // bracket — the page's own sync banner already says so. Only a real record
  // that has not crossed over yet gets the note.
  if (!bracket) {
    if (!(matches ?? []).length || !(teams ?? []).length) return null
    return (
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
        The medal path appears once the pools have crossed over.
      </div>
    )
  }
  const { pools, sides, semis, final, bronze } = bracket
  const [leftPool, rightPool] = pools
  const [leftSide, rightSide] = sides

  const column = side => (
    <div className="flex h-full flex-col justify-between gap-4">
      {side.stage1.map(p => <PoolBox key={p.id} pool={p} byCode={byCode} />)}
    </div>
  )

  return (
    <section className="rounded-2xl border border-brand/15 bg-gradient-to-b from-pitch-900 to-pitch-950 p-4">
      <div className="mb-4 text-center">
        <h2 className="font-display text-base font-semibold tracking-tight" style={{ color: GOLD }}>
          Medal path
        </h2>
        <p className="mt-0.5 font-mono text-[10px] text-pitch-400">
          Where the tournament stands — the record, not a projection
        </p>
      </div>

      {/* The diagram's own arrangement: pools at the corners, the crossover
          pools inside them, the final above and the semi-finals below. Below
          lg the corners cannot exist, so it stacks in the order the
          tournament was played instead. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,2fr)_minmax(0,0.85fr)]">
        <div className="order-2 lg:order-1">{column(leftSide)}</div>

        <div className="order-1 space-y-4 lg:order-2">
          <Panel title="Final">
            <Tie tie={final} byCode={byCode} accent />
          </Panel>

          <div className="grid gap-4 sm:grid-cols-2">
            <CrossoverBox pool={leftPool} byCode={byCode} />
            <CrossoverBox pool={rightPool} byCode={byCode} />
          </div>

          <Panel title="Semi-finals">
            <div className="space-y-2">
              {semis.map(s => <Tie key={s.id} tie={s} byCode={byCode} />)}
            </div>
          </Panel>

          {/* Not on the FIH graphic, which draws the gold path only. It is a
              real match with two real places on it, so it is here rather than
              left for the reader to go looking for. */}
          {bronze && (
            <div>
              <div className="mb-1.5 text-center">
                <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-pitch-400">
                  Bronze medal match
                </span>
              </div>
              <Tie tie={bronze} byCode={byCode} />
            </div>
          )}
        </div>

        <div className="order-3">{column(rightSide)}</div>
      </div>

      <p className="mt-4 text-center font-mono text-[9px] leading-relaxed text-pitch-400">
        Pools {leftSide.stage1.map(p => p.id).join(' and ')} cross into Pool {leftPool.id};
        pools {rightSide.stage1.map(p => p.id).join(' and ')} into Pool {rightPool.id}.
        The sides that finished third and fourth play for the classification places — their
        pools are in the tables below.
      </p>
    </section>
  )
}
