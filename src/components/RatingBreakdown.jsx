import { DerivedBadge } from './hockeyIcons'

// Hockey.AI — why a player has the rating he has.
//
// A single number explains nothing. This prints the components the rating was
// actually built from, the score each earned against the other players in that
// position, and the share of the rating each one carried — and it names the
// parts of the model the record cannot feed yet, rather than letting a missing
// input pass as a zero.

function Bar({ score }) {
  const tone = score >= 80 ? 'bg-live' : score >= 55 ? 'bg-brand' : 'bg-pitch-500'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-pitch-700">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(3, score)}%` }} />
    </div>
  )
}

export default function RatingBreakdown({ player, compact = false }) {
  const rows = Object.entries(player.rating_components ?? {})
  if (!rows.length) return null
  const coverage = player.rating_coverage ?? 0
  const missing = player.rating_missing ?? []

  return (
    <div className="rounded-lg border border-white/5 bg-pitch-950/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-widest text-pitch-400">
          {player.rating_group === 'Outfield' ? 'Outfield' : (player.rating_group ?? 'Player')} rating
        </span>
        <DerivedBadge derived />
      </div>

      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-bold text-live">{player.ai_rating}</span>
        <span className="font-mono text-[10px] text-pitch-400">of 100</span>
      </div>

      {/* The rating is what he did, times how much of the tournament he did it
          in, times the standard he did it against — every multiplier printed,
          because a multiplier a reader cannot see is one they have to take on
          trust. */}
      {(player.rating_context || player.rating_playing_time) && (
        <div className="mb-2.5 space-y-1 rounded border border-white/5 bg-pitch-800/60 px-2 py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[10px] text-pitch-300">
              {player.rating_performance} <span className="text-pitch-600">performance</span>
              {player.rating_playing_time && (
                <>{' × '}{player.rating_playing_time.factor} <span className="text-pitch-600">time played</span></>
              )}
              {player.rating_context && (
                <>{' × '}{player.rating_context.factor} <span className="text-pitch-600">context</span></>
              )}
            </span>
          </div>
          {player.rating_playing_time && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[9px] text-pitch-400" title="Starts weighted well above appearances off the bench, ranked against the rest">
                {player.rating_playing_time.label} {player.rating_playing_time.score}
              </span>
            </div>
          )}
          {player.rating_context && (
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-[9px] text-pitch-400" title="His side's points per match, ranked against the rest">
                {player.rating_context.label} {player.rating_context.score}
              </span>
            </div>
          )}
        </div>
      )}

      <ul className="space-y-1.5">
        {rows.map(([key, c]) => (
          <li key={key} className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-[11px] text-pitch-300">{c.label}</span>
            <span className="font-mono text-[10px] text-pitch-400">
              {c.score}
              <span className="text-pitch-600"> · {Math.round(c.weight * 100)}%</span>
            </span>
            <div className="col-span-2"><Bar score={c.score} /></div>
          </li>
        ))}
      </ul>

      {!compact && (
        <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-pitch-400">
          {Math.round(coverage * 100)}% model coverage.
          {missing.length > 0 && ` ${missing.length} component${missing.length === 1 ? '' : 's'} — passing, carrying, tackles, saves — aren't published for this competition.`}
        </p>
      )}
    </div>
  )
}
