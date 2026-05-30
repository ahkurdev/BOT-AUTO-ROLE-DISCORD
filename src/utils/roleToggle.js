'use strict';

/**
 * Pure toggle decision for self-role selection.
 *
 * Decides whether a selected role should be added to or removed from a member
 * based on the roles the member currently holds.
 *
 * @param {Set<string>|Iterable<string>} memberRoleIds - Role ids the member
 *   currently holds. A Set is expected; any iterable (e.g. an array) is coerced
 *   to a Set for robustness.
 * @param {string} selectedRoleId - The role id the member selected.
 * @returns {{ action: 'add' | 'remove' }} `remove` if the member already holds
 *   the selected role, otherwise `add`.
 */
function decideToggle(memberRoleIds, selectedRoleId) {
  const heldRoleIds = memberRoleIds instanceof Set ? memberRoleIds : new Set(memberRoleIds);
  return { action: heldRoleIds.has(selectedRoleId) ? 'remove' : 'add' };
}

module.exports = { decideToggle };
