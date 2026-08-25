// Hockey.AI — sport-correct iconography.
//
// The board and honour artwork was inherited from Soccer.AI: a football boot
// for the scoring charts, a football for the player award, an outfield
// goalkeeper's glove for the keeper award, crossed swords for attack. This
// draws the same medallion language — navy disc, gold rim, gold glyph — around
// hockey's own objects: the stick, the ball, the keeper's kit, the corner.
//
// Inline SVG rather than PNG so the set scales cleanly on a phone, carries no
// download weight, and can take the brand colours from one place.

const GOLD = '#f0c04a'
const GOLD_DEEP = '#c8912a'
const NAVY = '#101f4d'

/** The stick itself: shaft, then the hook, drawn as one stroke. */
function StickPath({ stroke = GOLD, width = 2.4 }) {
  return (
    <path d="M16.8 5.2 L10.6 14.6 C9.3 16.9 6.3 17.6 5.3 15.6 C4.7 14.3 5.6 13.1 7.1 13.2"
      fill="none" stroke={stroke} strokeWidth={width}
      strokeLinecap="round" strokeLinejoin="round" />
  )
}

/** A hockey ball is dimpled — that is what separates it from a football. */
function BallPath({ cx, cy, r, fill = GOLD, dot = NAVY }) {
  const d = r * 0.34
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      {[[-d, -d], [d, -d], [-d, d], [d, d], [0, 0]].map(([dx, dy], i) => (
        <circle key={i} cx={cx + dx} cy={cy + dy} r={r * 0.13} fill={dot} opacity="0.55" />
      ))}
    </g>
  )
}

/** Navy disc with a gold rim — the frame every board icon shares. */
function Medal({ size, label, children }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label}>
      <circle cx="12" cy="12" r="11.2" fill={NAVY} stroke={GOLD_DEEP} strokeWidth="1.4" />
      <circle cx="12" cy="12" r="9.6" fill="none" stroke={GOLD} strokeWidth="0.5" opacity="0.5" />
      {children}
    </svg>
  )
}

/** Leading scorer — the stick and the ball it struck. */
export function GoldenStickIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Golden Stick">
      <g transform="translate(-1.2 -0.6) scale(0.94) translate(0.8 0.8)">
        <StickPath />
      </g>
      <BallPath cx={16.4} cy={15.6} r={3.1} />
    </Medal>
  )
}

/** Attack — two sticks meeting, hockey's own crossed blades. */
export function CrossedSticksIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Attack">
      <g transform="rotate(-12 12 12) translate(-1.4 0)"><StickPath width="2.1" /></g>
      <g transform="scale(-1 1) translate(-24 0) rotate(-12 12 12) translate(-1.4 0)">
        <StickPath width="2.1" stroke={GOLD_DEEP} />
      </g>
    </Medal>
  )
}

/** Defence — the keeper's leg guard and kicker, the last line in this sport. */
export function KeeperPadIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Defence">
      <rect x="8.4" y="5.4" width="7.2" height="9.6" rx="2.2" fill={GOLD} />
      {[7.8, 10.1, 12.4].map(y => (
        <line key={y} x1="9.4" y1={y} x2="14.6" y2={y} stroke={NAVY} strokeWidth="0.9" opacity="0.6" />
      ))}
      <path d="M8.4 15.4 h7.2 a2 2 0 0 1 2 2 v0.9 a1.4 1.4 0 0 1-1.4 1.4 H7.8 a1.4 1.4 0 0 1-1.4-1.4 v-0.9 a2 2 0 0 1 2-2 z"
        fill={GOLD_DEEP} />
    </Medal>
  )
}

/** Set pieces — the penalty corner: the arc, the injector, the ball. */
export function PenaltyCornerIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Set pieces">
      <path d="M4.6 17.4 A8.6 8.6 0 0 1 19.4 17.4" fill="none" stroke={GOLD_DEEP}
        strokeWidth="1.4" strokeLinecap="round" />
      <line x1="4.6" y1="17.4" x2="19.4" y2="17.4" stroke={GOLD} strokeWidth="1.2" strokeLinecap="round" />
      <BallPath cx={6.6} cy={17.4} r={2} />
      <path d="M12 17.4 L15.4 8.6" stroke={GOLD} strokeWidth="1.3" strokeLinecap="round" />
    </Medal>
  )
}

/** Standings — the podium, unchanged in meaning across every sport. */
export function PodiumIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Standings">
      <rect x="9.6" y="7.4" width="4.8" height="11" fill={GOLD} />
      <rect x="4.6" y="11.4" width="4.8" height="7" fill={GOLD_DEEP} />
      <rect x="14.6" y="13.2" width="4.8" height="5.2" fill={GOLD_DEEP} />
      <text x="12" y="12.4" textAnchor="middle" fontFamily="JetBrains Mono, monospace"
        fontWeight="700" fontSize="4.4" fill={NAVY}>1</text>
    </Medal>
  )
}

/** The player index — a stick inside a rating ring. */
export function PlayerIndexIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Player index">
      <circle cx="12" cy="12" r="6.4" fill="none" stroke={GOLD_DEEP} strokeWidth="1.2"
        strokeDasharray="30 10" strokeLinecap="round" transform="rotate(-90 12 12)" />
      <g transform="translate(0.4 0) scale(0.78) translate(3 3)"><StickPath width="2.6" /></g>
    </Medal>
  )
}

/** Rising star — young player, climbing. */
export function RisingStarIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Rising star">
      <path d="M12 5.6 l1.7 3.5 3.8.55 -2.75 2.68.65 3.79L12 14.33 8.6 16.12l.65-3.79L6.5 9.65l3.8-.55z"
        fill={GOLD} />
      <path d="M6.4 19.2 L10 16.4 L13.2 18 L17.8 14" fill="none" stroke={GOLD_DEEP}
        strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </Medal>
  )
}

/** Fair play — the two cards a hockey umpire actually shows, plus the green. */
export function FairPlayIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Fair play">
      <rect x="6.2" y="7.4" width="5.2" height="8" rx="1" fill="#22c55e" transform="rotate(-12 8.8 11.4)" />
      <rect x="9.6" y="8.2" width="5.2" height="8" rx="1" fill="#facc15" transform="rotate(2 12.2 12.2)" />
      <rect x="13" y="7.4" width="5.2" height="8" rx="1" fill="#ef4444" transform="rotate(14 15.6 11.4)" />
    </Medal>
  )
}

/** Fourth quarter — the clock running down. */
export function FinalQuarterIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Fourth quarter">
      <circle cx="12" cy="12" r="6.6" fill="none" stroke={GOLD_DEEP} strokeWidth="1.3" />
      <path d="M12 12 L12 6.2 A5.8 5.8 0 0 1 17.8 12 z" fill={GOLD} />
      <circle cx="12" cy="12" r="1" fill={GOLD} />
    </Medal>
  )
}

/** Talisman — the share of a team's goals one player carries. */
export function TalismanIcon({ size = 32 }) {
  return (
    <Medal size={size} label="Talisman">
      <circle cx="12" cy="12" r="6.6" fill="none" stroke={GOLD_DEEP} strokeWidth="1.3" />
      <path d="M12 12 L12 5.4 A6.6 6.6 0 0 1 17.4 15.1 z" fill={GOLD} />
      <BallPath cx={12} cy={12} r={2.4} fill={NAVY} dot={GOLD} />
    </Medal>
  )
}

/** The award medallions, keyed the way the awards content keys them. */
const AWARD_ICONS = {
  best_player: PlayerIndexIcon,
  top_scorer: GoldenStickIcon,
  best_goalkeeper: KeeperPadIcon,
  rising_star: RisingStarIcon,
  fair_play: FairPlayIcon,
}

export function AwardIcon({ awardKey, size = 28 }) {
  const Icon = AWARD_ICONS[awardKey] ?? GoldenStickIcon
  return <Icon size={size} />
}

/**
 * Where a number came from. FIH means the official record — taken from it or
 * arithmetic on it. Hockey.AI means this project derived it, and it carries no
 * official standing.
 */
export function DerivedBadge({ derived }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${
      derived ? 'bg-brand/10 text-brand' : 'bg-pitch-700 text-pitch-300'
    }`}>
      {derived ? 'Hockey.AI' : 'FIH'}
    </span>
  )
}
