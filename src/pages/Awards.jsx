import { useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { appNamed, compareAwards } from '../engine/awardsOfficial'
import { isAtTournament } from '../engine/bestXI'

/**
 * The awards as the FIH announced them, with this app's own name beside each.
 *
 * The second column is a measurement, not a forecast: this app names an award
 * winner from the finished record, and the basis is printed under every name so
 * a reader can check it.
 *
 * Every winner is checked against the official team lists by
 * scripts/test_awards.mjs before this can be built.
 */
function OfficialAwards({ byCode, doc, players, matches }) {
  // The rising-star pool is age-relative, so it needs the day the tournament
  // began. Read off the earliest fixture, exactly as OracleElevens does, so
  // the two cannot disagree about who counts as rising.
  const startDate = useMemo(() => {
    const first = (matches ?? []).reduce((min, m) => (!min || m.date < min ? m.date : min), null)
    return first ? new Date(`${first}T00:00:00Z`) : null
  }, [matches])
  const named = useMemo(
    () => appNamed({ players, matches, startDate }), [players, matches, startDate])
  const rows = compareAwards(doc, named)
  if (!rows.length) return null
  const flag = code => byCode.get(code)?.flag ?? '🏑'

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-400/10 to-pitch-900 p-5">
        <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-amber-400">
          Official · announced by the FIH
        </p>
        <h2 className="mt-1 font-display text-xl font-bold">🏅 The awards of 2026</h2>
        <p className="mt-2 text-xs leading-relaxed text-pitch-300">
          The winners, with the name this app&apos;s own stats give each award beside it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(a => {
          return (
            <div key={a.key} className="rounded-xl border border-white/5 bg-pitch-800 p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-pitch-400">
                {a.label}
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-xl">{flag(a.team)}</span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{a.display}</div>
                  {/* A team award names the nation and nothing else. Printing
                      "Spain / Spain" underneath was the first draft. */}
                  <div className="font-mono text-[10px] text-pitch-400">
                    {a.kind === 'team'
                      ? `${a.cards} cards — fewest of the sixteen`
                      : (byCode.get(a.team)?.name ?? a.team)}
                    {a.goals != null && ` · ${a.goals} goals`}
                  </div>
                </div>
              </div>
              {a.note && <p className="mt-2 text-xs leading-relaxed text-pitch-300">{a.note}</p>}

              {/* What this app's own stats name, and the basis for it. */}
              {a.ours && (
                <div className="mt-3 rounded-lg border border-white/5 bg-pitch-950/40 p-2.5">
                  <span className={`font-mono text-[10px] font-bold uppercase tracking-widest ${
                    a.agrees ? 'text-live' : 'text-pitch-400'}`}>
                    {a.agrees ? '✓ Hockey.AI names the same' : 'Hockey.AI names'}
                  </span>
                  {!a.agrees && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span>{flag(a.ours.team)}</span>
                      <span className="text-xs text-pitch-300">
                        {a.ours.teamRow ? (byCode.get(a.ours.team)?.name ?? a.ours.team) : a.ours.name}
                      </span>
                    </div>
                  )}
                  <p className="mt-1 font-mono text-[9px] leading-relaxed text-pitch-500">
                    {a.ours.basis}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(doc?.notAnnounced ?? []).map(n => (
        <p key={n.key} className="rounded-xl border border-white/5 bg-pitch-800 p-3 text-[11px] text-pitch-400">
          <strong className="text-pitch-300">{n.label}:</strong> {n.reason}
        </p>
      ))}
    </div>
  )
}

/**
 * Awards body — rendered inside the Tournament tab (?tab=awards). The old
 * /awards route redirects here so existing links keep working.
 *
 * The tab is the announced awards and nothing else. It used to carry a
 * second, model-scored "Player of the Tournament race" underneath them,
 * which measured a different thing under a similar name and, once the FIH
 * had announced the real award, only competed with it.
 */
export function AwardsView() {
  const teams = useLiveQuery(() => db.teams.toArray(), [], [])
  const players = useLiveQuery(
    () => db.players.toArray().then(rows => rows.filter(isAtTournament)), [], [])
  const matches = useLiveQuery(() => db.matches.toArray(), [], [])
  const awardsDoc = useLiveQuery(() => db.meta.get('awards'), [])
  const byCode = new Map(teams.map(t => [t.code, t]))
  const official = (awardsDoc?.awards ?? []).some(a => a.winner)

  return (
    <div className="space-y-6">
      {official ? (
        <OfficialAwards byCode={byCode} doc={awardsDoc} players={players} matches={matches} />
      ) : (
        <p className="rounded-xl border border-white/5 bg-pitch-800 p-5 text-sm text-pitch-400">
          The awards appear here once the FIH announces them, after the gold medal match.
        </p>
      )}

      <div>
        <Link to="/prediction-race" className="text-xs font-medium text-brand hover:underline">Oracle match record →</Link>
      </div>
    </div>
  )
}

/** /awards → the Tournament tab that now hosts it. */
export default function AwardsRedirect() {
  return <Navigate to="/tournament?tab=awards" replace />
}
