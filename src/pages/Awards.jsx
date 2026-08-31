import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { Skeleton } from '../components/shared'
import { useOracleBundle } from '../engine/oracleBundle'
import { formatProbability } from '../engine/probability.js'
import { AWARDS_STATE, AWARDS_DISCLAIMER, HOF_AWARDS, POTM_MODEL, potmScore } from '../content/awards'
import { gradeAwards, racePlacement } from '../engine/awardsOfficial'
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

/**
 * The awards as the FIH announced them, with the Oracle graded beside each.
 *
 * This leads the tab now. For a fortnight the page showed a prediction because
 * a prediction was all there was; the winners exist, so they come first and the
 * prediction is demoted to the thing being marked. Every name here is checked
 * against the official team lists by scripts/test_awards.mjs before it can be
 * built, so a winner who is not in the FIH squad data fails the build rather
 * than reaching this component.
 */
function OfficialAwards({ byCode, race, doc }) {
  const rows = gradeAwards(doc, HOF_AWARDS)
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
          The winners, and how the Oracle did against each. Two separate claims are marked: the pick
          locked before a ball was hit, and where the live race — the number this page showed all
          fortnight — actually placed the winner.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map(a => {
          const place = a.key === 'best_player' ? racePlacement(race, a.winner) : null
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

              {/* The grade. A miss is printed exactly as plainly as a hit. */}
              {a.oraclePick && (
                <div className="mt-3 rounded-lg border border-white/5 bg-pitch-950/40 p-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-mono text-[10px] font-bold uppercase tracking-widest ${
                      a.called ? 'text-live' : 'text-pitch-400'}`}>
                      {a.called ? '✓ Oracle called it' : '✗ Oracle picked'}
                    </span>
                  </div>
                  {!a.called && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span>{flag(a.oraclePickTeam)}</span>
                      <span className="text-xs text-pitch-300">{a.oraclePick}</span>
                    </div>
                  )}
                  <p className="mt-1 font-mono text-[9px] leading-relaxed text-pitch-500">
                    locked before the tournament, unedited since
                  </p>
                </div>
              )}

              {place && (
                <p className="mt-2 font-mono text-[10px] leading-relaxed text-pitch-400">
                  {place.calledIt
                    ? `The live race led with ${a.display} too.`
                    : `The live race placed ${a.display} ${ordinal(place.rank)}, behind ${place.leader.name}.`}
                </p>
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

      {doc?.provenance?.note && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3.5 text-[11px] leading-relaxed text-pitch-300">
          <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-amber-400">
            On sourcing ·{' '}
          </span>
          {doc.provenance.note}
        </p>
      )}
    </div>
  )
}

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
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
  const awardsDoc = useLiveQuery(() => db.meta.get('awards'), [])
  const byCode = new Map(teams.map(t => [t.code, t]))
  const bundle = useOracleBundle(teams, matches)
  const race = usePotmRace(players, bundle)
  // Every fixture played is what makes this a final standing rather than a race.
  const finished = matches.length > 0 && matches.every(m => m.status === 'completed')
  // Announced awards outrank a model's guess at them, so they lead the tab and
  // the race becomes the thing being marked rather than the headline.
  const official = (awardsDoc?.awards ?? []).some(a => a.winner)

  return (
    <div className="space-y-6">
      {official && <OfficialAwards byCode={byCode} race={race} doc={awardsDoc} />}

      <div>
        <p className="mb-4 text-xs text-pitch-400">
          {official
            ? 'Below is the Oracle’s own Player of the Tournament race, left exactly as it finished. It is kept because the app publishes what its model said, not only where the model was right.'
            : finished
              ? 'The Player of the Tournament race as it finished, computed from the full match record.'
              : 'The live Player of the Tournament race, computed from the match record.'}
        </p>

        <PotmRace byCode={byCode} race={race} bundle={bundle} finished={finished} />
      </div>

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
