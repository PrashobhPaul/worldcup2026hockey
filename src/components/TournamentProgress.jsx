import { Link } from 'react-router-dom'
import { buildBracket, STATUS } from '../engine/bracket'

// Hockey.AI — the tournament as a left-to-right progression.
//
// The point of this view is the lines. Four pools feed two crossover pools,
// the crossover pools feed two semi-finals, and the semi-finals fork: winners
// right into the Grand Final, losers down into the 3rd-place match. Anyone
// should be able to read that by following a line, without a caption.
//
// So the geometry is explicit rather than emergent. Every node has a known
// box in one fixed coordinate space, connectors are computed from those boxes
// and drawn on a single SVG layer underneath, and the whole canvas is one
// element that scrolls horizontally when the viewport cannot hold it. Nothing
// reflows into a column on a phone: a bracket that stacks is a list again,
// and a list is what this replaces.
//
// It states the record. A slot names a nation only where the result settles
// it; the Oracle keeps the bracket that carries odds.

// ── One coordinate space, in px, for both the nodes and the connectors ─────
const COL = { group: 4, qual: 220, semi: 480, medal: 744 }
const W = { group: 160, qual: 196, semi: 208, medal: 208 }
const H = { group: 112, qual: 152, match: 104 }
const CANVAS = { w: 956, h: 664 }

// Row tops. The gap between the A/D block and the B/C block is what makes the
// two qualification paths read as two paths.
const ROW = {
  groups: { 0: 8, 1: 152, 2: 392, 3: 536 },
  quals: [60, 444],
  semis: [196, 356],
  final: 276,
  bronze: 472,
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = iso => {
  if (!iso) return null
  const [, m, d] = iso.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`.trim()
}

const right = (x, kind) => x + W[kind]
const midY = (top, kind) => top + H[kind] / 2
// Slot centres inside a node, so a connector lands on the row it fills.
const qualSlotY = (top, i) => top + 45 + i * 30
const matchSlotY = (top, i) => top + 47 + i * 34

/** An orthogonal connector: out, across at `midX`, then in. */
function orthPath(from, to, midX, r = 9) {
  if (Math.abs(from.y - to.y) < 0.5) return `M ${from.x} ${from.y} H ${to.x}`
  const dir = to.y > from.y ? 1 : -1
  const radius = Math.min(r, Math.abs(to.y - from.y) / 2, Math.abs(midX - from.x),
    Math.abs(to.x - midX))
  return [
    `M ${from.x} ${from.y}`,
    `H ${midX - radius}`,
    `Q ${midX} ${from.y} ${midX} ${from.y + dir * radius}`,
    `V ${to.y - dir * radius}`,
    `Q ${midX} ${to.y} ${midX + radius} ${to.y}`,
    `H ${to.x}`,
  ].join(' ')
}

const EDGE = {
  feed: { stroke: 'rgba(143,163,209,0.45)', width: 1.5, dash: null, head: 'feed' },
  win: { stroke: 'var(--color-brand)', width: 2, dash: null, head: 'win' },
  lose: { stroke: 'rgba(143,163,209,0.55)', width: 1.5, dash: '4 4', head: 'lose' },
}

function Connectors({ edges }) {
  return (
    <svg className="pointer-events-none absolute inset-0" width={CANVAS.w} height={CANVAS.h}
      viewBox={`0 0 ${CANVAS.w} ${CANVAS.h}`} aria-hidden="true">
      <defs>
        {Object.entries(EDGE).map(([key, e]) => (
          <marker key={key} id={`arrow-${key}`} viewBox="0 0 8 8" refX="7" refY="4"
            markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 7 4 L 0 7 z" fill={e.stroke} />
          </marker>
        ))}
      </defs>
      {edges.map((e, i) => {
        const style = EDGE[e.kind]
        return (
          <path key={i} d={orthPath(e.from, e.to, e.midX)} fill="none"
            stroke={style.stroke} strokeWidth={style.width}
            strokeDasharray={style.dash ?? undefined}
            markerEnd={`url(#arrow-${e.kind})`} />
        )
      })}
      {/* The fork out of each semi-final is the one place the reader has to
          be told which line is which, because both leave the same box. */}
      {edges.filter(e => e.mark).map((e, i) => (
        <g key={`m${i}`}>
          <circle cx={e.from.x + 13} cy={e.from.y + e.mark.dy} r={8}
            fill="var(--color-pitch-950)" stroke={EDGE[e.kind].stroke} strokeWidth="1" />
          <text x={e.from.x + 13} y={e.from.y + e.mark.dy} textAnchor="middle"
            dominantBaseline="central" fontSize="9" fontWeight="700"
            fill={EDGE[e.kind].stroke}>{e.mark.text}</text>
        </g>
      ))}
    </svg>
  )
}

function Box({ x, y, w, h, children, accent = false, className = '' }) {
  return (
    <div style={{ left: x, top: y, width: w, minHeight: h }}
      className={`absolute rounded-xl border bg-pitch-800/95 shadow-lg shadow-black/20 ${
        accent ? 'border-brand/40' : 'border-white/10'} ${className}`}>
      {children}
    </div>
  )
}

function Head({ children, sub, accent = false }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 rounded-t-xl px-2.5 py-1.5 ${
      accent ? 'bg-brand/15' : 'bg-white/5'}`}>
      <span className={`font-mono text-[9px] font-bold uppercase tracking-[0.14em] ${
        accent ? 'text-brand' : 'text-pitch-300'}`}>{children}</span>
      {sub && <span className="font-mono text-[8.5px] text-pitch-400">{sub}</span>}
    </div>
  )
}

function Nation({ code, byCode, fallback, dim, bold }) {
  const t = code ? byCode.get(code) : null
  const body = (
    <>
      <span className="w-4 shrink-0 text-center text-[13px] leading-none">{t?.flag ?? '·'}</span>
      <span className={`min-w-0 flex-1 truncate ${bold ? 'font-bold' : 'font-semibold'} ${
        dim || !t ? 'text-pitch-400' : ''}`}>{t?.name ?? fallback}</span>
    </>
  )
  return code
    ? <Link to={`/teams/${code}`} className="flex min-w-0 flex-1 items-center gap-1.5 hover:text-brand">{body}</Link>
    : <span className="flex min-w-0 flex-1 items-center gap-1.5">{body}</span>
}

/** A Stage-1 pool: the four nations, in final table order. */
function GroupNode({ group, byCode }) {
  return (
    <Box x={COL.group} y={ROW.groups[group.slot]} w={W.group} h={H.group}>
      <Head sub={`${group.played}/${group.total}`}>Group {group.id}</Head>
      <div className="px-1.5 py-1 text-[11px]">
        {group.rows.map(r => (
          <div key={r.team} className="flex items-center gap-1.5 py-[1px]">
            <span className={`w-3 text-center font-mono text-[9px] ${
              r.advanced ? 'text-brand' : 'text-pitch-400'}`}>{r.pos}</span>
            <Nation code={r.team} byCode={byCode} dim={!r.advanced} bold={r.advanced} />
          </div>
        ))}
      </div>
    </Box>
  )
}

/** A crossover pool: four independent slots, each resolved by (pool, place). */
function QualNode({ qual, x, y, byCode }) {
  return (
    <Box x={x} y={y} w={W.qual} h={H.qual}>
      <Head sub={`${qual.played}/${qual.total}`}>Group {qual.id}</Head>
      <div className="px-1.5 py-1">
        {qual.slots.map(s => (
          <div key={s.id} className="flex h-[30px] items-center gap-1.5 text-[11px]">
            <span className="w-[52px] shrink-0 font-mono text-[8px] uppercase leading-tight tracking-wide text-pitch-400">
              {s.label}
            </span>
            <Nation code={s.team} byCode={byCode} fallback="To be decided"
              dim={qual.complete && s.standing > 2} bold={qual.complete && s.standing <= 2} />
            {s.standing != null && (
              <span className={`w-3 shrink-0 text-center font-mono text-[9px] ${
                s.standing <= 2 ? 'text-brand' : 'text-pitch-400'}`}>{s.standing}</span>
            )}
          </div>
        ))}
      </div>
    </Box>
  )
}

/** A tie: two slots, each captioned with where its side comes from. */
function MatchNode({ match, x, y, w, byCode, accent = false }) {
  const row = (slot, score, so) => (
    <div className="flex h-[34px] items-center gap-1.5 text-[11px]">
      <span className="w-[60px] shrink-0 font-mono text-[8px] uppercase leading-tight tracking-wide text-pitch-400">
        {slot.label}
      </span>
      <Nation code={slot.team} byCode={byCode} fallback="—" bold />
      {score != null && (
        <span className="shrink-0 text-right font-mono text-xs font-bold">
          {score}
          {/* A tie level after sixty carries its shoot-out on the board —
              3 (3) over 3 (4) — or the bracket claims a result it cannot name
              a winner for. */}
          {so != null && <span className="text-brand"> ({so})</span>}
        </span>
      )}
    </div>
  )
  const body = (
    <>
      <Head accent={accent} sub={match.score ? (match.shootout ? 'shoot-out' : 'played') : shortDate(match.date)}>{match.title}</Head>
      <div className="px-2 py-0.5">
        {row(match.home, match.score?.[0], match.shootout?.[0])}
        {row(match.away, match.score?.[1], match.shootout?.[1])}
      </div>
    </>
  )
  return (
    <Box x={x} y={y} w={w} h={H.match} accent={accent}>
      {match.id && !match.id.startsWith('GOLD') && !match.id.startsWith('BRZ')
        ? <Link to={`/matches/${match.id}`} className="block hover:opacity-90">{body}</Link>
        : body}
    </Box>
  )
}

export default function TournamentProgress({ teams, matches }) {
  const byCode = new Map((teams ?? []).map(t => [t.code, t]))
  const bracket = buildBracket(teams, matches)
  if (!bracket) {
    if (!(matches ?? []).length || !(teams ?? []).length) return null
    return (
      <div className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
        The medal path appears once the pools have crossed over.
      </div>
    )
  }
  const { qualifiers, semis, final, bronze } = bracket
  const [left, rightQual] = qualifiers

  // Groups are laid out as the two feeding pairs, in draw order: the pools
  // that feed the upper crossover pool first, then the lower.
  const ordered = [
    ...left.feeders.map(id => bracket.groups.find(g => g.id === id)),
    ...rightQual.feeders.map(id => bracket.groups.find(g => g.id === id)),
  ].map((g, i) => ({ ...g, slot: i }))

  const qualY = { [left.id]: ROW.quals[0], [rightQual.id]: ROW.quals[1] }
  const edges = []

  // Pools into their crossover pool, landing on the two rows they fill.
  ordered.forEach((g, i) => {
    const y = qualY[g.feeds]
    const pair = i % 2                       // first or second feeder of that pool
    edges.push({
      kind: 'feed',
      from: { x: right(COL.group, 'group'), y: midY(ROW.groups[i], 'group') },
      to: { x: COL.qual, y: (qualSlotY(y, pair * 2) + qualSlotY(y, pair * 2 + 1)) / 2 },
      midX: (right(COL.group, 'group') + COL.qual) / 2,
    })
  })

  // Crossover pools into the semi-finals: 1E+2F into SF1, 2E+1F into SF2.
  // Each line is routed on its own vertical so two never share a column.
  const semiFeed = [
    { semi: 0, slot: 0, midX: 428, out: 126 },
    { semi: 0, slot: 1, midX: 442, out: 510 },
    { semi: 1, slot: 0, midX: 456, out: 146 },
    { semi: 1, slot: 1, midX: 470, out: 530 },
  ]
  for (const f of semiFeed) {
    edges.push({
      kind: 'feed',
      from: { x: right(COL.qual, 'qual'), y: f.out },
      to: { x: COL.semi, y: matchSlotY(ROW.semis[f.semi], f.slot) },
      midX: f.midX,
    })
  }

  // The fork. Winners right into the final, losers down into third place.
  semis.forEach((s, i) => {
    const out = right(COL.semi, 'semi')
    edges.push({
      kind: 'win',
      mark: { text: 'W', dy: -13 },
      from: { x: out, y: midY(ROW.semis[i], 'match') - 12 },
      to: { x: COL.medal, y: matchSlotY(ROW.final, i) },
      midX: 700,
    })
    edges.push({
      kind: 'lose',
      mark: { text: 'L', dy: 13 },
      from: { x: out, y: midY(ROW.semis[i], 'match') + 12 },
      to: { x: COL.medal, y: matchSlotY(ROW.bronze, i) },
      midX: 716 + i * 12,
    })
  })

  return (
    <section className="rounded-2xl border border-brand/15 bg-gradient-to-b from-pitch-900 to-pitch-950 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-base font-semibold tracking-tight text-brand">
          Tournament progress
        </h2>
        <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-pitch-400">
          <span className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3"
              stroke="var(--color-brand)" strokeWidth="2" /></svg>
            Winner → final
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3"
              stroke="rgba(143,163,209,0.55)" strokeWidth="1.5" strokeDasharray="4 4" /></svg>
            Loser → 3rd place
          </span>
        </div>
      </div>

      {/* One canvas. It scrolls sideways rather than folding into a column,
          because the arrangement is the information. */}
      <div className="relative">
        <div className="no-scrollbar relative -mx-1 overflow-x-auto px-1">
        <div className="relative" style={{ width: CANVAS.w, height: CANVAS.h }}>
          <Connectors edges={edges} />
          {ordered.map(g => <GroupNode key={g.id} group={g} byCode={byCode} />)}
          {qualifiers.map(q => (
            <QualNode key={q.id} qual={q} x={COL.qual} y={qualY[q.id]} byCode={byCode} />
          ))}
          {semis.map((s, i) => (
            <MatchNode key={s.id} match={s} x={COL.semi} y={ROW.semis[i]} w={W.semi} byCode={byCode} />
          ))}
          <MatchNode match={final} x={COL.medal} y={ROW.final} w={W.medal} byCode={byCode} accent />
          <MatchNode match={bronze} x={COL.medal} y={ROW.bronze} w={W.medal} byCode={byCode} />
        </div>
        </div>
        {/* Says there is more canvas to the right without taking a swipe to
            find out. Purely decorative, and never over the scrollbar. */}
        <div aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-pitch-950 to-transparent xl:hidden" />
      </div>

      <p className="mt-2 text-center font-mono text-[9px] text-pitch-400 lg:hidden">
        ← swipe to follow the tournament →
      </p>
      <p className="mt-3 font-mono text-[9px] leading-relaxed text-pitch-400">
        The sides that finished third and fourth in their pools play for the classification
        places — their pools are in the tables below.
      </p>
    </section>
  )
}
