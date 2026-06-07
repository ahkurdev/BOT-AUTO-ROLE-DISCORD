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
  setPjListChannel,
  setTutorialMessageId,
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
  .addSubcommand((sub) =>
    sub
      .setName('list-channel')
      .setDescription('Set channel tempat daftar penanggung jawab (PJ) ditampilkan')
      .addChannelOption((opt) =>
        opt.setName('channel').setDescription('Channel list PJ').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('tutorial-setup')
      .setDescription('Tampilkan pesan tutorial /role me di channel saat ini'),
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

  // /config list-channel
  if (!group && sub === 'list-channel') {
    const channel = interaction.options.getChannel('channel');
    await setPjListChannel(guildId, channel.id);
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.success)
          .setTitle('Channel List PJ Diatur')
          .setDescription(`Channel list PJ diset ke ${channel}.`),
      ),
    );
  }

  // /config tutorial-setup
  if (!group && sub === 'tutorial-setup') {
    const { tutorialEmbed } = require('../utils/embeds');
    
    try {
      // Allow bot to send the message by bypassing its own auto-delete
      const msg = await interaction.channel.send({ embeds: [tutorialEmbed()] });
      await setTutorialMessageId(guildId, msg.id);
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('Tutorial Setup Sukses')
            .setDescription('Pesan tutorial telah diposting di channel ini.'),
        ),
      );
    } catch (err) {
      return replyEphemeral(
        interaction,
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.error)
            .setTitle('Error')
            .setDescription('Gagal memposting pesan tutorial. Pastikan bot memiliki izin.'),
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

  // Hapus blok approval-channel lama yang tersisa


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
    const roleMeCh =
      cfg.roleMeChannelIds.length > 0
        ? cfg.roleMeChannelIds.map((id) => `<#${id}>`).join(', ')
        : '_Semua channel_';
    const pjListCh = cfg.pjListChannelId ? `<#${cfg.pjListChannelId}>` : '_Belum diatur_';
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
            { name: 'Channel List PJ', value: pjListCh, inline: false },
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
