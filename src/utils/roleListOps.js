'use strict';

/**
 * Pure list operations for managing a guild's self-role list.
 *
 * Each function returns a decision object of shape:
 *   { roles: string[], changed: boolean, reason: string }
 *
 * Neither function mutates its input `roles` array.
 */

/**
 * Add a role id to the list without ever producing a duplicate.
 *
 * @param {string[]} roles - current list of role ids
 * @param {string} roleId - role id to add
 * @returns {{ roles: string[], changed: boolean, reason: 'added' | 'duplicate' }}
 *   - When `roleId` is absent: a new array with `roleId` appended,
 *     `changed: true`, `reason: 'added'`.
 *   - When `roleId` is already present: a copy of the input list,
 *     `changed: false`, `reason: 'duplicate'`.
 */
function addRoleId(roles, roleId) {
  if (roles.includes(roleId)) {
    return { roles: [...roles], changed: false, reason: 'duplicate' };
  }
  return { roles: [...roles, roleId], changed: true, reason: 'added' };
}

/**
 * Remove a role id from the list if it is present.
 *
 * @param {string[]} roles - current list of role ids
 * @param {string} roleId - role id to remove
 * @returns {{ roles: string[], changed: boolean, reason: 'removed' | 'absent' }}
 *   - When `roleId` is present: a new array with every occurrence of `roleId`
 *     removed, `changed: true`, `reason: 'removed'`.
 *   - When `roleId` is absent: a copy of the input list,
 *     `changed: false`, `reason: 'absent'`.
 */
function removeRoleId(roles, roleId) {
  if (!roles.includes(roleId)) {
    return { roles: [...roles], changed: false, reason: 'absent' };
  }
  return {
    roles: roles.filter((id) => id !== roleId),
    changed: true,
    reason: 'removed',
  };
}

module.exports = { addRoleId, removeRoleId };
