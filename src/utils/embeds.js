'use strict';

const { EmbedBuilder } = require('discord.js');
const { BRAND_FOOTER, COLORS, applyBranding, branded } = require('./shared');

/**
 * Centralized, pure embed builders for every Response_Embed the bot sends.
 *
 * Each builder returns a discord.js {@link EmbedBuilder}. Keeping all user-facing
 * copy here makes message text consistent and easy to unit-test. None of these
 * functions perform I/O; they only construct embed descriptors.
 *
 * Color palette (kept simple and consistent across the bot):
 *   - success  : green
 *   - error    : red
 *   - warning  : amber
 *   - info     : blurple
 */
// COLORS imported from ./shared

/**
 * Render a role parameter as a human-friendly string.
 *
 * Accepts:
 *   - a discord.js Role-like object exposing `.toString()` (mention) and/or `.name`
 *   - a plain string that is already a mention or a role name
 *
 * Prefers a mention (`role.toString()` -> `<@&id>`) when available, otherwise
 * falls back to the role name, otherwise to the raw string value.
 *
 * @param {object|string} role - role object, mention, or name
 * @returns {string} a display string for the role
 */
function formatRole(role) {
  if (role == null) {
    return 'the role';
  }
  if (typeof role === 'string') {
    return role;
  }
  // Role-like object: prefer a mention via toString(), fall back to name.
  if (typeof role.toString === 'function') {
    const mention = role.toString();
    // Guard against the default Object.prototype.toString output.
    if (mention && mention !== '[object Object]') {
      return mention;
    }
  }
  if (typeof role.name === 'string' && role.name.length > 0) {
    return role.name;
  }
  return 'the role';
}

/**
 * "Role added" — the member selected a role they did not hold and it was assigned.
 * @param {object|string} role - the role that was assigned to the member
 * @returns {EmbedBuilder}
 */
function roleAddedEmbed(role) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('Role ditambahkan')
    .setDescription(`Kamu sekarang memiliki ${formatRole(role)}.`);
}

/**
 * "Role removed" — the member selected a role they held and it was removed.
 * @param {object|string} role - the role that was removed from the member
 * @returns {EmbedBuilder}
 */
function roleRemovedEmbed(role) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Role dilepas')
    .setDescription(`${formatRole(role)} telah dilepas dari kamu.`);
}

/**
 * "That role is already in the list" — admin tried to add a role already present.
 * @returns {EmbedBuilder}
 */
function duplicateRoleEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Role sudah ada di daftar')
    .setDescription('Tidak ada perubahan pada daftar self-role.');
}

/**
 * "That role isn't in the list" — admin tried to remove a role that is absent.
 * @returns {EmbedBuilder}
 */
function notInListEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Role tidak ada di daftar')
    .setDescription('Tidak ada perubahan pada daftar self-role.');
}

/**
 * Confirms an admin successfully added a role to the self-role list.
 * @param {object|string} role - the role that was added
 * @returns {EmbedBuilder}
 */
function addedConfirmEmbed(role) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('Role ditambahkan ke daftar self-role')
    .setDescription(`${formatRole(role)} sekarang bisa diambil sendiri oleh member.`);
}

/**
 * Confirms an admin successfully removed a role from the self-role list.
 * @param {object|string} role - the role that was removed
 * @returns {EmbedBuilder}
 */
function removedConfirmEmbed(role) {
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('Role dihapus dari daftar self-role')
    .setDescription(`${formatRole(role)} tidak lagi bisa diambil sendiri oleh member.`);
}

/**
 * `/role me` — no self-assignable roles currently exist in the guild.
 * @returns {EmbedBuilder}
 */
function noRolesAvailableEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('Tidak ada role tersedia')
    .setDescription('Belum ada role yang bisa diambil sendiri saat ini.');
}

/**
 * `/role list` — the self-role list is empty.
 * @returns {EmbedBuilder}
 */
function listEmptyEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('Daftar self-role kosong')
    .setDescription('Belum ada role yang ditambahkan ke daftar self-role.');
}

/**
 * `/role list` — enumerate the current self-assignable roles.
 *
 * @param {Array<object|string>} roles - the roles to enumerate (objects, mentions, or names)
 * @returns {EmbedBuilder}
 */
function listRolesEmbed(roles) {
  const list = Array.isArray(roles) ? roles : [];
  const lines = list.map((role) => `- ${formatRole(role)}`);
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('Daftar self-role')
    .setDescription(lines.length > 0 ? lines.join('\n') : 'Tidak ada role.');
}

/**
 * The bot lacks the Manage Roles permission and cannot toggle the member's role.
 * @returns {EmbedBuilder}
 */
function botMissingPermissionEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Tidak bisa mengatur role')
    .setDescription(
      'Bot tidak memiliki permission **Manage Roles**, jadi tidak bisa mengubah role kamu. '
        + 'Minta administrator untuk memberikan permission tersebut.',
    );
}

/**
 * The role cannot be managed because it sits above the bot's highest role.
 * @returns {EmbedBuilder}
 */
function hierarchyErrorEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Tidak bisa mengatur role ini')
    .setDescription(
      'Role tersebut posisinya lebih tinggi dari role tertinggi bot, jadi tidak bisa dikelola karena hierarki role.',
    );
}

/**
 * The selected role no longer exists in the guild at the time of selection.
 * @returns {EmbedBuilder}
 */
function roleNoLongerAvailableEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Role tidak tersedia lagi')
    .setDescription('Role tersebut sudah tidak ada dan telah dihapus dari daftar self-role.');
}

/**
 * The member lacks permission to use an admin subcommand.
 * @returns {EmbedBuilder}
 */
function noPermissionEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Tidak berwenang')
    .setDescription(
      'Kamu memerlukan permission **Administrator** atau **Manage Roles** untuk menggunakan perintah ini.',
    );
}

// ---------------------------------------------------------------------------
// Approval-flow embeds (used when APPROVAL_CHANNEL_ID + APPROVER_ROLE_ID are
// configured). These are the messages an end user sees, so the copy is in
// Indonesian to match the operator's audience.
// ---------------------------------------------------------------------------

/**
 * Render a requester (GuildMember-like) as a mention, falling back to a tag.
 * @param {object|string} requester
 * @returns {string}
 */
function formatRequester(requester) {
  if (requester == null) {
    return 'Member';
  }
  if (typeof requester === 'string') {
    return requester;
  }
  if (typeof requester.toString === 'function') {
    const mention = requester.toString();
    if (mention && mention !== '[object Object]') {
      return mention;
    }
  }
  if (requester.user && requester.user.tag) {
    return requester.user.tag;
  }
  return 'Member';
}

/**
 * The member already holds the role they requested via `/role me`.
 * @param {object|string} role
 * @returns {EmbedBuilder}
 */
function alreadyHaveRoleEmbed(role) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Kamu sudah punya role ini')
    .setDescription(`Kamu sudah memiliki ${formatRole(role)}, jadi tidak ada permintaan yang dikirim.`);
}

/**
 * Approval request posted to the approval channel, awaiting Accept/Reject.
 * @param {object|string} requester - the requesting GuildMember (or mention)
 * @param {object|string} role - the requested role
 * @returns {EmbedBuilder}
 */
function roleRequestEmbed(requester, role) {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('Permintaan role')
    .setDescription(`${formatRequester(requester)} meminta role ${formatRole(role)}.`)
    .addFields({ name: 'Status', value: 'Menunggu persetujuan' });
}

/**
 * Ephemeral confirmation to the member that their request was submitted.
 * @param {object|string} role
 * @returns {EmbedBuilder}
 */
function requestSubmittedEmbed(role) {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('Permintaan terkirim')
    .setDescription(`Permintaanmu untuk role ${formatRole(role)} sudah dikirim. Mohon tunggu persetujuan.`);
}

/**
 * The clicker is not allowed to approve/reject requests.
 * @returns {EmbedBuilder}
 */
function notApproverEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Tidak berwenang')
    .setDescription('Hanya approver yang ditunjuk yang bisa menyetujui atau menolak permintaan ini.');
}

/**
 * The request was approved — used to edit the channel message and to DM.
 * @param {object|string} role
 * @param {object|string} approver - the GuildMember who approved (or mention)
 * @param {object|string} [requester] - the requester (or mention)
 * @returns {EmbedBuilder}
 */
function requestApprovedEmbed(role, approver, requester) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('Permintaan disetujui')
    .setDescription(
      `Role ${formatRole(role)} telah diberikan${requester ? ` kepada ${formatRequester(requester)}` : ''}.`,
    );
  if (approver) {
    embed.addFields({ name: 'Disetujui oleh', value: formatRequester(approver) });
  }
  return embed;
}

/**
 * The request was rejected — used to edit the channel message and to DM.
 * @param {object|string} role
 * @param {object|string} approver - the GuildMember who rejected (or mention)
 * @param {object|string} [requester] - the requester (or mention)
 * @returns {EmbedBuilder}
 */
function requestRejectedEmbed(role, approver, requester) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Permintaan ditolak')
    .setDescription(
      `Permintaan role ${formatRole(role)}${requester ? ` dari ${formatRequester(requester)}` : ''} ditolak.`,
    );
  if (approver) {
    embed.addFields({ name: 'Ditolak oleh', value: formatRequester(approver) });
  }
  return embed;
}

// BRAND_FOOTER, applyBranding, branded imported from ./shared

/**
 * Warning shown when `/role me` is used in a channel that is not in the allowed list.
 * @param {string[]} allowedChannelIds - the IDs of channels where the command is allowed
 * @returns {EmbedBuilder}
 */
function wrongChannelEmbed(allowedChannelIds) {
  const list =
    Array.isArray(allowedChannelIds) && allowedChannelIds.length > 0
      ? allowedChannelIds.map((id) => `<#${id}>`).join(', ')
      : '_tidak ada_';
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Channel tidak diizinkan')
    .setDescription(
      `Perintah \`/role me\` hanya boleh digunakan di channel yang sudah ditentukan.\n\n**Channel yang diizinkan:** ${list}`,
    );
}

module.exports = {
  BRAND_FOOTER,
  applyBranding,
  formatRole,
  formatRequester,
  roleAddedEmbed: branded(roleAddedEmbed),
  roleRemovedEmbed: branded(roleRemovedEmbed),
  duplicateRoleEmbed: branded(duplicateRoleEmbed),
  notInListEmbed: branded(notInListEmbed),
  addedConfirmEmbed: branded(addedConfirmEmbed),
  removedConfirmEmbed: branded(removedConfirmEmbed),
  noRolesAvailableEmbed: branded(noRolesAvailableEmbed),
  listEmptyEmbed: branded(listEmptyEmbed),
  listRolesEmbed: branded(listRolesEmbed),
  botMissingPermissionEmbed: branded(botMissingPermissionEmbed),
  hierarchyErrorEmbed: branded(hierarchyErrorEmbed),
  roleNoLongerAvailableEmbed: branded(roleNoLongerAvailableEmbed),
  noPermissionEmbed: branded(noPermissionEmbed),
  alreadyHaveRoleEmbed: branded(alreadyHaveRoleEmbed),
  roleRequestEmbed: branded(roleRequestEmbed),
  requestSubmittedEmbed: branded(requestSubmittedEmbed),
  notApproverEmbed: branded(notApproverEmbed),
  requestApprovedEmbed: branded(requestApprovedEmbed),
  requestRejectedEmbed: branded(requestRejectedEmbed),
  wrongChannelEmbed: branded(wrongChannelEmbed),
};
