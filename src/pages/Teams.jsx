import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton, TierBadge } from '../components/shared'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability } from '../engine/probability.js'
import { isAtTournament } from '../engine/bestXI'
import OracleElevens from '../components/OracleElevens'
import { useSwipeTabs } from '../components/useSwipeTabs'
import SiblingNav from '../components/SiblingNav'
import { useFavourite } from '../hooks/useFavourite'

// Five cuts. All and Alive are the two ways to read the whole field; the two
// tags between them are earned, not seeded — engine/tiers.js re-derives them
// from the same canonical snapshot every other surface reads, after every
// completed match. The Underdog tag used to sit here too, but its quota is
// one team drawn from the half of the field ranked below the surviving
// median — once that half is entirely eliminated, which happens well before
// the tournament ends, the chip sits at 0 for the rest of it. The chip in its
// place never runs dry: the Oracle's own picks, recomputed after every match.
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'alive', label: 'Alive', match: (_t, ctx) => !ctx.out },
  { id: 'favourites', label: '⭐ Favourites', match: (_t, ctx) => ctx.tier === 'favourite' },
  { id: 'dark_horses', label: '♞ Dark Horses', match: (_t, ctx) => ctx.tier === 'dark_horse' },
  { id: 'oracle', label: "🎯 Oracle's XI", oracle: true, match: () => false },
]

export default function TeamsPage() {
  const [params, setParams] = useSearchParams()
  const filterId = FILTERS.some(f => f.id === params.get('filter')) ? params.get('filter') : 'all'
  const filter = FILTERS.find(f => f.id === filterId)

  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [], [])
  const players = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])
  // Same canonical snapshot as every other surface — tier badges here can
  // never disagree with the percentages shown elsewhere.
  const bundle = useOracleBundle(teams ?? [], matches ?? [])

  const xi = params.get('xi') === 'rising' ? 'rising' : 'best'
  const setXi = v => {
    const next = new URLSearchParams(params)
    next.set('filter', 'oracle')
    v === 'best' ? next.delete('xi') : next.set('xi', v)
    setParams(next, { replace: true })
  }

  const setFilter = id => {
    const next = new URLSearchParams(params)
    id === 'all' ? next.delete('filter') : next.set('filter', id)
    if (id !== 'oracle') next.delete('xi')
    setParams(next, { replace: true })
  }

  useSwipeTabs({
    count: FILTERS.length,
    index: FILTERS.findIndex(f => f.id === filterId),
    onChange: i => setFilter(FILTERS[i].id),
  })

  const favourite = useFavourite()

  if (teams === undefined) return <Skeleton h={500} />

  // One lookup per team, shared by the chip counts, the grid filter and the
  // badge, so a crest can never appear under a chip whose tag it does not show.
  const ctxOf = t => ({
    out: bundle?.eliminationAt.has(t.code) ?? false,
    tier: bundle?.tierOf(t.code) ?? null,
  })
  const visible = teams.filter(t => filter.match(t, ctxOf(t)))

  // Group crests by where teams are playing NOW. Once Stage 2 begins, the
  // crossover pools E–H replace the Stage 1 letters the teams arrived from —
  // a reader mid-tournament should never be sorted by history.
  const stagePool = new Map()
  for (const m of matches) {
    if (m.phase === 'stage2' && m.pool && m.home !== 'TBD') {
      stagePool.set(m.home, m.pool)
      stagePool.set(m.away, m.pool)
    }
  }
  const inStage2 = stagePool.size > 0
  const poolOf = t => (inStage2 && stagePool.get(t.code)) || t.pool
  // Derived, not hardcoded: a team can never vanish from the grid because its
  // pool letter wasn't on a list.
  const pools = [...new Set(visible.map(poolOf))].sort()

  return (
    <div>
      <SiblingNav items={[
        { to: '/teams', label: '🌍 Teams', end: true },
        { to: '/players', label: '👤 Players' },
      ]} />
      <div className="mb-4 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🌍 Teams</h1>
        <p className="mt-1 text-xs text-pitch-400">
          {inStage2 ? '16 nations · Stage 2 crossover pools E–H · FIH World Rankings'
                    : '16 nations · 4 pools · FIH World Rankings'}
        </p>
      </div>

      <div className="no-scrollbar sticky top-14 z-30 -mx-4 mb-5 flex gap-1.5 overflow-x-auto border-b border-white/5 bg-pitch-950/90 px-4 py-2 backdrop-blur-xl" role="tablist">
        {FILTERS.map(f => {
          const count = f.oracle ? null : teams.filter(t => f.match(t, ctxOf(t))).length
          return (
            <button key={f.id} role="tab" aria-selected={filterId === f.id} onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                filterId === f.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
              }`}>
              {f.label} {count != null && <span className="font-mono text-[10px] opacity-70">{count}</span>}
            </button>
          )
        })}
      </div>

      {filterId === 'oracle' && (
        players === undefined
          ? <Skeleton h={400} />
          : <OracleElevens players={players} byCode={new Map(teams.map(t => [t.code, t]))} matches={matches ?? []} xi={xi} setXi={setXi} />
      )}

      {filterId !== 'oracle' && visible.length === 0 && (
        <p className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
          No team carries this tag right now — the engine re-classifies after every completed match.
        </p>
      )}

      {filterId !== 'oracle' && pools.map(pool => {
        const inPool = visible.filter(t => poolOf(t) === pool).sort((a, b) => a.fihRank - b.fihRank)
        if (!inPool.length) return null
        return (
          <section key={pool} className="mb-7">
            <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">
              {inStage2 && 'EFGH'.includes(pool) ? `Stage 2 · Pool ${pool}` : `Pool ${pool}`}
            </h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {inPool.map(t => {
                const { out, tier } = ctxOf(t)
                return (
                  <Link key={t.code} to={`/teams/${t.code}`}
                    className={`relative overflow-hidden rounded-xl border bg-pitch-800 p-3.5 transition-all hover:-translate-y-0.5 hover:border-brand/25 ${
                      favourite === t.code ? 'border-brand/40 ring-1 ring-brand/40' : 'border-white/5'
                    } ${out ? 'opacity-60' : ''}`}>
                    <div className="absolute inset-x-0 top-0 h-0.5 opacity-80" style={{ background: t.color }} />
                    <span className="absolute right-2.5 top-2.5 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand">#{t.fihRank}</span>
                    <div className="mb-1.5 text-4xl">{t.flag}</div>
                    <div className={`text-sm font-bold ${out ? 'line-through' : ''}`}>{t.name}</div>
                    <div className="font-mono text-[10px] text-pitch-400">{t.nickname}</div>
                    <div className="mt-2 flex items-center justify-between gap-1">
                      <TierBadge tier={out ? 'out' : tier} />
                      {bundle && (
                        <span className="font-mono text-[10px] text-pitch-400">
                          {formatProbability(out ? 0 : bundle.current.championOf(t.code))}
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
