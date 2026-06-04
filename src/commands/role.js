'use strict';

/**
 * `/role` command definition and handlers.
 *
 * This module defines the `/role` slash command (with the `me`, `add`,
 * `remove`, and `list` subcommands) and the handler functions that orchestrate
 * the pure domain helpers (`staleRoles`, `roleToggle`, `roleValidation`,
 * `permissions`, `embeds`) and the per-guild repository (`GuildRoles`).
 *
 * The handlers translate decisions from the pure helpers into Discord side
 * effects (mutating member roles, sending ephemeral embed replies) and prune
 * the datastore of roles that no longer exist in the guild.
 *
 * Member-facing handlers (task 11.1): `handleRoleMe`, `handleRoleSelect`.
 * Admin handlers (`handleRoleAdd`, `handleRoleRemove`, `handleRoleList`) are
 * added in task 11.2; the exports below are structured so they can slot in.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 6.1
 */

const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');

const { partitionRoles } = require('../utils/staleRoles');
const { decideToggle } = require('../utils/roleToggle');
const { checkManageable, canManageRole } = require('../utils/roleValidation');
const { isAuthorizedAdmin } = require('../utils/permissions');
const { genericErrorEmbed, replyEphemeral } = require('../utils/shared');
const {
  roleAddedEmbed,
  roleRemovedEmbed,
  noRolesAvailableEmbed,
  botMissingPermissionEmbed,
  hierarchyErrorEmbed,
  roleNoLongerAvailableEmbed,
  addedConfirmEmbed,
  removedConfirmEmbed,
  duplicateRoleEmbed,
  notInListEmbed,
  listRolesEmbed,
  listEmptyEmbed,
  noPermissionEmbed,
  alreadyHaveRoleEmbed,
  roleRequestEmbed,
  requestSubmittedEmbed,
  notApproverEmbed,
  requestApprovedEmbed,
  requestRejectedEmbed,
  wrongChannelEmbed,
} = require('../utils/embeds');
const { getRoles, addRole, removeRole, pruneRoles } = require('../models/GuildRoles');
const { getConfig: getGuildConfig } = require('../models/GuildConfig');

/** customId used for the self-role String Select Menu. */
const ROLE_SELECT_CUSTOM_ID = 'role-select';

/** customId prefixes for the approval buttons (followed by `:requesterId:roleId`). */
const APPROVE_BUTTON_PREFIX = 'role-approve';
const REJECT_BUTTON_PREFIX = 'role-reject';

/** Maximum options per Discord StringSelectMenu. */
const MAX_OPTIONS_PER_MENU = 25;

/**
 * Read the approval-flow configuration for a guild.
 *
 * Reads from the per-guild DB config first, falling back to `.env` for
 * backward compatibility. Approval mode is ENABLED only when both
 * `approvalChannelId` and at least one `approverRoleId` are set.
 *
 * @param {string} guildId
 * @returns {Promise<{ enabled: boolean, channelId: string, approverRoleIds: string[] }>}
 */
async function getApprovalConfig(guildId) {
  const cfg = await getGuildConfig(guildId);
  return {
    enabled: cfg.approvalEnabled,
    channelId: cfg.approvalChannelId || '',
    approverRoleIds: cfg.approverRoleIds || [],
  };
}

/**
 * The `/role` slash command definition.
 *
 * Subcommands:
 *   - `me`               — open the self-role menu (no permission gate, Req 6.1)
 *   - `add <role>`       — add a role to the self-role list (admin-gated, 11.2)
 *   - `remove <role>`    — remove a role from the self-role list (admin-gated, 11.2)
 *   - `list`             — list the self-assignable roles (admin-gated, 11.2)
 */
const data = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Manage your self-assignable roles')
  .addSubcommand((sub) =>
    sub.setName('me').setDescription('Open a menu to assign or remove your roles'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('add')
      .setDescription('Add a role to the self-assignable list')
      .addRoleOption((opt) =>
        opt.setName('role').setDescription('The role to make self-assignable').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('remove')
      .setDescription('Remove a role from the self-assignable list')
      .addRoleOption((opt) =>
        opt.setName('role').setDescription('The role to remove from the list').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('list').setDescription('List the current self-assignable roles'));

/**
 * Handle `/role me`.
 *
 * Reads the stored self-role ids, partitions them against the roles that
 * currently exist in the guild, prunes any stale ids from the datastore, and
 * either reports that no roles are available or presents a String Select Menu
 * of the still-valid roles. When >25 roles exist, multiple select menus are
 * used (Discord allows up to 5 action rows per message, so up to 125 roles).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 6.1
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<unknown>}
 */
async function handleRoleMe(interaction) {
  const guildId = interaction.guild.id;

  // Channel restriction check: if roleMeChannelIds is configured, only allow
  // the command in those channels. Warn the user and auto-delete after 5 s.
  const cfg = await getGuildConfig(guildId);
  const allowedChannelIds = cfg.roleMeChannelIds || [];
  if (allowedChannelIds.length > 0 && !allowedChannelIds.includes(interaction.channelId)) {
    const reply = await interaction.reply({
      embeds: [wrongChannelEmbed(allowedChannelIds)],
      flags: MessageFlags.Ephemeral,
      fetchReply: true,
    });
    // Auto-delete the ephemeral reply after 5 seconds (best-effort).
    setTimeout(() => {
      interaction.deleteReply().catch(() => {});
    }, 5000);
    return reply;
  }

  const storedIds = await getRoles(guildId);
  const existingRoleIds = new Set(interaction.guild.roles.cache.keys());
  const { validIds, staleIds } = partitionRoles(storedIds, existingRoleIds);

  // Prune any roles that no longer exist from the datastore (Req 1.4).
  if (staleIds.length > 0) {
    await pruneRoles(guildId, staleIds);
  }

  // No roles currently exist for self-assignment (Req 1.2).
  if (validIds.length === 0) {
    return replyEphemeral(interaction, noRolesAvailableEmbed());
  }

  // Build one Select Menu option per still-valid role (Req 1.1, 1.3).
  const options = validIds.map((id) => {
    const role = interaction.guild.roles.cache.get(id);
    return {
      label: role ? role.name : id,
      value: id,
    };
  });

  // Split into multiple select menus if >25 roles (Discord limit).
  const rows = [];
  const totalMenus = Math.min(Math.ceil(options.length / MAX_OPTIONS_PER_MENU), 5);
  for (let i = 0; i < totalMenus; i++) {
    const chunk = options.slice(i * MAX_OPTIONS_PER_MENU, (i + 1) * MAX_OPTIONS_PER_MENU);
    const customId = totalMenus === 1 ? ROLE_SELECT_CUSTOM_ID : `${ROLE_SELECT_CUSTOM_ID}:${i}`;
    const placeholder =
      totalMenus > 1
        ? `Roles (${i * MAX_OPTIONS_PER_MENU + 1}–${i * MAX_OPTIONS_PER_MENU + chunk.length})`
        : 'Select a role to add or remove';
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(chunk);
    rows.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  return interaction.reply({
    components: rows,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle a selection from the self-role String Select Menu (`role-select`).
 *
 * In approval mode:
 *   - If the member DOES NOT have the role → send a request (needs approval).
 *   - If the member ALREADY HAS the role → remove it instantly (no approval
 *     needed to drop a role you already hold).
 *
 * In instant mode: toggle the role on/off.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 *
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @returns {Promise<unknown>}
 */
async function handleRoleSelect(interaction) {
  const guildId = interaction.guild.id;
  const selectedId = interaction.values[0];

  // Re-resolve the role; it may have been deleted since the menu was built.
  const role = interaction.guild.roles.cache.get(selectedId);
  if (!role) {
    // Selected role no longer exists: prune it and inform the member (Req 2.5).
    await pruneRoles(guildId, [selectedId]);
    return replyEphemeral(interaction, roleNoLongerAvailableEmbed());
  }

  const me = interaction.guild.members.me;
  const botHasManageRoles = me.permissions.has(PermissionFlagsBits.ManageRoles);
  const botHighestPosition = me.roles.highest.position;

  const manageable = checkManageable({
    botHasManageRoles,
    roleExists: true,
    rolePosition: role.position,
    botHighestPosition,
  });

  if (!manageable.ok) {
    // Bot lacks Manage Roles (Req 2.3) — no role change.
    if (manageable.reason === 'missing_permission') {
      return replyEphemeral(interaction, botMissingPermissionEmbed());
    }
    // Role sits above the bot's highest role (Req 2.4) — no role change.
    if (manageable.reason === 'hierarchy') {
      return replyEphemeral(interaction, hierarchyErrorEmbed());
    }
    // `not_found` is handled above; any other guard falls through safely.
    return replyEphemeral(interaction, genericErrorEmbed());
  }

  // Approval mode check.
  const approval = await getApprovalConfig(guildId);
  if (approval.enabled) {
    // In approval mode: if the member already holds the role, just remove it
    // (no approval needed for removal). Otherwise submit a request.
    if (interaction.member.roles.cache.has(role.id)) {
      try {
        await interaction.member.roles.remove(selectedId);
        return replyEphemeral(interaction, roleRemovedEmbed(role));
      } catch (_err) {
        return replyEphemeral(interaction, genericErrorEmbed());
      }
    }
    return submitRoleRequest(interaction, role, approval);
  }

  const memberRoleIds = new Set(interaction.member.roles.cache.keys());
  const { action } = decideToggle(memberRoleIds, selectedId);

  try {
    if (action === 'add') {
      await interaction.member.roles.add(selectedId);
      return replyEphemeral(interaction, roleAddedEmbed(role)); // Req 2.1
    }
    await interaction.member.roles.remove(selectedId);
    return replyEphemeral(interaction, roleRemovedEmbed(role)); // Req 2.2
  } catch (_err) {
    // Discord API error during the role mutation — reply safely, assume no
    // partial state.
    return replyEphemeral(interaction, genericErrorEmbed());
  }
}

/**
 * Submit a role request to the approval channel (approval mode).
 *
 * If the member already holds the role, no request is sent (they are told so).
 * Otherwise an embed with Accept/Reject buttons is posted to the configured
 * approval channel, and the member receives an ephemeral confirmation. The
 * button customIds encode the requester id and role id so the click handler can
 * act without external state.
 *
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {import('discord.js').Role} role
 * @param {{ channelId: string, approverRoleId: string }} approval
 * @returns {Promise<unknown>}
 */
async function submitRoleRequest(interaction, role, approval) {
  // If the member already holds the role, do not send a request.
  if (interaction.member.roles.cache.has(role.id)) {
    return replyEphemeral(interaction, alreadyHaveRoleEmbed(role));
  }

  try {
    const channel = await interaction.guild.channels.fetch(approval.channelId);
    if (!channel || !channel.isTextBased()) {
      return replyEphemeral(interaction, genericErrorEmbed());
    }

    const requesterId = interaction.member.id;
    const approveButton = new ButtonBuilder()
      .setCustomId(`${APPROVE_BUTTON_PREFIX}:${requesterId}:${role.id}`)
      .setLabel('Accept')
      .setStyle(ButtonStyle.Success);
    const rejectButton = new ButtonBuilder()
      .setCustomId(`${REJECT_BUTTON_PREFIX}:${requesterId}:${role.id}`)
      .setLabel('Reject')
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder().addComponents(approveButton, rejectButton);

    await channel.send({
      content: approval.approverRoleIds.map((id) => `<@&${id}>`).join(' '),
      embeds: [roleRequestEmbed(interaction.member, role)],
      components: [row],
    });

    return replyEphemeral(interaction, requestSubmittedEmbed(role));
  } catch (_err) {
    return replyEphemeral(interaction, genericErrorEmbed());
  }
}

/**
 * Handle a click on an approval Accept/Reject button.
 *
 * The customId is `role-approve:<requesterId>:<roleId>` or
 * `role-reject:<requesterId>:<roleId>`. Only members holding the configured
 * approver role may act. On Accept the role is granted to the original
 * requester; on Reject nothing is changed. In both cases the request message is
 * edited to a resolved state and the requester is notified via DM (best-effort).
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @returns {Promise<unknown>}
 */
async function handleApprovalButton(interaction) {
  const guildId = interaction.guild.id;
  const approval = await getApprovalConfig(guildId);
  const [prefix, requesterId, roleId] = interaction.customId.split(':');
  const approve = prefix === APPROVE_BUTTON_PREFIX;

  // Only members with one of the approver roles may resolve the request.
  const { approverRoleIds } = approval;
  const hasApproverRole = approverRoleIds.length > 0 &&
    approverRoleIds.some((id) => interaction.member.roles.cache.has(id));
  if (!hasApproverRole) {
    return replyEphemeral(interaction, notApproverEmbed());
  }

  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    // Role disappeared: resolve the message and inform the approver.
    await safeDisableMessage(interaction, roleNoLongerAvailableEmbed());
    return undefined;
  }

  // Re-validate that the bot can still manage the role at click time.
  const me = interaction.guild.members.me;
  const manageable = checkManageable({
    botHasManageRoles: me.permissions.has(PermissionFlagsBits.ManageRoles),
    roleExists: true,
    rolePosition: role.position,
    botHighestPosition: me.roles.highest.position,
  });

  let requester = null;
  try {
    requester = await interaction.guild.members.fetch(requesterId);
  } catch (_err) {
    requester = null;
  }

  if (approve) {
    if (!manageable.ok) {
      const embed =
        manageable.reason === 'missing_permission'
          ? botMissingPermissionEmbed()
          : hierarchyErrorEmbed();
      await safeDisableMessage(interaction, embed);
      return undefined;
    }
    if (!requester) {
      await safeDisableMessage(interaction, genericErrorEmbed());
      return undefined;
    }
    try {
      await requester.roles.add(roleId);
    } catch (_err) {
      await safeDisableMessage(interaction, genericErrorEmbed());
      return undefined;
    }
    const resolved = requestApprovedEmbed(role, interaction.member, requester);
    await safeDisableMessage(interaction, resolved);
    await notifyRequester(requester, resolved);
    return undefined;
  }

  // Reject: no role change.
  const resolved = requestRejectedEmbed(role, interaction.member, requester);
  await safeDisableMessage(interaction, resolved);
  if (requester) {
    await notifyRequester(requester, resolved);
  }
  return undefined;
}

/**
 * Edit the approval message to its resolved state and remove the buttons.
 * Best-effort: swallows errors so a failed edit never throws to the caller.
 *
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {EmbedBuilder} embed
 * @returns {Promise<void>}
 */
async function safeDisableMessage(interaction, embed) {
  try {
    await interaction.update({ embeds: [embed], components: [] });
  } catch (_err) {
    // If the interaction was already acknowledged or the message is gone, fall
    // back to editing the message directly; ignore any further failure.
    try {
      await interaction.message.edit({ embeds: [embed], components: [] });
    } catch (_innerErr) {
      // give up silently
    }
  }
}

/**
 * DM the requester with the outcome of their request (best-effort).
 *
 * @param {import('discord.js').GuildMember} requester
 * @param {EmbedBuilder} embed
 * @returns {Promise<void>}
 */
async function notifyRequester(requester, embed) {
  try {
    await requester.send({ embeds: [embed] });
  } catch (_err) {
    // The requester may have DMs closed; this is non-fatal.
  }
}

/**
 * Handle `/role add`.
 *
 * Admin-gated (Req 6.2/6.3). Resolves the role option, checks role hierarchy
 * against the bot's highest role (Req 3.3), and adds the role to the guild's
 * self-role list. Replies with a confirmation (Req 3.1), a duplicate notice
 * (Req 3.2), or a hierarchy error embed. All replies are ephemeral and the
 * datastore mutation is wrapped in try/catch.
 *
 * Requirements: 3.1, 3.2, 3.3, 6.2, 6.3
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<unknown>}
 */
async function handleRoleAdd(interaction) {
  // Permission gate: non-admins get a no-permission reply and no change (Req 6.2).
  if (!isAuthorizedAdmin(interaction.memberPermissions)) {
    return replyEphemeral(interaction, noPermissionEmbed());
  }

  const guildId = interaction.guild.id;
  const role = interaction.options.getRole('role');

  // Discord resolves the role option, but guard defensively.
  if (!role) {
    return replyEphemeral(interaction, genericErrorEmbed());
  }

  // Reject roles positioned above the bot's highest role (Req 3.3) — no change.
  const botHighestPosition = interaction.guild.members.me.roles.highest.position;
  if (!canManageRole(role.position, botHighestPosition)) {
    return replyEphemeral(interaction, hierarchyErrorEmbed());
  }

  try {
    const result = await addRole(guildId, role.id);
    if (result.changed) {
      return replyEphemeral(interaction, addedConfirmEmbed(role)); // Req 3.1
    }
    // Already present in the list (Req 3.2) — no change.
    if (result.reason === 'duplicate') {
      return replyEphemeral(interaction, duplicateRoleEmbed());
    }
    return replyEphemeral(interaction, genericErrorEmbed());
  } catch (_err) {
    return replyEphemeral(interaction, genericErrorEmbed());
  }
}

/**
 * Handle `/role remove`.
 *
 * Admin-gated (Req 6.2/6.3). Removes the role option from the guild's self-role
 * list. Replies with a confirmation when removed (Req 4.1) or a not-in-list
 * notice when the role was absent (Req 4.2). All replies are ephemeral and the
 * datastore mutation is wrapped in try/catch.
 *
 * Requirements: 4.1, 4.2, 6.2, 6.3
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<unknown>}
 */
async function handleRoleRemove(interaction) {
  // Permission gate: non-admins get a no-permission reply and no change (Req 6.2).
  if (!isAuthorizedAdmin(interaction.memberPermissions)) {
    return replyEphemeral(interaction, noPermissionEmbed());
  }

  const guildId = interaction.guild.id;
  const role = interaction.options.getRole('role');

  if (!role) {
    return replyEphemeral(interaction, genericErrorEmbed());
  }

  try {
    const result = await removeRole(guildId, role.id);
    if (result.changed) {
      return replyEphemeral(interaction, removedConfirmEmbed(role)); // Req 4.1
    }
    // Role was not in the list (Req 4.2) — no change.
    if (result.reason === 'absent') {
      return replyEphemeral(interaction, notInListEmbed());
    }
    return replyEphemeral(interaction, genericErrorEmbed());
  } catch (_err) {
    return replyEphemeral(interaction, genericErrorEmbed());
  }
}

/**
 * Handle `/role list`.
 *
 * Admin-gated (Req 6.2/6.3). Reads the stored ids, partitions them against the
 * roles that currently exist in the guild, prunes any stale ids from the
 * datastore (Req 5.2), and either reports that the list is empty (Req 5.3) or
 * enumerates the still-valid roles (Req 5.1). All replies are ephemeral and the
 * datastore read/prune is wrapped in try/catch.
 *
 * Requirements: 5.1, 5.2, 5.3, 6.2, 6.3
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<unknown>}
 */
async function handleRoleList(interaction) {
  // Permission gate: non-admins get a no-permission reply and no change (Req 6.2).
  if (!isAuthorizedAdmin(interaction.memberPermissions)) {
    return replyEphemeral(interaction, noPermissionEmbed());
  }

  const guildId = interaction.guild.id;

  try {
    const storedIds = await getRoles(guildId);
    const existingRoleIds = new Set(interaction.guild.roles.cache.keys());
    const { validIds, staleIds } = partitionRoles(storedIds, existingRoleIds);

    // Prune any roles that no longer exist from the datastore (Req 5.2).
    if (staleIds.length > 0) {
      await pruneRoles(guildId, staleIds);
    }

    // No valid self-assignable roles remain (Req 5.3).
    if (validIds.length === 0) {
      return replyEphemeral(interaction, listEmptyEmbed());
    }

    // Resolve each valid id to its role object, falling back to a mention so a
    // role that disappeared between partition and reply still renders sensibly.
    const roles = validIds.map(
      (id) => interaction.guild.roles.cache.get(id) || `<@&${id}>`,
    );

    return replyEphemeral(interaction, listRolesEmbed(roles)); // Req 5.1
  } catch (_err) {
    return replyEphemeral(interaction, genericErrorEmbed());
  }
}

module.exports = {
  data,
  ROLE_SELECT_CUSTOM_ID,
  APPROVE_BUTTON_PREFIX,
  REJECT_BUTTON_PREFIX,
  getApprovalConfig,
  handleRoleMe,
  handleRoleSelect,
  handleApprovalButton,
  handleRoleAdd,
  handleRoleRemove,
  handleRoleList,
};
