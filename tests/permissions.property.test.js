'use strict';

const fc = require('fast-check');
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { isAuthorizedAdmin } = require('../src/utils/permissions');

// All available Discord permission flag bits as [name, bigint] pairs.
const ALL_FLAG_ENTRIES = Object.entries(PermissionFlagsBits);

// Arbitrary that picks a random subset of permission flag bits. Each flag is
// independently included or excluded, so Administrator and ManageRoles appear
// in both present and absent configurations across runs.
const flagSubsetArb = fc
  .uniqueArray(fc.constantFrom(...ALL_FLAG_ENTRIES.map(([, bit]) => bit)), {
    minLength: 0,
    maxLength: ALL_FLAG_ENTRIES.length,
  });

describe('Feature: discord-self-role-bot, Property 6: Admin authorization predicate', () => {
  test('isAuthorizedAdmin returns true iff the member holds Administrator OR ManageRoles (Validates: Requirements 6.2, 6.3)', () => {
    fc.assert(
      fc.property(flagSubsetArb, (selectedBits) => {
        // Build a real discord.js permissions object from the chosen flag bits.
        const memberPermissions = new PermissionsBitField(selectedBits);

        // Expected truth computed directly from the chosen set, independent of
        // the implementation: true iff Administrator or ManageRoles was chosen.
        const expected =
          selectedBits.includes(PermissionFlagsBits.Administrator) ||
          selectedBits.includes(PermissionFlagsBits.ManageRoles);

        expect(isAuthorizedAdmin(memberPermissions)).toBe(expected);
      }),
      { numRuns: 200 }
    );
  });
});
