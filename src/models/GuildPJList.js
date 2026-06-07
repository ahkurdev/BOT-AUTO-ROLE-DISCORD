'use strict';

const mongoose = require('mongoose');

/**
 * Tracks the "Penanggung Jawab" (PJ) for specific roles held by users.
 *
 * Collection: `guild_pj_list`
 */
const guildPjListSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    roleId: { type: String, required: true },
    pjId: { type: String, required: true }, // The user tagged as PJ
    createdAt: { type: Date, default: Date.now }
  },
  { collection: 'guild_pj_list' }
);

// Compound index to ensure a user only has one PJ record per role
guildPjListSchema.index({ guildId: 1, userId: 1, roleId: 1 }, { unique: true });

const GuildPjList = mongoose.models.GuildPjList || mongoose.model('GuildPjList', guildPjListSchema);

/**
 * Add or update a PJ record for a user's role.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} roleId
 * @param {string} pjId
 */
async function setPjRecord(guildId, userId, roleId, pjId) {
  return GuildPjList.findOneAndUpdate(
    { guildId, userId, roleId },
    { $set: { pjId, createdAt: new Date() } },
    { upsert: true, new: true }
  );
}

/**
 * Remove a PJ record when a user drops a role.
 * @param {string} guildId
 * @param {string} userId
 * @param {string} roleId
 */
async function removePjRecord(guildId, userId, roleId) {
  return GuildPjList.findOneAndDelete({ guildId, userId, roleId });
}

/**
 * Get all PJ records for a guild, optionally filtered by roleId.
 * @param {string} guildId
 * @param {string} [roleId]
 */
async function getPjRecords(guildId, roleId = null) {
  const query = { guildId };
  if (roleId) query.roleId = roleId;
  return GuildPjList.find(query).sort({ createdAt: 1 }).lean();
}

/**
 * Remove all PJ records for a specific role (e.g., when a role is deleted).
 * @param {string} guildId
 * @param {string} roleId
 */
async function pruneRolePjs(guildId, roleId) {
  return GuildPjList.deleteMany({ guildId, roleId });
}

module.exports = {
  GuildPjList,
  setPjRecord,
  removePjRecord,
  getPjRecords,
  pruneRolePjs
};
