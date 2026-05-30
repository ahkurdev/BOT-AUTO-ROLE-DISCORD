'use strict';

const fc = require('fast-check');
const { decideToggle } = require('../src/utils/roleToggle');

// Generator for Discord-snowflake-like role id strings.
const roleIdArb = fc.string({ minLength: 1, maxLength: 20 });

describe('Feature: discord-self-role-bot, Property 2: Selection toggles based on current membership', () => {
  test('decideToggle returns { action: "remove" } iff the member already holds the selected role, otherwise { action: "add" } (Validates: Requirements 2.1, 2.2)', () => {
    fc.assert(
      fc.property(
        // The set of role ids the member currently holds.
        fc.uniqueArray(roleIdArb, { maxLength: 15 }),
        // A freshly generated candidate selected role id (often NOT in the set).
        roleIdArb,
        // An index used to pick an id from within the set (the "held" case).
        fc.nat(),
        // Bias control: when true, select an id the member already holds.
        fc.boolean(),
        (memberRoleIdList, freshRoleId, index, pickFromSet) => {
          const memberRoleIds = new Set(memberRoleIdList);

          // Bias the generation so both branches (held / not held) are covered:
          // when pickFromSet is true and the set is non-empty, pick an id the
          // member already holds; otherwise use the freshly generated id.
          const selectedRoleId =
            pickFromSet && memberRoleIdList.length > 0
              ? memberRoleIdList[index % memberRoleIdList.length]
              : freshRoleId;

          const result = decideToggle(memberRoleIds, selectedRoleId);
          const isHeld = memberRoleIds.has(selectedRoleId);

          // Biconditional: 'remove' if and only if the member already holds the
          // role; 'add' otherwise. expect(...).toEqual covers both at once.
          expect(result).toEqual({ action: isHeld ? 'remove' : 'add' });
        }
      ),
      { numRuns: 200 }
    );
  });
});
