'use strict';

const { checkManageable } = require('../src/utils/roleValidation');

/**
 * Unit tests for checkManageable.
 *
 * Verifies the composite manageability guard reports the correct
 * `{ ok, reason }` for each branch, in priority order:
 *   missing_permission -> not_found -> hierarchy -> ok
 *
 * Validates: Requirements 2.3, 2.4, 2.5
 */
describe('checkManageable', () => {
  describe("reason 'missing_permission'", () => {
    // Requirement 2.3: bot lacking Manage Roles cannot manage the role.
    test('returns missing_permission when the bot lacks Manage Roles', () => {
      const result = checkManageable({
        botHasManageRoles: false,
        roleExists: true,
        rolePosition: 1,
        botHighestPosition: 5,
      });
      expect(result).toEqual({ ok: false, reason: 'missing_permission' });
    });

    test('missing_permission takes priority over a missing or higher role', () => {
      const result = checkManageable({
        botHasManageRoles: false,
        roleExists: false,
        rolePosition: 10,
        botHighestPosition: 5,
      });
      expect(result).toEqual({ ok: false, reason: 'missing_permission' });
    });
  });

  describe("reason 'not_found'", () => {
    // Requirement 2.5: a role that no longer exists cannot be managed.
    test('returns not_found when the bot has permission but the role does not exist', () => {
      const result = checkManageable({
        botHasManageRoles: true,
        roleExists: false,
        rolePosition: 1,
        botHighestPosition: 5,
      });
      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });

    test('not_found takes priority over a hierarchy violation', () => {
      const result = checkManageable({
        botHasManageRoles: true,
        roleExists: false,
        rolePosition: 10,
        botHighestPosition: 5,
      });
      expect(result).toEqual({ ok: false, reason: 'not_found' });
    });
  });

  describe("reason 'hierarchy'", () => {
    // Requirement 2.4: a role at or above the bot's highest role cannot be managed.
    test('returns hierarchy when the role is positioned above the bot highest role', () => {
      const result = checkManageable({
        botHasManageRoles: true,
        roleExists: true,
        rolePosition: 6,
        botHighestPosition: 5,
      });
      expect(result).toEqual({ ok: false, reason: 'hierarchy' });
    });

    test('returns hierarchy when the role is at the same position as the bot highest role', () => {
      const result = checkManageable({
        botHasManageRoles: true,
        roleExists: true,
        rolePosition: 5,
        botHighestPosition: 5,
      });
      expect(result).toEqual({ ok: false, reason: 'hierarchy' });
    });
  });

  describe("reason 'ok'", () => {
    test('returns ok when permission, existence, and hierarchy all pass', () => {
      const result = checkManageable({
        botHasManageRoles: true,
        roleExists: true,
        rolePosition: 4,
        botHighestPosition: 5,
      });
      expect(result).toEqual({ ok: true, reason: 'ok' });
    });

    test('returns ok for a role just below the bot highest role', () => {
      const result = checkManageable({
        botHasManageRoles: true,
        roleExists: true,
        rolePosition: 0,
        botHighestPosition: 1,
      });
      expect(result).toEqual({ ok: true, reason: 'ok' });
    });
  });
});
