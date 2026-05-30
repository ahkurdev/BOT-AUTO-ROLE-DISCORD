'use strict';

const mongoose = require('mongoose');
const { addRoleId, removeRoleId } = require('../utils/roleListOps');

/**
 * Mongoose schema for per-guild self-role lists.
 *
 * Document shape (Requirement 7.1):
 *   { guildId: string, roles: string[] }
 *
 * Stored in the `guild_roles` collection. Each guild is represented by a
 * single document keyed by its unique, indexed `guildId`.
 */
const guildRolesSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    roles: { type: [String], default: [] },
  },
  { collection: 'guild_roles' }
);

// Guard against model recompilation (e.g. when test suites re-require this
// module), which would otherwise throw an OverwriteModelError.
const GuildRoles =
  mongoose.models.GuildRoles || mongoose.model('GuildRoles', guildRolesSchema);

/**
 * Repository of per-guild data operations.
 *
 * Every operation is scoped to a single guild's document by filtering on
 * `{ guildId }` (Requirement 7.2). Reads of a guild that has never been
 * written return an empty list; the first write creates the document
 * (Requirement 7.3).
 */

/**
 * Read the stored self-role list for a guild.
 *
 * @param {string} guildId - the guild snowflake to read
 * @returns {Promise<string[]>} the stored role ids, or `[]` when no document
 *   exists for the guild.
 */
async function getRoles(guildId) {
  const doc = await GuildRoles.findOne({ guildId }).lean();
  return doc ? doc.roles : [];
}

/**
 * Replace the stored self-role list for a guild, creating the document on the
 * first write (Requirement 7.3).
 *
 * @param {string} guildId - the guild snowflake to write
 * @param {string[]} roles - the role ids to store
 * @returns {Promise<string[]>} the role ids that were stored.
 */
async function setRoles(guildId, roles) {
  await GuildRoles.findOneAndUpdate(
    { guildId },
    { $set: { roles } },
    { upsert: true }
  );
  return roles;
}

/**
 * Add a role id to a guild's self-role list, never producing a duplicate.
 *
 * Reads the current list, applies the pure `addRoleId` helper, and persists
 * the result only when the list actually changed.
 *
 * @param {string} guildId - the guild snowflake to update
 * @param {string} roleId - the role id to add
 * @returns {Promise<{ roles: string[], changed: boolean, reason: 'added' | 'duplicate' }>}
 *   the decision object describing the outcome.
 */
async function addRole(guildId, roleId) {
  const current = await getRoles(guildId);
  const result = addRoleId(current, roleId);
  if (result.changed) {
    await setRoles(guildId, result.roles);
  }
  return result;
}

/**
 * Remove a role id from a guild's self-role list if it is present.
 *
 * Reads the current list, applies the pure `removeRoleId` helper, and persists
 * the result only when the list actually changed.
 *
 * @param {string} guildId - the guild snowflake to update
 * @param {string} roleId - the role id to remove
 * @returns {Promise<{ roles: string[], changed: boolean, reason: 'removed' | 'absent' }>}
 *   the decision object describing the outcome.
 */
async function removeRole(guildId, roleId) {
  const current = await getRoles(guildId);
  const result = removeRoleId(current, roleId);
  if (result.changed) {
    await setRoles(guildId, result.roles);
  }
  return result;
}

/**
 * Remove a set of stale role ids from a guild's self-role list.
 *
 * No-op when `staleIds` is empty or omitted, or when none of the stale ids are
 * present in the stored list (the datastore is only written when the list
 * actually changes).
 *
 * @param {string} guildId - the guild snowflake to update
 * @param {string[]} staleIds - the role ids to prune
 * @returns {Promise<string[]>} the resulting stored role ids.
 */
async function pruneRoles(guildId, staleIds) {
  if (!staleIds || staleIds.length === 0) {
    return getRoles(guildId);
  }

  const current = await getRoles(guildId);
  const stale = new Set(staleIds);
  const pruned = current.filter((id) => !stale.has(id));

  if (pruned.length !== current.length) {
    return setRoles(guildId, pruned);
  }
  return current;
}

module.exports = {
  GuildRoles,
  getRoles,
  setRoles,
  addRole,
  removeRole,
  pruneRoles,
};
