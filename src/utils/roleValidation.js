'use strict';

/**
 * Pure hierarchy and manageability checks for self-assignable roles.
 *
 * These functions are dependency-free so they can be exercised by fast unit
 * and property-based tests without Discord or a database.
 */

/**
 * Determine whether the bot can manage a role at the given position.
 *
 * A role can only be managed if it sits strictly below the bot's highest
 * role in the guild hierarchy. A role at an equal or higher position cannot
 * be managed by the bot.
 *
 * @param {number} rolePosition - The position of the target role.
 * @param {number} botHighestPosition - The position of the bot's highest role.
 * @returns {boolean} True iff rolePosition is strictly lower than botHighestPosition.
 */
function canManageRole(rolePosition, botHighestPosition) {
  return rolePosition < botHighestPosition;
}

/**
 * Composite guard used before mutating member roles or adding to the list.
 *
 * Checks are evaluated in a fixed order so the most specific failure reason is
 * reported:
 *   1. The bot must hold the Manage Roles permission.
 *   2. The target role must currently exist in the guild.
 *   3. The target role must be below the bot's highest role (hierarchy).
 *
 * @param {Object} params
 * @param {boolean} params.botHasManageRoles - Whether the bot holds Manage Roles.
 * @param {boolean} params.roleExists - Whether the role currently exists in the guild.
 * @param {number} params.rolePosition - The position of the target role.
 * @param {number} params.botHighestPosition - The position of the bot's highest role.
 * @returns {{ ok: boolean, reason: 'ok'|'missing_permission'|'hierarchy'|'not_found' }}
 */
function checkManageable({ botHasManageRoles, roleExists, rolePosition, botHighestPosition }) {
  if (!botHasManageRoles) {
    return { ok: false, reason: 'missing_permission' };
  }
  if (!roleExists) {
    return { ok: false, reason: 'not_found' };
  }
  if (!canManageRole(rolePosition, botHighestPosition)) {
    return { ok: false, reason: 'hierarchy' };
  }
  return { ok: true, reason: 'ok' };
}

module.exports = { canManageRole, checkManageable };
