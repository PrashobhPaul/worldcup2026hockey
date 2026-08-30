import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability } from '../engine/probability.js'
import { AWARDS_STATE, AWARDS_DISCLAIMER, POTM_MODEL, potmScore } from '../content/awards'
import { isAtTournament, roleOf } from '../engine/bestXI'
import { AwardIcon, DerivedBadge } from '../components/hockeyIcons'

/** The one place the race is scored, so every surface reads the same order. */
export function usePotmRace(players, bundle) {
  return useMemo(() => {
    if (!players?.length) return []
    const ctx = { championOf: code => bundle?.current.championOf(code) ?? 0 }
    const scored = players.map(p => ({ ...p, score: potmScore(p, ctx) }))
    const T = POTM_MODEL.softmaxT
    const maxScore = Math.max(...scored.map(p => p.score))
    let z = 0
    for (const p of scored) { p.exp = Math.exp((p.score - maxScore) / T); z += p.exp }
    return scored
      .map(p => ({ ...p, prob: p.exp / z }))
      .sort((a, b) => b.prob - a.prob || a.name.localeCompare(b.name))
  }, [players, bundle])
}

function PotmRace({ byCode, race, bundle, finished }) {
  const [openId, setOpenId] = useState(null)
  const [showAll, setShowAll] = useState(false)

  if (!race.length) return <Skeleton h={400} />
  const top10 = race.slice(0, 10)
  const rest = race.slice(10, 30)

  const row = (p, i) => {
    const t = byCode.get(p.team)
    const open = openId === p.id
    return (
      <li key={p.id} className={i === 0 ? 'border-l-2 border-l-brand' : ''}>
        <button onClick={() => setOpenId(open ? null : p.id)}
          className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-pitch-700/40">
          <span className="w-5 text-center font-mono text-xs font-bold text-pitch-400">{i + 1}</span>
          <span className="text-lg">{t?.flag ?? '🏑'}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{p.name} {i === 0 && '🏆'}</div>
            <div className="font-mono text-[10px] uppercase text-pitch-400">
              {p.team} · {roleOf(p).role ?? 'role not on the record'}
            </div>
          </div>
          <span className="font-mono text-sm font-bold text-brand">{formatProbability(p.prob)}</span>
          <span className={`text-pitch-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        </button>
        {open && (
          <div className="border-t border-white/5 bg-pitch-950/30 p-3.5">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {[
                ['Goals', p.goals],
                ['PC goals', p.pc_scored],
                ['Team odds', formatProbability(bundle?.current.championOf(p.team) ?? 0)],
                ['Score', p.score.toFixed(2)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-pitch-800 p-2">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-pitch-400">{k}</div>
                  <div className="mt-0.5 font-mono text-xs font-bold">{v}</div>
                </div>
              ))}
            </div>
            {p.profile && <p className="mt-2 text-xs leading-relaxed text-pitch-300">{p.profile}</p>}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-brand/20 bg-gradient-to-br from-brand/10 to-pitch-900 p-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand">Oracle Prediction</p>
        <h2 className="mt-1 font-display text-xl font-bold">🏑 Player of the Tournament 2026</h2>
        <div className="mt-2 flex items-center gap-2">
          <span className="rounded bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-400">
            {/* "Live" was true for a fortnight and stopped being true the
                moment the gold final ended. The tournament's own state says
                which it is, so the label cannot be left behind again. */}
            {AWARDS_STATE === 'speculated'
              ? `${finished ? 'Final standing' : 'Live race'} · not the official shortlist`
              : AWARDS_STATE}
          </span>
        </div>
      </div>

      <section>
        <h3 className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400">Oracle Top 10</h3>
        <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
          {top10.map(row)}
        </ol>
      </section>

      {rest.length > 0 && (
        <section>
          <button onClick={() => setShowAll(!showAll)}
            className="mb-2 font-mono text-[11px] font-bold uppercase tracking-widest text-pitch-400 hover:text-brand">
            {showAll ? '▾' : '▸'} Ranks 11–{10 + rest.length}
          </button>
          {showAll && (
            <ol className="divide-y divide-white/5 overflow-hidden rounded-xl border border-white/5 bg-pitch-800">
              {rest.map((p, i) => row(p, i + 10))}
            </ol>
          )}
        </section>
      )}

    </div>
  )
}

/**
 * Awards body — rendered inside the Tournament tab (?tab=awards). The old
 * /awards route redirects here so existing links keep working.
 */
export function AwardsView() {
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const players = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])
  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const byCode = new Map(teams.map(t => [t.code, t]))
  const bundle = useOracleBundle(teams, matches)
  const race = usePotmRace(players, bundle)
  // Every fixture played is what makes this a final standing rather than a race.
  const finished = matches.length > 0 && matches.every(m => m.status === 'completed')
  return (
    <div>
      <p className="mb-4 text-xs text-pitch-400">
        {finished
          ? 'The Player of the Tournament race as it finished, computed from the full match record.'
          : 'The live Player of the Tournament race, computed from the match record.'}
      </p>

      <PotmRace byCode={byCode} race={race} bundle={bundle} finished={finished} />

      <div className="mt-6">
        <Link to="/prediction-race" className="text-xs font-medium text-brand hover:underline">Oracle match record →</Link>
      </div>
    </div>
  )
}

/** /awards → the Tournament tab that now hosts it. */
export default function AwardsRedirect() {
  return <Navigate to="/tournament?tab=awards" replace />
}
