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
  EmbedBuilder,
} = require('discord.js');

const { partitionRoles } = require('../utils/staleRoles');
const { decideToggle } = require('../utils/roleToggle');
const { checkManageable, canManageRole } = require('../utils/roleValidation');
const { isAuthorizedAdmin } = require('../utils/permissions');
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
} = require('../utils/embeds');
const { getRoles, addRole, removeRole, pruneRoles } = require('../models/GuildRoles');

/** customId used for the self-role String Select Menu. */
const ROLE_SELECT_CUSTOM_ID = 'role-select';

/** customId prefixes for the approval buttons (followed by `:requesterId:roleId`). */
const APPROVE_BUTTON_PREFIX = 'role-approve';
const REJECT_BUTTON_PREFIX = 'role-reject';

/**
 * Read the approval-flow configuration from the environment.
 *
 * Approval mode is ENABLED only when both `APPROVAL_CHANNEL_ID` and
 * `APPROVER_ROLE_ID` are set. When either is missing, the bot falls back to the
 * original instant-toggle behaviour so existing deployments are unaffected.
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {{ enabled: boolean, channelId: string, approverRoleId: string }}
 */
function getApprovalConfig(env = process.env) {
  const channelId = (env.APPROVAL_CHANNEL_ID || '').trim();
  const approverRoleId = (env.APPROVER_ROLE_ID || '').trim();
  return {
    enabled: channelId !== '' && approverRoleId !== '',
    channelId,
    approverRoleId,
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
 * Build a safe, generic failure embed used when a Discord side effect throws.
 *
 * @returns {EmbedBuilder}
 */
function genericErrorEmbed() {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Something went wrong')
    .setDescription('I could not complete that action. Please try again in a moment.')
    .setFooter({ text: 'Created by Allan' });
}

/**
 * Reply to an interaction ephemerally, falling back to `followUp` if the
 * interaction has already been replied to or deferred.
 *
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {EmbedBuilder} embed
 * @returns {Promise<unknown>}
 */
function replyEphemeral(interaction, embed) {
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

/**
 * Handle `/role me`.
 *
 * Reads the stored self-role ids, partitions them against the roles that
 * currently exist in the guild, prunes any stale ids from the datastore, and
 * either reports that no roles are available or presents a String Select Menu
 * of the still-valid roles. All replies are ephemeral.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 6.1
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<unknown>}
 */
async function handleRoleMe(interaction) {
  const guildId = interaction.guild.id;

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

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(ROLE_SELECT_CUSTOM_ID)
    .setPlaceholder('Select a role to add or remove')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  return interaction.reply({
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Handle a selection from the self-role String Select Menu (`role-select`).
 *
 * Re-resolves the selected role from the guild cache. If it no longer exists,
 * the id is pruned from the datastore and the member is told the role is no
 * longer available. Otherwise the bot's manageability is checked (Manage Roles
 * permission + role hierarchy); on a guard failure the matching error embed is
 * sent and no role change is made. When manageable, the role is toggled on the
 * member based on their current roles and a confirmation embed is sent. All
 * replies are ephemeral; the role mutation is wrapped in try/catch.
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

  // Approval mode: instead of toggling instantly, send a request to the
  // approval channel for an approver to Accept/Reject.
  const approval = getApprovalConfig();
  if (approval.enabled) {
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
  } catch (err) {
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
      content: `<@&${approval.approverRoleId}>`,
      embeds: [roleRequestEmbed(interaction.member, role)],
      components: [row],
    });

    return replyEphemeral(interaction, requestSubmittedEmbed(role));
  } catch (err) {
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
  const approval = getApprovalConfig();
  const [prefix, requesterId, roleId] = interaction.customId.split(':');
  const approve = prefix === APPROVE_BUTTON_PREFIX;

  // Only members with the approver role may resolve the request.
  const approverRoleId = approval.approverRoleId;
  if (!approverRoleId || !interaction.member.roles.cache.has(approverRoleId)) {
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
  } catch (err) {
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
    } catch (err) {
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
  } catch (err) {
    // If the interaction was already acknowledged or the message is gone, fall
    // back to editing the message directly; ignore any further failure.
    try {
      await interaction.message.edit({ embeds: [embed], components: [] });
    } catch (innerErr) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
