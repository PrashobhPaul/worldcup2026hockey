// Clock honesty: the schedule-estimated live clock and the FT-awaiting-score
// state. Guards the exact reported failure — FRA v RSA and IRL v MAS sat on
// "live · Q1" with a fabricated 0-0 for hours after full-time.
import { deriveClock, isLiveClock, MATCH_WINDOW_MIN } from '../src/engine/clock.js'

let failed = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log('  ok  ', name)
  else { failed++; console.log('  FAIL', name, detail) }
}

const KO = Date.UTC(2026, 7, 21, 9, 0, 0)   // arbitrary push-back instant
const min = n => KO + n * 60000
const m = (over = {}) => ({
  id: 'S2H1', home: 'FRA', away: 'RSA', status: 'live',
  score: { home: null, away: null }, kickoffUtc: KO, ...over,
})

console.log('Pre-match')
let c = deriveClock(m({ status: 'scheduled' }), min(-30))
check('before push-back: not started', c.kind === 'PRE' && !isLiveClock(c))

console.log('\nEstimated live clock (no provider feed)')
c = deriveClock(m(), min(0))
check('push-back: Q1, ~0\'', c.phase === 'Q1' && c.minute === 0 && c.display === "~0'", JSON.stringify(c))
check('estimate is flagged and live', c.estimated === true && c.kind === 'EST' && isLiveClock(c))

c = deriveClock(m({ status: 'scheduled' }), min(5))
check('past push-back while the feed still says scheduled: live Q1',
  c.phase === 'Q1' && c.minute === 5 && isLiveClock(c), JSON.stringify(c))

c = deriveClock(m(), min(16))
check('16 wall minutes in: quarter break after Q1', c.phase === 'QB1' && c.display === 'End Q1', JSON.stringify(c))
c = deriveClock(m(), min(20))
check('20 wall minutes in: Q2, game minute 18', c.phase === 'Q2' && c.minute === 18, JSON.stringify(c))
c = deriveClock(m(), min(35))
check('35 wall minutes in: half-time', c.phase === 'HT' && c.display === 'HT', JSON.stringify(c))
c = deriveClock(m(), min(50))
check('50 wall minutes in: Q3, game minute 38', c.phase === 'Q3' && c.minute === 38, JSON.stringify(c))
c = deriveClock(m(), min(58))
check('58 wall minutes in: quarter break after Q3', c.phase === 'QB3', JSON.stringify(c))
c = deriveClock(m(), min(70))
check('70 wall minutes in: Q4, game minute 56', c.phase === 'Q4' && c.minute === 56, JSON.stringify(c))
c = deriveClock(m(), min(80))
check('Q4 running long: game minute caps at 60, still live',
  c.phase === 'Q4' && c.minute === 60 && isLiveClock(c), JSON.stringify(c))

console.log('\nWindow over, no score — the reported bug')
c = deriveClock(m(), min(MATCH_WINDOW_MIN + 1))
check('past the window: FT awaiting score, never a running clock',
  c.phase === 'FT' && c.kind === 'FT_WAIT', JSON.stringify(c))
check('FT_WAIT is not live', !isLiveClock(c))
c = deriveClock(m(), min(60 * 5))
check('five hours later it still says FT, not Q1', c.kind === 'FT_WAIT', JSON.stringify(c))

console.log('\nProvider feed outranks the estimate')
c = deriveClock(m({ livePhase: 'HT' }), min(20))
check('provider HT wins over estimated Q2', c.phase === 'HT' && c.kind === 'HT')
c = deriveClock(m({ livePhase: 'Q2', liveMinute: 22 }), min(90))
check('provider quarter + minute wins over window logic',
  c.phase === 'Q2' && c.minute === 22 && c.kind === 'LIVE', JSON.stringify(c))
c = deriveClock(m({ livePhase: 'Q3', q3StartUtc: min(40) }), min(47))
check('anchored quarter derives the minute', c.phase === 'Q3' && c.minute === 37, JSON.stringify(c))

console.log('\nCompleted matches')
c = deriveClock(m({ status: 'completed', score: { home: 1, away: 3 } }))
check('completed: FT', c.phase === 'FT' && c.kind === 'FT')
c = deriveClock(m({ status: 'completed', score: { home: 2, away: 2 }, shootout: { home: 3, away: 1 } }))
check('completed on shootout: FT (SO)', c.kind === 'FT_SO' && c.display === 'FT (SO)')
c = deriveClock(m({ status: 'completed', score: { home: 1, away: 0 } }), min(30))
check('completed outranks any clock estimate', c.phase === 'FT')

console.log('\nDegenerate inputs')
c = deriveClock(null)
check('no match: pre-state', c.kind === 'PRE')
c = deriveClock(m({ kickoffUtc: undefined }), min(10))
check('live with no kickoff time: raw LIVE, no invented minute',
  c.kind === 'RAW' && c.minute === null, JSON.stringify(c))

console.log()
if (failed) { console.log(`${failed} clock check(s) FAILED`); process.exit(1) }
console.log('All clock checks passed.')
