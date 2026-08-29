// Hockey.AI — the one way the app draws the shape of a match.
//
// A knockout has no draw to offer. Level after sixty minutes goes to a
// shoot-out, so the outcomes on the table are the two ways to advance, and the
// draw mass belongs in the footnote as what it really is: the chance the tie
// needs the shoot-out at all. The match page has always said it that way; the
// home hero and the AI Lab did not, and offered readers a "Draw 17.6%" on a
// bronze medal match beside a pick of Netherlands 67.6% to advance — three
// numbers, none of which was the published claim.
//
// Every surface that shows the split now shows this one, so the rule is
// written down once and cannot drift back apart.

import { formatProbability } from '../engine/probability.js'

export default function PredictionSplit({ pred, home, away, bar = 'h-1.5', className = '' }) {
  if (pred?.status !== 'ready') return null

  const parts = pred.isKnockout
    ? [
        { key: 'h', label: home, p: pred.advance.home, fill: 'bg-brand', tone: 'text-brand' },
        { key: 'a', label: away, p: pred.advance.away, fill: 'bg-sky-400', tone: 'text-sky-400' },
      ]
    : [
        { key: 'h', label: home, p: pred.reg.home, fill: 'bg-brand', tone: 'text-brand' },
        { key: 'd', label: 'Draw', p: pred.reg.draw, fill: 'bg-pitch-600', tone: '' },
        { key: 'a', label: away, p: pred.reg.away, fill: 'bg-sky-400', tone: 'text-sky-400' },
      ]

  return (
    <div className={className}>
      <div className={`mb-1 flex ${bar} overflow-hidden rounded-full`}>
        {parts.map(s => (
          <div key={s.key} style={{ width: `${s.p * 100}%` }} className={s.fill} />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-pitch-400">
        {parts.map(s => (
          <span key={s.key} className={s.tone}>
            {/* The away side reads value-then-name so the row mirrors the bar
                beneath it, home on the left and away on the right. */}
            {s.key === 'a' ? `${formatProbability(s.p)} ${s.label}` : `${s.label} ${formatProbability(s.p)}`}
          </span>
        ))}
      </div>
      {pred.isKnockout && (
        <div className="mt-1 text-center font-mono text-[10px] text-pitch-400">
          level after 60&apos; {formatProbability(pred.paths.shootout)} → shoot-out
        </div>
      )}
    </div>
  )
}
