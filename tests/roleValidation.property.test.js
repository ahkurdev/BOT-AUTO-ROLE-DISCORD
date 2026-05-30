'use strict';

const fc = require('fast-check');
const { canManageRole } = require('../src/utils/roleValidation');

/**
 * Feature: discord-self-role-bot, Property 3: Manageability respects role hierarchy
 *
 * Validates: Requirements 2.4, 3.3
 *
 * A role is manageable by the bot if and only if its position is strictly
 * lower than the bot's highest role position. A role at an equal or higher
 * position is never manageable.
 */
describe('Feature: discord-self-role-bot, Property 3: Manageability respects role hierarchy', () => {
  test('canManageRole returns true iff rolePosition is strictly lower than botHighestPosition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (rolePosition, botHighestPosition) => {
          const result = canManageRole(rolePosition, botHighestPosition);
          // Manageable exactly when strictly below the bot's highest role.
          expect(result).toBe(rolePosition < botHighestPosition);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('a role at an equal or higher position is never manageable', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        // delta >= 0 makes rolePosition equal to or higher than the bot's role.
        fc.nat({ max: 1000 }),
        (botHighestPosition, delta) => {
          const rolePosition = botHighestPosition + delta;
          expect(canManageRole(rolePosition, botHighestPosition)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('a role strictly below the bot is always manageable', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        // delta >= 1 makes rolePosition strictly below the bot's role.
        fc.integer({ min: 1, max: 1000 }),
        (botHighestPosition, delta) => {
          const rolePosition = botHighestPosition - delta;
          expect(canManageRole(rolePosition, botHighestPosition)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });
});
