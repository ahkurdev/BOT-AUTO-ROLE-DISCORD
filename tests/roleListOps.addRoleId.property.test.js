'use strict';

const fc = require('fast-check');
const { addRoleId } = require('../src/utils/roleListOps');

/**
 * Feature: discord-self-role-bot, Property 4: Adding a role is duplicate-free and idempotent
 *
 * Validates: Requirements 3.1, 3.2, 3.4
 *
 * For any self-role list and any role id, addRoleId produces a list that contains
 * the role id exactly once; if the id was already present the resulting list is
 * set-equal to the input (no change, reported as a duplicate), and after any
 * sequence of additions the list contains no duplicate ids.
 */

// A snowflake-like id: a string of 17-19 digits. Discord snowflakes are 64-bit
// integers rendered as decimal strings; this generator stays within that shape.
const snowflakeArb = fc
  .integer({ min: 1, max: 4_000_000 })
  .map((n) => String(100000000000000000n + BigInt(n)));

// An array of snowflake-like ids. May contain duplicates from the generator,
// but addRoleId is only contractually required to keep the list duplicate-free
// for ids it adds, so we de-duplicate the seed list to model a valid stored list.
const roleListArb = fc
  .array(snowflakeArb, { maxLength: 20 })
  .map((ids) => [...new Set(ids)]);

function countOccurrences(arr, value) {
  return arr.filter((x) => x === value).length;
}

describe('Feature: discord-self-role-bot, Property 4: Adding a role is duplicate-free and idempotent', () => {
  test('result contains roleId exactly once and reports the correct outcome', () => {
    fc.assert(
      fc.property(roleListArb, snowflakeArb, (roles, roleId) => {
        const wasPresent = roles.includes(roleId);
        const snapshot = [...roles];

        const result = addRoleId(roles, roleId);

        // The resulting roles array contains roleId exactly once.
        expect(countOccurrences(result.roles, roleId)).toBe(1);

        if (wasPresent) {
          // Already present: set-equal to input, no change, reason 'duplicate'.
          expect(result.changed).toBe(false);
          expect(result.reason).toBe('duplicate');
          expect(new Set(result.roles)).toEqual(new Set(roles));
        } else {
          // Absent: roleId appended, changed true, reason 'added'.
          expect(result.changed).toBe(true);
          expect(result.reason).toBe('added');
          expect(result.roles).toEqual([...snapshot, roleId]);
        }

        // The input array is not mutated.
        expect(roles).toEqual(snapshot);
      }),
      { numRuns: 200 }
    );
  });

  test('also accepts a roleId already present in the list (idempotent duplicate path)', () => {
    fc.assert(
      fc.property(
        roleListArb.filter((roles) => roles.length > 0),
        fc.nat(),
        (roles, index) => {
          // Pick an id guaranteed to already be in the list.
          const roleId = roles[index % roles.length];
          const snapshot = [...roles];

          const result = addRoleId(roles, roleId);

          expect(result.changed).toBe(false);
          expect(result.reason).toBe('duplicate');
          expect(countOccurrences(result.roles, roleId)).toBe(1);
          expect(new Set(result.roles)).toEqual(new Set(roles));
          // Input not mutated.
          expect(roles).toEqual(snapshot);
        }
      ),
      { numRuns: 200 }
    );
  });

  test('folding addRoleId over any sequence of ids yields a list with no duplicates', () => {
    fc.assert(
      fc.property(
        roleListArb,
        fc.array(snowflakeArb, { maxLength: 40 }),
        (initial, sequence) => {
          const finalRoles = sequence.reduce((acc, id) => {
            const { roles } = addRoleId(acc, id);
            return roles;
          }, initial);

          // No duplicate ids after any sequence of additions.
          expect(finalRoles.length).toBe(new Set(finalRoles).size);

          // Every id from the initial list and the sequence is present.
          for (const id of [...initial, ...sequence]) {
            expect(finalRoles).toContain(id);
          }

          // Each added id appears exactly once.
          for (const id of new Set([...initial, ...sequence])) {
            expect(countOccurrences(finalRoles, id)).toBe(1);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
