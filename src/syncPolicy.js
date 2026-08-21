// Hockey.AI — when to refetch the whole snapshot
//
// Kept apart from sync.js (and from Dexie) so the decision can be tested
// directly. The rule that matters: a version stamp is a claim about what we
// once wrote, not evidence that the rows are still there. Trusting it alone is
// what let the app sit on an empty database, politely believing itself fresh,
// and render tab after empty tab.

/**
 * @param {object}  o
 * @param {boolean} o.force      caller demanded a refetch
 * @param {boolean} o.empty      the object stores have no rows
 * @param {?object} o.localMeta  {version} last written locally, or null
 * @param {?object} o.remote     {version} published by the pipeline
 * @returns {{resync: boolean, reason: string}}
 */
export function needsResync({ force = false, empty = false, localMeta = null, remote = null }) {
  if (force) return { resync: true, reason: 'forced' }
  if (!remote || typeof remote.version !== 'number') return { resync: false, reason: 'no-remote-version' }
  if (empty) return { resync: true, reason: 'empty-store' }
  if (!localMeta || typeof localMeta.version !== 'number') return { resync: true, reason: 'never-synced' }
  if (localMeta.version < remote.version) return { resync: true, reason: 'stale' }
  // The counter can stay put while the content moves: it is written by both the
  // pipeline and any branch that regenerates the data, and a merge keeps one
  // side's number alongside BOTH sides' content. The fingerprint is derived
  // from the published bytes, so it cannot be stale while they are not.
  if (remote.fingerprint && localMeta.fingerprint !== remote.fingerprint) {
    return { resync: true, reason: 'content-changed' }
  }
  return { resync: false, reason: 'fresh' }
}
