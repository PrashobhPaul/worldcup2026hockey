// Hockey.AI — shared XI pitch renderer (sim page + Tournament's Best space).
// The one place lineups are drawn, mirroring Soccer.AI's PitchLineup role.

export function rowsFromFormation(players, formation) {
  const gk = players.filter(p => p.pos === 'GK')
  const outfield = players.filter(p => p.pos !== 'GK')
  const segs = formation.split('-').map(Number)
  const rows = [gk]
  let i = 0
  for (const n of segs) { rows.push(outfield.slice(i, i + n)); i += n }
  return rows
}

export default function Pitch({ players, formation, byCode, accent }) {
  const rows = rowsFromFormation(players, formation)
  return (
    <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#0e3a6e] via-[#0b2f5c] to-[#082347]">
      {/* Hockey pitch markings */}
      <svg viewBox="0 0 300 400" className="absolute inset-0 h-full w-full opacity-30" fill="none" stroke="#8fd0ff" strokeWidth="1.5">
        <rect x="8" y="8" width="284" height="384" rx="4" />
        <line x1="8" y1="200" x2="292" y2="200" />
        <line x1="8" y1="104" x2="292" y2="104" strokeDasharray="6 5" />
        <line x1="8" y1="296" x2="292" y2="296" strokeDasharray="6 5" />
        <path d="M 86 392 A 64 64 0 0 1 214 392" />
        <path d="M 86 8 A 64 64 0 0 0 214 8" />
        <rect x="126" y="384" width="48" height="8" />
        <rect x="126" y="8" width="48" height="8" />
      </svg>
      <div className="absolute inset-0 flex flex-col-reverse justify-around py-3">
        {rows.map((row, ri) => (
          <div key={ri} className="flex justify-around">
            {row.map(p => (
              <div key={p.player} className="flex w-16 flex-col items-center gap-0.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-pitch-950/80 text-lg ring-2"
                  style={{ '--tw-ring-color': accent }}>
                  {byCode.get(p.nat)?.flag ?? '🏑'}
                </span>
                <span className="max-w-full truncate text-center text-[9px] font-semibold leading-tight text-white/90">
                  {p.player.split(' ').slice(-1)[0]}
                </span>
                {p.rating != null && (
                  <span className="font-mono text-[8px] font-bold text-live">{p.rating}</span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
