'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  GuildRoles,
  getRoles,
  setRoles,
} = require('../src/models/GuildRoles');

/**
 * Unit tests for the GuildRoles repository document shape and upsert behaviour.
 *
 * Validates: Requirements 7.1, 7.3
 *
 *   7.1 The Bot SHALL store the Self_Role_List for each Guild as a Role_Datastore
 *       document of shape `{ guildId: string, roles: string[] }`.
 *   7.3 IF no Role_Datastore document exists for the Guild when the
 *       Self_Role_List is first written, THEN the Bot SHALL create a document.
 *
 * Backed by mongodb-memory-server so the repository exercises real Mongoose
 * persistence (no mocks) against an in-memory MongoDB instance.
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

beforeEach(async () => {
  await GuildRoles.deleteMany({});
});

describe('GuildRoles repository: document shape and upsert (Requirements 7.1, 7.3)', () => {
  const guildId = '100000000000000001';

  test('getRoles returns [] when no document exists for the guild', async () => {
    const roles = await getRoles(guildId);

    expect(roles).toEqual([]);

    // Confirm we truly observed an absent document, not an empty stored one.
    const doc = await GuildRoles.findOne({ guildId });
    expect(doc).toBeNull();
  });

  test('first setRoles with no existing document creates one (upsert, Requirement 7.3)', async () => {
    // Precondition: no document exists yet.
    expect(await GuildRoles.findOne({ guildId })).toBeNull();

    const returned = await setRoles(guildId, ['r1', 'r2']);
    expect(returned).toEqual(['r1', 'r2']);

    // A document was created by the upsert.
    const doc = await GuildRoles.findOne({ guildId });
    expect(doc).not.toBeNull();
    expect(doc.guildId).toBe(guildId);
    expect(doc.roles).toEqual(['r1', 'r2']);
  });

  test('stored document shape matches { guildId, roles } (Requirement 7.1)', async () => {
    await setRoles(guildId, ['r1', 'r2']);

    const doc = await GuildRoles.findOne({ guildId }).lean();
    expect(doc).not.toBeNull();

    // The persisted payload carries exactly the guildId and roles fields with
    // the contractual types (alongside Mongoose-managed _id / __v metadata).
    expect(typeof doc.guildId).toBe('string');
    expect(doc.guildId).toBe(guildId);
    expect(Array.isArray(doc.roles)).toBe(true);
    expect(doc.roles).toEqual(['r1', 'r2']);
    doc.roles.forEach((id) => expect(typeof id).toBe('string'));

    // Application-owned fields are limited to guildId and roles.
    const appKeys = Object.keys(doc).filter(
      (k) => k !== '_id' && k !== '__v'
    );
    expect(appKeys.sort()).toEqual(['guildId', 'roles']);
  });

  test('a second setRoles updates the same document rather than duplicating it', async () => {
    await setRoles(guildId, ['r1', 'r2']);
    await setRoles(guildId, ['r3']);

    // Still exactly one document for this guild.
    const count = await GuildRoles.countDocuments({ guildId });
    expect(count).toBe(1);

    // And it reflects the latest write.
    const doc = await GuildRoles.findOne({ guildId });
    expect(doc.guildId).toBe(guildId);
    expect(doc.roles).toEqual(['r3']);

    // The repository read agrees with the stored state.
    expect(await getRoles(guildId)).toEqual(['r3']);
  });
});
