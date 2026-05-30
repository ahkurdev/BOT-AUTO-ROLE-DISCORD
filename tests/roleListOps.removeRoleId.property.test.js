'use strict';

const fc = require('fast-check');
const { removeRoleId } = require('../src/utils/roleListOps');

/**
 * Property 5: Removing a role deletes only when present
 *
 * Validates: Requirements 4.1, 4.2
 *
 * For any self-role list and any role id, `removeRoleId` produces a list that
 * does not contain the role id; if the id was present it is removed (reported
 * as removed) and otherwise the list is unchanged (reported as absent). The
 * input array is never mutated.
 */

// A snowflake-like id: a string of 17-19 digits, similar to Discord ids.
const snowflakeArb = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }), // leading non-zero digit
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 16, maxLength: 18 })
  )
  .map(([lead, rest]) => `${lead}${rest.join('')}`);

// An array of snowflake-like ids (may contain duplicates so we exercise the
// "every occurrence removed" behaviour).
const rolesArb = fc.array(snowflakeArb, { maxLength: 30 });

describe('Feature: discord-self-role-bot, Property 5: Removing a role deletes only when present', () => {
  it('removes the role only when present and never mutates the input', () => {
    fc.assert(
      fc.property(
        rolesArb,
        snowflakeArb,
        fc.boolean(),
        (roles, candidateId, forcePresent) => {
          // Sometimes force the candidate to be present in the list by
          // inserting it at a random-ish position, so both branches are
          // exercised across runs.
          let inputRoles = roles;
          if (forcePresent && roles.length > 0) {
            const insertAt = roles.length % (roles.length + 1);
            inputRoles = [
              ...roles.slice(0, insertAt),
              candidateId,
              ...roles.slice(insertAt),
            ];
          } else if (forcePresent) {
            inputRoles = [candidateId];
          }

          const wasPresent = inputRoles.includes(candidateId);
          const inputSnapshot = [...inputRoles];

          const result = removeRoleId(inputRoles, candidateId);

          // Result shape and core invariant: roleId is never in the output.
          expect(result.roles).not.toContain(candidateId);

          if (wasPresent) {
            // Present -> removed.
            expect(result.changed).toBe(true);
            expect(result.reason).toBe('removed');
            // Only occurrences of candidateId are dropped; everything else is
            // preserved in order.
            expect(result.roles).toEqual(
              inputSnapshot.filter((id) => id !== candidateId)
            );
          } else {
            // Absent -> unchanged.
            expect(result.changed).toBe(false);
            expect(result.reason).toBe('absent');
            expect(result.roles).toEqual(inputSnapshot);
          }

          // The input array is not mutated.
          expect(inputRoles).toEqual(inputSnapshot);
          // A fresh array is returned (no aliasing of the input).
          expect(result.roles).not.toBe(inputRoles);
        }
      ),
      { numRuns: 200 }
    );
  });
});
