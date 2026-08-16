import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton, TierBadge } from '../components/shared'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability } from '../engine/probability.js'
import { useSwipeTabs } from '../components/useSwipeTabs'

// Filters run off the canonical snapshot, so a team's filter, its badge and
// its percentage can never disagree. "Alive" earns its keep once the knockouts
// start and elimination becomes the interesting cut.
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'alive', label: 'Alive', match: (_, out) => !out },
  { id: 'favourites', label: 'Favourites', match: e => e?.classification === 'favourite' },
  { id: 'contenders', label: 'Contenders', match: e => e?.classification === 'contender' },
  { id: 'challengers', label: 'Challengers', match: e => e?.classification === 'challenger' },
  { id: 'dark_horses', label: 'Dark Horses', match: e => e?.classification === 'dark_horse' },
]

export default function TeamsPage() {
  const [params, setParams] = useSearchParams()
  const filterId = FILTERS.some(f => f.id === params.get('filter')) ? params.get('filter') : 'all'
  const filter = FILTERS.find(f => f.id === filterId)

  const teams = useLiveQuery(() => db.teams.toArray(), [])
  const matches = useLiveQuery(() => db.matches.orderBy('kickoffUtc').toArray(), [], [])
  // Same canonical snapshot as every other surface — tier badges here can
  // never disagree with the percentages shown elsewhere.
  const bundle = useOracleBundle(teams ?? [], matches ?? [])

  const setFilter = id => {
    const next = new URLSearchParams(params)
    id === 'all' ? next.delete('filter') : next.set('filter', id)
    setParams(next, { replace: true })
  }

  useSwipeTabs({
    count: FILTERS.length,
    index: FILTERS.findIndex(f => f.id === filterId),
    onChange: i => setFilter(FILTERS[i].id),
  })

  if (teams === undefined) return <Skeleton h={500} />

  const entryOf = code => bundle?.current.get(code) ?? null
  const isOut = code => bundle?.eliminationAt.has(code) ?? false
  const visible = teams.filter(t => filter.match(entryOf(t.code), isOut(t.code)))
  const pools = ['A', 'B', 'C', 'D']

  return (
    <div>
      <div className="mb-4 border-b border-white/5 pb-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">🌍 Teams</h1>
        <p className="mt-1 text-xs text-pitch-400">16 nations · 4 pools · FIH World Rankings</p>
      </div>

      <div className="no-scrollbar sticky top-14 z-30 -mx-4 mb-5 flex gap-1.5 overflow-x-auto border-b border-white/5 bg-pitch-950/90 px-4 py-2 backdrop-blur-xl" role="tablist">
        {FILTERS.map(f => {
          const count = teams.filter(t => f.match(entryOf(t.code), isOut(t.code))).length
          return (
            <button key={f.id} role="tab" aria-selected={filterId === f.id} onClick={() => setFilter(f.id)}
              className={`shrink-0 rounded-md border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                filterId === f.id ? 'border-brand/30 bg-brand/10 text-brand' : 'border-white/5 bg-pitch-800 text-pitch-400'
              }`}>
              {f.label} <span className="font-mono text-[10px] opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 && (
        <p className="rounded-xl border border-white/5 bg-pitch-800 p-4 text-sm text-pitch-400">
          No team is in this band right now — the engine re-classifies after every completed match.
        </p>
      )}

      {pools.map(pool => {
        const inPool = visible.filter(t => t.pool === pool).sort((a, b) => a.fihRank - b.fihRank)
        if (!inPool.length) return null
        return (
          <section key={pool} className="mb-7">
            <h2 className="mb-3 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Pool {pool}</h2>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {inPool.map(t => {
                const entry = entryOf(t.code)
                const out = isOut(t.code)
                return (
                  <Link key={t.code} to={`/teams/${t.code}`}
                    className={`relative overflow-hidden rounded-xl border border-white/5 bg-pitch-800 p-3.5 transition-all hover:-translate-y-0.5 hover:border-brand/25 ${out ? 'opacity-60' : ''}`}>
                    <div className="absolute inset-x-0 top-0 h-0.5 opacity-80" style={{ background: t.color }} />
                    <span className="absolute right-2.5 top-2.5 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand">#{t.fihRank}</span>
                    <div className="mb-1.5 text-4xl">{t.flag}</div>
                    <div className={`text-sm font-bold ${out ? 'line-through' : ''}`}>{t.name}</div>
                    <div className="font-mono text-[10px] text-pitch-400">{t.nickname}</div>
                    <div className="mt-2 flex items-center justify-between gap-1">
                      <TierBadge tier={out ? 'outsider' : entry?.classification} />
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
