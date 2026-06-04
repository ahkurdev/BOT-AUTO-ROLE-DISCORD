'use strict';

/**
 * `/config` command — per-guild bot configuration.
 *
 * Allows administrators to configure the bot for their server directly from
 * Discord, without needing to edit `.env` and restart.
 *
 *   - `approver add <role>`     — add a role to the approver list (max 3).
 *   - `approver remove <role>`  — remove a role from the approver list.
 *   - `approval-channel <ch>`   — set the channel for role-approval requests.
 *   - `show`                    — display the current configuration.
 */

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getConfig,
  addApproverRole,
  removeApproverRole,
  setApprovalChannel,
  addRoleMeChannel,
  removeRoleMeChannel,
  addWdChannel,
  removeWdChannel,
  addDpChannel,
  removeDpChannel,
} = require('../models/GuildConfig');
const { COLORS, applyBranding, replyEphemeral } = require('../utils/shared');

const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Konfigurasi bot untuk server ini')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommandGroup((group) =>
    group
      .setName('approver')
      .setDescription('Kelola daftar role approver (maks 3 role)')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Tambah role ke daftar approver')
          .addRoleOption((opt) =>
            opt.setName('role').setDescription('Role yang ditambahkan').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Hapus role dari daftar approver')
          .addRoleOption((opt) =>
            opt.setName('role').setDescription('Role yang dihapus').setRequired(true),
          ),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('approval-channel')
      .setDescription('Set channel approval role untuk server ini')
      .addChannelOption((opt) =>
        opt.setName('channel').setDescription('Channel approval').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('show').setDescription('Tampilkan konfigurasi saat ini'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('role-channel')
      .setDescription('Kelola channel yang diizinkan untuk /role me')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Tambah channel yang diizinkan untuk /role me')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel yang diizinkan').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Hapus channel dari daftar izin /role me')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel yang dihapus').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('Lihat daftar channel yang diizinkan untuk /role me'),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('wd-channel')
      .setDescription('Kelola channel khusus untuk /wd (withdraw)')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Tambah channel khusus /wd')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel yang diizinkan').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Hapus channel dari daftar /wd')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel yang dihapus').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('Lihat daftar channel yang diizinkan untuk /wd'),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('dp-channel')
      .setDescription('Kelola channel khusus untuk /dp (deposit)')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Tambah channel khusus /dp')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel yang diizinkan').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Hapus channel dari daftar /dp')
          .addChannelOption((opt) =>
            opt.setName('channel').setDescription('Channel yang dihapus').setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub.setName('list').setDescription('Lihat daftar channel yang diizinkan untuk /dp'),
      ),
  );

/**
 * Handle the `/config` command.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleConfig(interaction) {
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('Tidak berwenang')
          .setDescription('Hanya Administrator yang bisa menggunakan perintah ini.'),
      ),
    );
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  // /config approver add|remove
  if (group === 'approver') {
    const role = interaction.options.getRole('role');
    if (sub === 'add') {
      const result = await addApproverRole(guildId, role.id);
      if (!result.added) {
        const msg =
          result.reason === 'duplicate'
            ? `${role} sudah ada di daftar approver.`
            : 'Maksimal 3 role approver. Hapus salah satu dulu sebelum menambah yang baru.';
        return replyEphemeral(
          interaction,
          applyBranding(new EmbedBuilder().setColor(COLORS.warning).setTitle('Tidak dapat menambah').setDescription(msg)),
        );
      }
      const list = result.approverRoleIds.map((id) => `<@&${id}>`).join(', ');
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('Approver ditambah')
            .setDescription(`${role} ditambahkan ke daftar approver.`)
            .addFields({ name: 'Daftar approver saat ini', value: list }),
        ),
      );
    }

    if (sub === 'remove') {
      const result = await removeApproverRole(guildId, role.id);
      if (!result.removed) {
        return replyEphemeral(
          interaction,
          applyBranding(
            new EmbedBuilder()
              .setColor(COLORS.warning)
              .setTitle('Tidak ditemukan')
              .setDescription(`${role} tidak ada di daftar approver.`),
          ),
        );
      }
      const list =
        result.approverRoleIds.length > 0
          ? result.approverRoleIds.map((id) => `<@&${id}>`).join(', ')
          : '_Kosong_';
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('Approver dihapus')
            .setDescription(`${role} dihapus dari daftar approver.`)
            .addFields({ name: 'Daftar approver saat ini', value: list }),
        ),
      );
    }
  }

  // /config role-channel add|remove|list
  if (group === 'role-channel') {
    const sub2 = interaction.options.getSubcommand();

    if (sub2 === 'add') {
      const channel = interaction.options.getChannel('channel');
      const result = await addRoleMeChannel(guildId, channel.id);
      if (!result.added) {
        return replyEphemeral(
          interaction,
          applyBranding(
            new EmbedBuilder()
              .setColor(COLORS.warning)
              .setTitle('Sudah ada')
              .setDescription(`${channel} sudah ada di daftar channel /role me.`),
          ),
        );
      }
      const list = result.roleMeChannelIds.map((id) => `<#${id}>`).join(', ');
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('Channel ditambahkan')
            .setDescription(`${channel} ditambahkan ke daftar channel /role me.`)
            .addFields({ name: 'Channel yang diizinkan', value: list }),
        ),
      );
    }

    if (sub2 === 'remove') {
      const channel = interaction.options.getChannel('channel');
      const result = await removeRoleMeChannel(guildId, channel.id);
      if (!result.removed) {
        return replyEphemeral(
          interaction,
          applyBranding(
            new EmbedBuilder()
              .setColor(COLORS.warning)
              .setTitle('Tidak ditemukan')
              .setDescription(`${channel} tidak ada di daftar channel /role me.`),
          ),
        );
      }
      const list =
        result.roleMeChannelIds.length > 0
          ? result.roleMeChannelIds.map((id) => `<#${id}>`).join(', ')
          : '_Semua channel diizinkan (tidak ada pembatasan)_';
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('Channel dihapus')
            .setDescription(`${channel} dihapus dari daftar channel /role me.`)
            .addFields({ name: 'Channel yang diizinkan', value: list }),
        ),
      );
    }

    if (sub2 === 'list') {
      const cfg2 = await getConfig(guildId);
      const list =
        cfg2.roleMeChannelIds.length > 0
          ? cfg2.roleMeChannelIds.map((id) => `<#${id}>`).join('\n')
          : '_Semua channel diizinkan (tidak ada pembatasan)_';
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('Channel yang diizinkan untuk /role me')
            .setDescription(list),
        ),
      );
    }
  }

  // /config approval-channel
  if (!group && sub === 'approval-channel') {
    const channel = interaction.options.getChannel('channel');
    await setApprovalChannel(guildId, channel.id);
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle('Channel approval diatur')
          .setDescription(`Channel approval diset ke ${channel}.`),
      ),
    );
  }

  // /config wd-channel add|remove|list
  if (group === 'wd-channel') {
    return handleChannelGroup(interaction, {
      sub: interaction.options.getSubcommand(),
      label: '/wd',
      add: (id) => addWdChannel(guildId, id),
      remove: (id) => removeWdChannel(guildId, id),
      list: async () => (await getConfig(guildId)).wdChannelIds,
    });
  }

  // /config dp-channel add|remove|list
  if (group === 'dp-channel') {
    return handleChannelGroup(interaction, {
      sub: interaction.options.getSubcommand(),
      label: '/dp',
      add: (id) => addDpChannel(guildId, id),
      remove: (id) => removeDpChannel(guildId, id),
      list: async () => (await getConfig(guildId)).dpChannelIds,
    });
  }

  // /config show
  if (!group && sub === 'show') {
    const cfg = await getConfig(guildId);
    const approvers =
      cfg.approverRoleIds.length > 0
        ? cfg.approverRoleIds.map((id) => `<@&${id}>`).join(', ')
        : '_Belum diatur_';
    const approvalCh = cfg.approvalChannelId ? `<#${cfg.approvalChannelId}>` : '_Belum diatur_';
    const status = cfg.approvalEnabled ? 'Aktif' : 'Nonaktif';
    const roleMeCh =
      cfg.roleMeChannelIds.length > 0
        ? cfg.roleMeChannelIds.map((id) => `<#${id}>`).join(', ')
        : '_Semua channel_';
    const wdCh =
      cfg.wdChannelIds.length > 0
        ? cfg.wdChannelIds.map((id) => `<#${id}>`).join(', ')
        : '_Semua channel_';
    const dpCh =
      cfg.dpChannelIds.length > 0
        ? cfg.dpChannelIds.map((id) => `<#${id}>`).join(', ')
        : '_Semua channel_';
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.info)
          .setTitle('Konfigurasi Server')
          .addFields(
            { name: `Approver Role (${cfg.approverRoleIds.length}/3)`, value: approvers, inline: false },
            { name: 'Approval Channel', value: approvalCh, inline: true },
            { name: 'Mode Approval', value: status, inline: true },
            { name: 'Channel /role me', value: roleMeCh, inline: true },
            { name: 'Channel /wd', value: wdCh, inline: true },
            { name: 'Channel /dp', value: dpCh, inline: true },
          ),
      ),
    );
  }

  return undefined;
}

/**
 * Generic handler for channel-group subcommands (add / remove / list).
 * Used by wd-channel and dp-channel groups to avoid code duplication.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ sub: string, label: string, add: Function, remove: Function, list: Function }} opts
 */
async function handleChannelGroup(interaction, { sub, label, add, remove, list }) {
  if (sub === 'add') {
    const channel = interaction.options.getChannel('channel');
    const result = await add(channel.id);
    if (!result.added) {
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle('Sudah ada')
            .setDescription(`${channel} sudah ada di daftar channel ${label}.`),
        ),
      );
    }
    const listStr = result.channelIds.map((id) => `<#${id}>`).join(', ');
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle('Channel ditambahkan')
          .setDescription(`${channel} ditambahkan ke daftar channel ${label}.`)
          .addFields({ name: 'Channel yang diizinkan', value: listStr }),
      ),
    );
  }

  if (sub === 'remove') {
    const channel = interaction.options.getChannel('channel');
    const result = await remove(channel.id);
    if (!result.removed) {
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.warning)
            .setTitle('Tidak ditemukan')
            .setDescription(`${channel} tidak ada di daftar channel ${label}.`),
        ),
      );
    }
    const listStr =
      result.channelIds.length > 0
        ? result.channelIds.map((id) => `<#${id}>`).join(', ')
        : '_Semua channel diizinkan (tidak ada pembatasan)_';
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle('Channel dihapus')
          .setDescription(`${channel} dihapus dari daftar channel ${label}.`)
          .addFields({ name: 'Channel yang diizinkan', value: listStr }),
      ),
    );
  }

  if (sub === 'list') {
    const ids = await list();
    const listStr =
      ids.length > 0
        ? ids.map((id) => `<#${id}>`).join('\n')
        : '_Semua channel diizinkan (tidak ada pembatasan)_';
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.info)
          .setTitle(`Channel yang diizinkan untuk ${label}`)
          .setDescription(listStr),
      ),
    );
  }

  return undefined;
}

module.exports = { data, handleConfig };
