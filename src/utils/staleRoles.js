'use strict';

/**
 * Pure stale-role partitioning for a guild's self-role list.
 *
 * A "stale" role is a stored role id whose corresponding role no longer
 * exists in the guild. Partitioning the stored ids lets callers present only
 * the still-valid roles while pruning the stale ones from the datastore.
 *
 * This module is dependency-free and never mutates its inputs.
 */

/**
 * Partition stored role ids into those that still exist in the guild and
 * those that are stale (no longer exist).
 *
 * @param {string[]} storedIds - the stored self-role ids, in stored order
 * @param {Set<string>|string[]} existingRoleIds - role ids that currently
 *   exist in the guild. A Set is expected; an array is accepted and coerced
 *   to a Set for robustness.
 * @returns {{ validIds: string[], staleIds: string[] }}
 *   - `validIds`: exactly the stored ids that exist, preserving the stored
 *     order and de-duplicated (first occurrence wins).
 *   - `staleIds`: exactly the stored ids that do not exist, de-duplicated
 *     (first occurrence wins) — the ids to prune from the datastore.
 *
 * Invariants (for de-duplicated stored ids):
 *   - `validIds ∪ staleIds` equals the de-duplicated stored ids.
 *   - `validIds ∩ staleIds` is empty (disjoint).
 *   - no id in `staleIds` ever appears in `validIds`.
 */
function partitionRoles(storedIds, existingRoleIds) {
  const existing =
    existingRoleIds instanceof Set ? existingRoleIds : new Set(existingRoleIds);

  const validIds = [];
  const staleIds = [];
  const seen = new Set();

  for (const id of storedIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    if (existing.has(id)) {
      validIds.push(id);
    } else {
      staleIds.push(id);
    }
  }

  return { validIds, staleIds };
}

module.exports = { partitionRoles };
