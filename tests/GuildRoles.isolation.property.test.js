'use strict';

const fc = require('fast-check');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const {
  GuildRoles,
  getRoles,
  setRoles,
  addRole,
  removeRole,
  pruneRoles,
} = require('../src/models/GuildRoles');

/**
 * Feature: discord-self-role-bot, Property 7: Per-guild data isolation
 *
 * Validates: Requirements 7.2
 *
 * Every repository operation is scoped to a single guild's document via
 * `{ guildId }`. For any two distinct guilds A and B, each seeded with its own
 * arbitrary self-role list, applying an arbitrary mutating operation
 * (addRole / removeRole / pruneRoles) to guild A leaves guild B's stored list
 * exactly equal to what was seeded for B.
 */

let mongod;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
  }
});

// Generator for snowflake-like id strings (18-digit numeric strings). A bounded
// numeric space lets ids overlap naturally between the seeded list and the
// operation target without an astronomically large id space.
const snowflakeArb = fc
  .integer({ min: 1, max: 99999 })
  .map((n) => String(100000000000000000n + BigInt(n)));

// Two distinct guild ids.
const twoGuildsArb = fc
  .tuple(snowflakeArb, snowflakeArb)
  .filter(([a, b]) => a !== b);

// A list of role ids (may contain duplicates; the repository / helpers handle
// de-duplication on its own writes — but seeding via setRoles stores as-is).
const roleListArb = fc.array(snowflakeArb, { maxLength: 12 });

// A random mutating operation scoped to a guild.
const operationArb = fc.oneof(
  fc.record({ kind: fc.constant('add'), roleId: snowflakeArb }),
  fc.record({ kind: fc.constant('remove'), roleId: snowflakeArb }),
  fc.record({
    kind: fc.constant('prune'),
    staleIds: fc.array(snowflakeArb, { maxLength: 6 }),
  })
);

async function applyOperation(guildId, op) {
  switch (op.kind) {
    case 'add':
      return addRole(guildId, op.roleId);
    case 'remove':
      return removeRole(guildId, op.roleId);
    case 'prune':
      return pruneRoles(guildId, op.staleIds);
    default:
      throw new Error(`unknown operation kind: ${op.kind}`);
  }
}

describe('Feature: discord-self-role-bot, Property 7: Per-guild data isolation', () => {
  test('mutating one guild leaves the other guild unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        twoGuildsArb,
        roleListArb, // seed for guild A
        roleListArb, // seed for guild B
        operationArb, // operation applied to guild A
        async ([guildA, guildB], seedA, seedB, op) => {
          // Start each run from a clean collection so state from prior runs
          // cannot leak between iterations.
          await GuildRoles.deleteMany({});

          // Seed both guilds with their own lists.
          await setRoles(guildA, seedA);
          await setRoles(guildB, seedB);

          // Capture guild B's stored list exactly as persisted before the op.
          const before = await getRoles(guildB);

          // Mutate only guild A.
          await applyOperation(guildA, op);

          // Guild B's stored list must be unchanged by an operation on guild A.
          const after = await getRoles(guildB);
          expect(after).toEqual(before);
          // And it must still equal exactly what was seeded for B.
          expect(after).toEqual(seedB);
        }
      ),
      { numRuns: 100 }
    );
  }, 120000);
});
