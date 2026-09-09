'use strict';

const mongoose = require('mongoose');

/**
 * Per-guild bot configuration.
 *
 * Stores settings that were previously hard-coded in `.env`, enabling true
 * multi-guild support. When no guild-specific value exists, the repository
 * functions fall back to the corresponding environment variable so existing
 * single-guild deployments continue to work without migration.
 *
 * Collection: `guild_config`
 */
const guildConfigSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    /** Up to 3 approver role IDs. */
    approverRoleIds: { type: [String], default: [] },
    approvalChannelId: { type: String, default: null },
    /**
     * Channel IDs where `/role me` is allowed.
     * When empty (default), the command is allowed in ALL channels.
     */
    roleMeChannelIds: { type: [String], default: [] },
    /** Channel ID where the PJ List embed should be maintained. */
    pjListChannelId: { type: String, default: null },
    /** Message ID of the PJ List embed. */
    pjListMessageId: { type: String, default: null },
    /** Message ID of the Tutorial embed in the role channel. */
    tutorialMessageId: { type: String, default: null },
    /** Channel IDs where `/wd` (withdraw) is allowed. */
    wdChannelIds: { type: [String], default: [] },
    /** Channel IDs where `/dp` (deposit) is allowed. */
    dpChannelIds: { type: [String], default: [] },
  },
  { collection: 'guild_config' },
);

const GuildConfig =
  mongoose.models.GuildConfig || mongoose.model('GuildConfig', guildConfigSchema);

/**
 * Get the merged config for a guild (DB values take precedence over env).
 *
 * `approverRoleIds` is an array of up to 3 role IDs. For backwards
 * compatibility the legacy `APPROVER_ROLE_ID` env var is included as a
 * fallback when no DB roles are configured.
 *
 * @param {string} guildId
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {Promise<{
 *   guildId: string,
 *   approverRoleIds: string[],
 *   approvalChannelId: string|null,
 *   approvalEnabled: boolean,
 *   roleMeChannelIds: string[],
 *   wdChannelIds: string[],
 *   dpChannelIds: string[]
 * }>}
 */
async function getConfig(guildId, env = process.env) {
  const doc = await GuildConfig.findOne({ guildId }).lean();

  // Merge DB roles with the legacy env fallback.
  const dbRoles = (doc && Array.isArray(doc.approverRoleIds) ? doc.approverRoleIds : []).filter(Boolean);
  const envRole = (env.APPROVER_ROLE_ID || '').trim();
  const approverRoleIds = dbRoles.length > 0 ? dbRoles : (envRole ? [envRole] : []);

  const roleMeChannelIds = (doc && Array.isArray(doc.roleMeChannelIds) ? doc.roleMeChannelIds : []).filter(Boolean);
  const pjListChannelId = (doc && doc.pjListChannelId) || null;
  const pjListMessageId = (doc && doc.pjListMessageId) || null;
  const tutorialMessageId = (doc && doc.tutorialMessageId) || null;
  
  const wdChannelIds = (doc && Array.isArray(doc.wdChannelIds) ? doc.wdChannelIds : []).filter(Boolean);
  const dpChannelIds = (doc && Array.isArray(doc.dpChannelIds) ? doc.dpChannelIds : []).filter(Boolean);

  // Approval channel (schema field). approvalEnabled true only when a channel
  // is set AND at least one approver role exists (env fallback included).
  const approvalChannelId = (doc && doc.approvalChannelId) || env.APPROVAL_CHANNEL_ID?.trim() || null;

  return {
    guildId,
    approverRoleIds,
    approvalChannelId,
    approvalEnabled: Boolean(approvalChannelId && approverRoleIds.length > 0),
    roleMeChannelIds,
    pjListChannelId,
    pjListMessageId,
    tutorialMessageId,
    wdChannelIds,
    dpChannelIds,
  };
}

/**
 * Check whether a member is an approver.
 *
 * @param {{ roles: { cache: Map<string, unknown> } }} member - GuildMember-like
 * @param {string[]} approverRoleIds
 * @returns {boolean}
 */
function isMemberApprover(member, approverRoleIds) {
  if (!approverRoleIds || approverRoleIds.length === 0) return false;
  return approverRoleIds.some((id) => member.roles.cache.has(id));
}

/**
 * Add an approver role (max 3). Returns `{ added, reason }`.
 * @param {string} guildId
 * @param {string} roleId
 */
async function addApproverRole(guildId, roleId) {
  const doc = await GuildConfig.findOne({ guildId }).lean();
  const current = (doc && Array.isArray(doc.approverRoleIds) ? doc.approverRoleIds : []).filter(Boolean);
  if (current.includes(roleId)) {
    return { added: false, reason: 'duplicate', approverRoleIds: current };
  }
  if (current.length >= 3) {
    return { added: false, reason: 'limit_reached', approverRoleIds: current };
  }
  const next = [...current, roleId];
  await GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { approverRoleIds: next } },
    { upsert: true, new: true },
  );
  return { added: true, reason: 'ok', approverRoleIds: next };
}

/**
 * Remove an approver role. Returns `{ removed, reason }`.
 * @param {string} guildId
 * @param {string} roleId
 */
async function removeApproverRole(guildId, roleId) {
  const doc = await GuildConfig.findOne({ guildId }).lean();
  const current = (doc && Array.isArray(doc.approverRoleIds) ? doc.approverRoleIds : []).filter(Boolean);
  if (!current.includes(roleId)) {
    return { removed: false, reason: 'not_found', approverRoleIds: current };
  }
  const next = current.filter((id) => id !== roleId);
  await GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { approverRoleIds: next } },
    { upsert: true, new: true },
  );
  return { removed: true, reason: 'ok', approverRoleIds: next };
}

/**
 * Replace all approver roles at once (backwards-compat helper).
 * @param {string} guildId
 * @param {string[]} roleIds
 */
async function setApproverRoles(guildId, roleIds) {
  const next = (Array.isArray(roleIds) ? roleIds : []).filter(Boolean).slice(0, 3);
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { approverRoleIds: next } },
    { upsert: true, new: true },
  );
}

/**
 * Set the PJ List channel and reset the message ID.
 * @param {string} guildId
 * @param {string|null} channelId
 */
async function setPjListChannel(guildId, channelId) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { pjListChannelId: channelId, pjListMessageId: null } },
    { upsert: true, new: true },
  );
}

/**
 * Save the PJ List message ID.
 * @param {string} guildId
 * @param {string|null} messageId
 */
async function setPjListMessageId(guildId, messageId) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { pjListMessageId: messageId } },
    { upsert: true, new: true },
  );
}

/**
 * Save the Tutorial message ID.
 * @param {string} guildId
 * @param {string|null} messageId
 */
async function setTutorialMessageId(guildId, messageId) {
  return GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { tutorialMessageId: messageId } },
    { upsert: true, new: true },
  );
}

/**
 * Add a channel to the `/role me` allowed-channel list.
 * @param {string} guildId
 * @param {string} channelId
 * @returns {Promise<{ added: boolean, reason: string, roleMeChannelIds: string[] }>}
 */
async function addRoleMeChannel(guildId, channelId) {
  const doc = await GuildConfig.findOne({ guildId }).lean();
  const current = (doc && Array.isArray(doc.roleMeChannelIds) ? doc.roleMeChannelIds : []).filter(Boolean);
  if (current.includes(channelId)) {
    return { added: false, reason: 'duplicate', roleMeChannelIds: current };
  }
  const next = [...current, channelId];
  await GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { roleMeChannelIds: next } },
    { upsert: true, new: true },
  );
  return { added: true, reason: 'ok', roleMeChannelIds: next };
}

/**
 * Remove a channel from the `/role me` allowed-channel list.
 * @param {string} guildId
 * @param {string} channelId
 * @returns {Promise<{ removed: boolean, reason: string, roleMeChannelIds: string[] }>}
 */
async function removeRoleMeChannel(guildId, channelId) {
  const doc = await GuildConfig.findOne({ guildId }).lean();
  const current = (doc && Array.isArray(doc.roleMeChannelIds) ? doc.roleMeChannelIds : []).filter(Boolean);
  if (!current.includes(channelId)) {
    return { removed: false, reason: 'not_found', roleMeChannelIds: current };
  }
  const next = current.filter((id) => id !== channelId);
  await GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { roleMeChannelIds: next } },
    { upsert: true, new: true },
  );
  return { removed: true, reason: 'ok', roleMeChannelIds: next };
}

/**
 * Generic helper: add a channelId to a list field.
 * @param {string} guildId
 * @param {string} field - schema field name
 * @param {string} channelId
 */
async function _addChannel(guildId, field, channelId) {
  const doc = await GuildConfig.findOne({ guildId }).lean();
  const current = (doc && Array.isArray(doc[field]) ? doc[field] : []).filter(Boolean);
  if (current.includes(channelId)) {
    return { added: false, reason: 'duplicate', channelIds: current };
  }
  const next = [...current, channelId];
  await GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { [field]: next } },
    { upsert: true, new: true },
  );
  return { added: true, reason: 'ok', channelIds: next };
}

/**
 * Generic helper: remove a channelId from a list field.
 * @param {string} guildId
 * @param {string} field - schema field name
 * @param {string} channelId
 */
async function _removeChannel(guildId, field, channelId) {
  const doc = await GuildConfig.findOne({ guildId }).lean();
  const current = (doc && Array.isArray(doc[field]) ? doc[field] : []).filter(Boolean);
  if (!current.includes(channelId)) {
    return { removed: false, reason: 'not_found', channelIds: current };
  }
  const next = current.filter((id) => id !== channelId);
  await GuildConfig.findOneAndUpdate(
    { guildId },
    { $set: { [field]: next } },
    { upsert: true, new: true },
  );
  return { removed: true, reason: 'ok', channelIds: next };
}

const addWdChannel = (guildId, channelId) => _addChannel(guildId, 'wdChannelIds', channelId);
const removeWdChannel = (guildId, channelId) => _removeChannel(guildId, 'wdChannelIds', channelId);
const addDpChannel = (guildId, channelId) => _addChannel(guildId, 'dpChannelIds', channelId);
const removeDpChannel = (guildId, channelId) => _removeChannel(guildId, 'dpChannelIds', channelId);

module.exports = {
  GuildConfig,
  getConfig,
  isMemberApprover,
  addApproverRole,
  removeApproverRole,
  setApproverRoles,
  setPjListChannel,
  setPjListMessageId,
  setTutorialMessageId,
  addRoleMeChannel,
  removeRoleMeChannel,
  addWdChannel,
  removeWdChannel,
  addDpChannel,
  removeDpChannel,
};
