import { useEffect, useRef } from 'react'

/**
 * Swipe left/right to move between adjacent tabs — for phones and touch-screen
 * laptops. Pointer events cover touch and pen; mouse drags are ignored so a
 * text selection never changes tab.
 *
 * One gesture moves exactly one thing. Both the app shell (top-level tabs) and
 * the current page (its sub-tabs) register here, and a single shared listener
 * picks one winner per swipe: the innermost registrant that can actually move
 * in that direction. So a swipe inside the Tournament tab walks its sub-tabs,
 * and swiping past the last one moves to the next top-level tab.
 *
 * Gestures starting inside something the user is meant to drag or scroll
 * horizontally (charts, scrollable tables, the tab bars themselves, form
 * controls) or anything marked `data-no-swipe` are ignored.
 */
const IGNORE = '[data-no-swipe],.recharts-wrapper,input,textarea,select'

/**
 * True when the gesture starts somewhere the horizontal drag belongs to the
 * page: a chart, a form control, or a container that genuinely has content to
 * scroll sideways. A container marked scrollable but currently fitting its
 * content (a standings table on a wide screen) does not block the swipe.
 */
function blocksSwipe(target) {
  if (!target?.closest) return true
  if (target.closest(IGNORE)) return true
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    const overflowX = getComputedStyle(el).overflowX
    if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 4) {
      return true
    }
  }
  return false
}

export const SWIPE_PRIORITY = { shell: 0, page: 1 }

const registry = new Set()
let attached = false
let startX = null, startY = null, startT = 0

function onPointerDown(e) {
  if (e.pointerType === 'mouse') { startX = null; return }
  if (blocksSwipe(e.target)) { startX = null; return }
  startX = e.clientX; startY = e.clientY; startT = Date.now()
}

function onPointerUp(e) {
  if (startX == null) return
  const dx = e.clientX - startX
  const dy = e.clientY - startY
  const dt = Date.now() - startT
  startX = null
  // Horizontal, decisive, and not a slow drag: ≥64px across, at least twice
  // the vertical travel, inside 800ms.
  if (dt > 800 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2) return

  const step = dx < 0 ? 1 : -1
  const winner = [...registry]
    .filter(r => r.enabled && r.count > 1)
    .filter(r => { const next = r.index + step; return next >= 0 && next < r.count })
    .sort((a, b) => b.priority - a.priority)[0]
  if (winner) winner.onChange(winner.index + step)
}

function onPointerCancel() { startX = null }

function attach() {
  if (attached || typeof window === 'undefined') return
  window.addEventListener('pointerdown', onPointerDown, { passive: true })
  window.addEventListener('pointerup', onPointerUp, { passive: true })
  window.addEventListener('pointercancel', onPointerCancel, { passive: true })
  attached = true
}

export function useSwipeTabs({ count, index, onChange, enabled = true, priority = SWIPE_PRIORITY.page }) {
  // A stable registry entry, refreshed on every render, so the shared listener
  // always sees the current index without re-binding.
  const entry = useRef({})
  Object.assign(entry.current, { count, index, onChange, enabled, priority })

  useEffect(() => {
    const self = entry.current
    attach()
    registry.add(self)
    return () => { registry.delete(self) }
  }, [])
}

export default useSwipeTabs
