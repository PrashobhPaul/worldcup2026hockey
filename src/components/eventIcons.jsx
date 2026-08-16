// Hockey.AI — timeline & stat icons.
// Soccer.AI's timeline PNGs live on its host CDN; the honour/board PNGs are
// vendored in src/assets (same files as Soccer.AI). Event glyphs are inline
// SVG drawn to match that set's look: filled disc, bold white glyph.

export function GoalIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Goal">
      <circle cx="12" cy="12" r="11" fill="#16a34a" />
      <circle cx="12" cy="12" r="5.5" fill="#fff" />
      <path d="M12 8.6l1.1 2.2 2.4.3-1.75 1.7.4 2.4L12 14.1l-2.15 1.1.4-2.4-1.75-1.7 2.4-.3z" fill="#16a34a" />
    </svg>
  )
}

export function PCIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Penalty corner">
      <circle cx="12" cy="12" r="11" fill="#dc2626" />
      <text x="12" y="16" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontWeight="700" fontSize="9.5" fill="#fff">PC</text>
    </svg>
  )
}

export function PSIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Penalty stroke">
      <circle cx="12" cy="12" r="11" fill="#7c3aed" />
      <circle cx="12" cy="9" r="3" fill="#fff" />
      <rect x="10.9" y="12.5" width="2.2" height="6.5" rx="1.1" fill="#fff" />
    </svg>
  )
}

export function ShootoutIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Shootout">
      <circle cx="12" cy="12" r="11" fill="#0ea5e9" />
      <text x="12" y="16" textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontWeight="700" fontSize="9.5" fill="#fff">SO</text>
    </svg>
  )
}

export function CardIcon({ tone, size = 22 }) {
  const fill = tone === 'green' ? '#22c55e' : tone === 'yellow' ? '#facc15' : '#ef4444'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label={`${tone} card`}>
      <rect x="7" y="4" width="10" height="16" rx="2" fill={fill} transform="rotate(8 12 12)" />
    </svg>
  )
}

export function SaveIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Save">
      <circle cx="12" cy="12" r="11" fill="#475569" />
      <path d="M6.5 9.5c0-1.7 2.5-3 5.5-3s5.5 1.3 5.5 3v5c0 1.7-2.5 3-5.5 3s-5.5-1.3-5.5-3z" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M9.5 12.2l1.8 1.8 3.4-3.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function WhistleIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-label="Whistle">
      <circle cx="12" cy="12" r="11" fill="#334155" />
      <path d="M7 10.5h7l3-1.8v3.1a4.6 4.6 0 11-9.2 1.2z" fill="#fff" />
      <circle cx="11.4" cy="13.6" r="1.3" fill="#334155" />
    </svg>
  )
}

/** Resolve an event ledger row to its icon — the one derivation site for event glyphs. */
export function EventIcon({ ev, size = 22 }) {
  if (ev.type === 'goal') {
    if (ev.via === 'PC') return <PCIcon size={size} />
    if (ev.via === 'PS') return <PSIcon size={size} />
    if (ev.via === 'SO') return <ShootoutIcon size={size} />
    return <GoalIcon size={size} />
  }
  if (ev.type === 'green_card') return <CardIcon tone="green" size={size} />
  if (ev.type === 'yellow_card') return <CardIcon tone="yellow" size={size} />
  if (ev.type === 'red_card') return <CardIcon tone="red" size={size} />
  if (ev.type === 'save') return <SaveIcon size={size} />
  if (ev.type === 'pc_won') return <PCIcon size={size} />
  return <WhistleIcon size={size} />
}

export const VIA_LABEL = { PC: 'Penalty corner', FG: 'Field goal', PS: 'Penalty stroke', SO: 'Shootout' }
