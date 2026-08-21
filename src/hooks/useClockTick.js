import { useEffect, useReducer } from 'react'
import { MATCH_WINDOW_MIN } from '../engine/clock'

// Dexie live queries only re-render on data changes, so an estimated match
// clock would freeze at whatever minute the page mounted on. This hook
// re-renders every 30s — but only while the match is inside its live window
// (from 2h before push-back, catching the scheduled→live flip, until the
// window closes), so the 40+ cards on the Matches page cost nothing.
export function useClockTick(match) {
  const [, tick] = useReducer(x => x + 1, 0)
  const ko = typeof match?.kickoffUtc === 'number' ? match.kickoffUtc : null
  const active = ko != null && match.status !== 'completed'
  useEffect(() => {
    if (!active) return
    let id = null
    const arm = () => {
      const now = Date.now()
      if (now > ko + MATCH_WINDOW_MIN * 60000) return   // window closed: static FT_WAIT
      if (now >= ko - 2 * 3600000) {
        id = setInterval(() => {
          tick()
          // One tick past the window renders the static FT state, then stop.
          if (Date.now() > ko + (MATCH_WINDOW_MIN + 1) * 60000) clearInterval(id)
        }, 30000)
      } else {
        // Not near push-back yet — wake up when we are (page left open overnight).
        id = setTimeout(() => { tick(); arm() }, ko - 2 * 3600000 - now)
      }
    }
    arm()
    return () => { clearInterval(id); clearTimeout(id) }
  }, [active, ko])
}
