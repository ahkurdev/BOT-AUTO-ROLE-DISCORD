'use strict';

const fc = require('fast-check');
const { partitionRoles } = require('../src/utils/staleRoles');

/**
 * Feature: discord-self-role-bot, Property 1: Stale-role partition is complete,
 * disjoint, and excludes stale ids
 *
 * Validates: Requirements 1.1, 1.3, 1.4, 5.1, 5.2
 *
 * For any stored list of role ids and any set of role ids that currently exist
 * in the guild, partitionRoles returns:
 *   - validIds: exactly the de-duplicated stored ids that exist, preserving order.
 *   - staleIds: exactly the de-duplicated stored ids that do NOT exist.
 *   - validIds and staleIds are disjoint.
 *   - validIds ∪ staleIds equals the de-duplicated stored ids.
 *   - no id in staleIds appears in validIds.
 */

// Generator for snowflake-like id strings (17-19 digit numeric strings, as
// Discord snowflakes are). Constraining to a small pool of "digits" is not
// needed; instead we use a bounded numeric string so collisions/overlaps occur
// naturally without an astronomically large id space.
const snowflakeArb = fc
  .integer({ min: 1, max: 9999 })
  .map((n) => String(100000000000000000n + BigInt(n)));

// De-duplicate preserving first-occurrence order (reference implementation).
function dedupeInOrder(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

describe('Feature: discord-self-role-bot, Property 1: Stale-role partition is complete, disjoint, and excludes stale ids', () => {
  test('partitionRoles is complete, disjoint, order-preserving, and excludes stale ids', () => {
    fc.assert(
      fc.property(
        // Random stored ids (may contain duplicates).
        fc.array(snowflakeArb, { maxLength: 40 }),
        // A pool of ids that "exist"; some overlap with stored, some do not.
        fc.array(snowflakeArb, { maxLength: 40 }),
        (storedIds, existingPool) => {
          const existingSet = new Set(existingPool);
          const { validIds, staleIds } = partitionRoles(storedIds, existingSet);

          const dedupedStored = dedupeInOrder(storedIds);

          // Expected partition computed independently from the implementation.
          const expectedValid = dedupedStored.filter((id) => existingSet.has(id));
          const expectedStale = dedupedStored.filter((id) => !existingSet.has(id));

          // validIds equals exactly the de-duplicated stored ids that exist,
          // preserving stored order.
          expect(validIds).toEqual(expectedValid);

          // staleIds equals exactly the de-duplicated stored ids that do NOT exist.
          expect(staleIds).toEqual(expectedStale);

          // validIds and staleIds are disjoint; no stale id appears in validIds.
          const validSet = new Set(validIds);
          for (const id of staleIds) {
            expect(validSet.has(id)).toBe(false);
          }

          // validIds ∪ staleIds equals the de-duplicated stored ids.
          expect([...validIds, ...staleIds].sort()).toEqual(
            [...dedupedStored].sort()
          );

          // Neither partition contains duplicates.
          expect(validIds.length).toBe(new Set(validIds).size);
          expect(staleIds.length).toBe(new Set(staleIds).size);

          // Every valid id exists; every stale id does not.
          for (const id of validIds) {
            expect(existingSet.has(id)).toBe(true);
          }
          for (const id of staleIds) {
            expect(existingSet.has(id)).toBe(false);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  test('accepts an array for existingRoleIds (coerced to a Set)', () => {
    fc.assert(
      fc.property(
        fc.array(snowflakeArb, { maxLength: 40 }),
        fc.array(snowflakeArb, { maxLength: 40 }),
        (storedIds, existingPool) => {
          const fromArray = partitionRoles(storedIds, existingPool);
          const fromSet = partitionRoles(storedIds, new Set(existingPool));
          expect(fromArray).toEqual(fromSet);
        }
      ),
      { numRuns: 100 }
    );
  });
});
