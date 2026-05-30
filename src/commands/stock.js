'use strict';

/**
 * Withdraw / Deposit / Live Stock commands.
 *
 *   /wd <jumlah> <item> [kategori]   — withdraw stock (semua member)
 *   /dp <jumlah> <item> [kategori]   — deposit stock (semua member)
 *   /livestock channel <channel>     — set & post the Live Stock board (approver)
 *   /livestock log <channel>         — set the transaction log channel (approver)
 *   /livestock create category       — buat kategori baru (approver)
 *   /livestock delete category       — hapus kategori (approver)
 *   /livestock item add|remove       — kelola item manual (approver)
 *   /livestock refresh               — re-render the board (approver)
 *
 * The board starts EMPTY. Approvers create categories first. On `/dp`, choosing
 * a category lets a brand-new item be created inside it; if the item already
 * exists anywhere, the category is optional and auto-matched (case-insensitive).
 * On `/wd`, the category is optional — the item's category is found
 * automatically. When a name exists in more than one category, the bot asks the
 * user to specify which category.
 *
 * Category and item options use autocomplete sourced from the stored stock.
 * Approver-gated subcommands require APPROVER_ROLE_ID. Withdraw/deposit are open
 * to everyone.
 */

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
} = require('discord.js');

const stockOps = require('../utils/stockOps');
const {
  liveStockEmbed,
  withdrawSuccessEmbed,
  depositSuccessEmbed,
  insufficientStockEmbed,
  stockNotFoundEmbed,
  invalidAmountEmbed,
  stockNotConfiguredEmbed,
  transactionLogEmbed,
  ambiguousItemEmbed,
  needCategoryEmbed,
  wrongChannelEmbed,
} = require('../utils/stockEmbeds');
const repo = require('../models/GuildStock');

/**
 * Read the approver role id from the environment.
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {string}
 */
function getApproverRoleId(env = process.env) {
  return (env.APPROVER_ROLE_ID || '').trim();
}

/**
 * Whether the interacting member may use approver-only stock subcommands.
 * Holders of the configured approver role, or members with Administrator /
 * Manage Guild, are allowed.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {boolean}
 */
function isStockManager(interaction) {
  const approverRoleId = getApproverRoleId();
  if (approverRoleId && interaction.member?.roles?.cache?.has(approverRoleId)) {
    return true;
  }
  const perms = interaction.memberPermissions;
  return Boolean(
    perms &&
      (perms.has(PermissionFlagsBits.Administrator) ||
        perms.has(PermissionFlagsBits.ManageGuild)),
  );
}

function genericErrorEmbed() {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Terjadi kesalahan')
    .setDescription('Aksi tidak dapat diselesaikan. Coba lagi sebentar lagi.')
    .setFooter({ text: 'Created by Allan' });
}

function notManagerEmbed() {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Tidak berwenang')
    .setDescription('Hanya approver yang bisa mengatur Live Stock.')
    .setFooter({ text: 'Created by Allan' });
}

function replyEphemeral(interaction, embed) {
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

/**
 * Reply publicly (visible to everyone in the channel) — used for /wd and /dp so
 * transactions are transparent to the whole channel.
 * @param {import('discord.js').RepliableInteraction} interaction
 * @param {EmbedBuilder} embed
 * @returns {Promise<unknown>}
 */
function replyPublic(interaction, embed) {
  const payload = { embeds: [embed] };
  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

const wdData = new SlashCommandBuilder()
  .setName('wd')
  .setDescription('Withdraw (tarik) item dari Live Stock')
  .addIntegerOption((opt) =>
    opt.setName('jumlah').setDescription('Jumlah yang ditarik').setRequired(true).setMinValue(1),
  )
  .addStringOption((opt) =>
    opt
      .setName('item')
      .setDescription('Nama item')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('kategori')
      .setDescription('Kategori (opsional, hanya jika nama item ada di banyak kategori)')
      .setRequired(false)
      .setAutocomplete(true),
  );

const dpData = new SlashCommandBuilder()
  .setName('dp')
  .setDescription('Deposit (setor) item ke Live Stock')
  .addIntegerOption((opt) =>
    opt.setName('jumlah').setDescription('Jumlah yang disetor').setRequired(true).setMinValue(1),
  )
  .addStringOption((opt) =>
    opt
      .setName('item')
      .setDescription('Nama item')
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName('kategori')
      .setDescription('Kategori (wajib untuk item baru; opsional jika item sudah ada)')
      .setRequired(false)
      .setAutocomplete(true),
  );

const livestockData = new SlashCommandBuilder()
  .setName('livestock')
  .setDescription('Atur papan Live Stock')
  .addSubcommand((sub) =>
    sub
      .setName('channel')
      .setDescription('Set channel dan posting papan Live Stock')
      .addChannelOption((opt) =>
        opt.setName('channel').setDescription('Channel papan Live Stock').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('log')
      .setDescription('Set channel log transaksi')
      .addChannelOption((opt) =>
        opt.setName('channel').setDescription('Channel log transaksi').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('setwd')
      .setDescription('Batasi perintah /wd hanya di channel ini')
      .addChannelOption((opt) =>
        opt.setName('channel').setDescription('Channel untuk /wd').setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('setdp')
      .setDescription('Batasi perintah /dp hanya di channel ini')
      .addChannelOption((opt) =>
        opt.setName('channel').setDescription('Channel untuk /dp').setRequired(true),
      ),
  )
  .addSubcommand((sub) => sub.setName('refresh').setDescription('Perbarui tampilan papan'))
  .addSubcommandGroup((group) =>
    group
      .setName('create')
      .setDescription('Buat kategori baru')
      .addSubcommand((sub) =>
        sub
          .setName('category')
          .setDescription('Buat kategori baru')
          .addStringOption((o) => o.setName('nama').setDescription('Nama kategori').setRequired(true))
          .addStringOption((o) => o.setName('emoji').setDescription('Emoji kategori (opsional)')),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('delete')
      .setDescription('Hapus kategori')
      .addSubcommand((sub) =>
        sub
          .setName('category')
          .setDescription('Hapus kategori')
          .addStringOption((o) =>
            o.setName('nama').setDescription('Nama kategori').setRequired(true).setAutocomplete(true),
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('item')
      .setDescription('Kelola item')
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Tambah item ke kategori')
          .addStringOption((o) =>
            o.setName('kategori').setDescription('Kategori').setRequired(true).setAutocomplete(true),
          )
          .addStringOption((o) => o.setName('nama').setDescription('Nama item').setRequired(true))
          .addIntegerOption((o) =>
            o.setName('jumlah').setDescription('Jumlah awal (default 0)').setMinValue(0),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Hapus item dari kategori')
          .addStringOption((o) =>
            o.setName('kategori').setDescription('Kategori').setRequired(true).setAutocomplete(true),
          )
          .addStringOption((o) =>
            o.setName('nama').setDescription('Nama item').setRequired(true).setAutocomplete(true),
          ),
      ),
  );

// ---------------------------------------------------------------------------
// Board rendering + transaction log helpers (I/O)
// ---------------------------------------------------------------------------

/**
 * Re-render the Live Stock board message for a guild from the stored document.
 * Edits the existing message when possible; if it was deleted, posts a new one
 * and updates the stored messageId. Best-effort: failures are swallowed.
 *
 * @param {import('discord.js').Guild} guild
 * @param {object} [doc] - optional pre-loaded stock document
 * @returns {Promise<void>}
 */
async function refreshBoard(guild, doc) {
  try {
    const stock = doc || (await repo.getStock(guild.id));
    if (!stock || !stock.channelId) {
      return;
    }
    const channel = await guild.channels.fetch(stock.channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return;
    }
    const embed = liveStockEmbed(toPlainCategories(stock.categories), {
      title: stock.title,
      thumbnail: guild.iconURL?.() || undefined,
    });

    if (stock.messageId) {
      const existing = await channel.messages.fetch(stock.messageId).catch(() => null);
      if (existing) {
        await existing.edit({ embeds: [embed] });
        return;
      }
    }
    const sent = await channel.send({ embeds: [embed] });
    await repo.setBoardLocation(guild.id, channel.id, sent.id);
  } catch (err) {
    // best-effort; board refresh failures must not break the command reply
  }
}

/**
 * Post a transaction log entry to the configured log channel (best-effort).
 * @param {import('discord.js').Guild} guild
 * @param {object} stock - the stock document (for logChannelId)
 * @param {object} entry - transactionLogEmbed payload
 * @returns {Promise<void>}
 */
async function postTransactionLog(guild, stock, entry) {
  try {
    if (!stock || !stock.logChannelId) {
      return;
    }
    const channel = await guild.channels.fetch(stock.logChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      return;
    }
    await channel.send({ embeds: [transactionLogEmbed(entry)] });
  } catch (err) {
    // best-effort
  }
}

/** Convert a Mongoose subdocument array into plain objects. */
function toPlainCategories(categories) {
  if (!categories) {
    return [];
  }
  const raw = typeof categories.toObject === 'function' ? categories.toObject() : categories;
  return JSON.parse(JSON.stringify(raw));
}

// ---------------------------------------------------------------------------
// Withdraw / Deposit handlers (open to everyone)
// ---------------------------------------------------------------------------

/**
 * Shared logic for /wd and /dp using smart category matching.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {'withdraw'|'deposit'} type
 */
async function handleTransaction(interaction, type) {
  const guildId = interaction.guild.id;
  const amount = interaction.options.getInteger('jumlah');
  const itemName = interaction.options.getString('item');
  const categoryName = interaction.options.getString('kategori') || undefined;

  const stock = await repo.getStock(guildId);
  if (!stock || !stock.channelId) {
    return replyEphemeral(interaction, stockNotConfiguredEmbed());
  }

  // Enforce the per-command channel restriction when one is configured.
  const restrictedChannelId = type === 'withdraw' ? stock.wdChannelId : stock.dpChannelId;
  if (restrictedChannelId && interaction.channelId !== restrictedChannelId) {
    return replyEphemeral(
      interaction,
      wrongChannelEmbed({
        commandLabel: type === 'withdraw' ? '/wd' : '/dp',
        channelId: restrictedChannelId,
      }),
    );
  }

  const result =
    type === 'withdraw'
      ? await repo.withdrawSmartItem(guildId, itemName, amount, categoryName)
      : await repo.depositSmartItem(guildId, itemName, amount, categoryName);

  if (!result.changed) {
    switch (result.reason) {
      case 'invalid_amount':
        return replyEphemeral(interaction, invalidAmountEmbed());
      case 'category_not_found':
        return replyEphemeral(
          interaction,
          stockNotFoundEmbed(`Kategori "${categoryName}" tidak ditemukan.`),
        );
      case 'item_not_found':
        return replyEphemeral(
          interaction,
          stockNotFoundEmbed(`Item "${itemName}" tidak ada di Live Stock.`),
        );
      case 'need_category':
        return replyEphemeral(interaction, needCategoryEmbed(itemName));
      case 'ambiguous':
        return replyEphemeral(
          interaction,
          ambiguousItemEmbed({ itemName, options: result.options }),
        );
      case 'insufficient_stock':
        return replyEphemeral(
          interaction,
          insufficientStockEmbed({
            itemName: result.item ? result.item.name : itemName,
            requested: amount,
            available: result.available,
          }),
        );
      default:
        return replyEphemeral(interaction, genericErrorEmbed());
    }
  }

  const newQty = result.item.quantity;
  const resolvedItem = result.item.name;
  const resolvedCategory = result.category.name;
  const created = result.reason === 'created';
  const categoryCreated = Boolean(result.categoryCreated);

  // Refresh the board and write the transaction log (best-effort).
  await refreshBoard(interaction.guild);
  await postTransactionLog(interaction.guild, stock, {
    type,
    actor: interaction.member,
    amount,
    itemName: resolvedItem,
    categoryName: resolvedCategory,
    balance: newQty,
  });

  const embed =
    type === 'withdraw'
      ? withdrawSuccessEmbed({
          amount,
          itemName: resolvedItem,
          categoryName: resolvedCategory,
          remaining: newQty,
          actor: interaction.member,
        })
      : depositSuccessEmbed({
          amount,
          itemName: resolvedItem,
          categoryName: resolvedCategory,
          total: newQty,
          created,
          categoryCreated,
          actor: interaction.member,
        });
  return replyPublic(interaction, embed);
}

/** Handle /wd. */
function handleWithdraw(interaction) {
  return handleTransaction(interaction, 'withdraw');
}

/** Handle /dp. */
function handleDeposit(interaction) {
  return handleTransaction(interaction, 'deposit');
}

// ---------------------------------------------------------------------------
// /livestock handlers (approver-gated)
// ---------------------------------------------------------------------------

async function handleLivestock(interaction) {
  if (!isStockManager(interaction)) {
    return replyEphemeral(interaction, notManagerEmbed());
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  try {
    if (!group && sub === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (!channel || !channel.isTextBased()) {
        return replyEphemeral(interaction, stockNotFoundEmbed('Channel harus berupa channel teks.'));
      }
      await repo.ensureStock(guildId);
      const stock = await repo.getStock(guildId);
      const embed = liveStockEmbed(toPlainCategories(stock.categories), {
        title: stock.title,
        thumbnail: interaction.guild.iconURL?.() || undefined,
      });
      const sent = await channel.send({ embeds: [embed] });
      await repo.setBoardLocation(guildId, channel.id, sent.id);
      return replyEphemeral(
        interaction,
        successEmbed('Papan diatur', `Live Stock dipasang di ${channel}.`),
      );
    }

    if (!group && sub === 'log') {
      const channel = interaction.options.getChannel('channel');
      if (!channel || !channel.isTextBased()) {
        return replyEphemeral(interaction, stockNotFoundEmbed('Channel harus berupa channel teks.'));
      }
      await repo.setLogChannel(guildId, channel.id);
      return replyEphemeral(
        interaction,
        successEmbed('Channel log diatur', `Transaksi akan dicatat ke ${channel}.`),
      );
    }

    if (!group && (sub === 'setwd' || sub === 'setdp')) {
      const channel = interaction.options.getChannel('channel');
      if (!channel || !channel.isTextBased()) {
        return replyEphemeral(interaction, stockNotFoundEmbed('Channel harus berupa channel teks.'));
      }
      const txType = sub === 'setwd' ? 'withdraw' : 'deposit';
      const label = sub === 'setwd' ? '/wd' : '/dp';
      await repo.ensureStock(guildId);
      await repo.setTransactionChannel(guildId, txType, channel.id);
      return replyEphemeral(
        interaction,
        successEmbed('Channel diatur', `Perintah ${label} sekarang hanya bisa di ${channel}.`),
      );
    }

    if (!group && sub === 'refresh') {
      const stock = await repo.getStock(guildId);
      if (!stock || !stock.channelId) {
        return replyEphemeral(interaction, stockNotConfiguredEmbed());
      }
      await refreshBoard(interaction.guild, stock);
      return replyEphemeral(interaction, successEmbed('Papan diperbarui', 'Tampilan Live Stock sudah diperbarui.'));
    }

    if (group === 'create' && sub === 'category') {
      return handleCreateCategory(interaction, guildId);
    }
    if (group === 'delete' && sub === 'category') {
      return handleDeleteCategory(interaction, guildId);
    }
    if (group === 'item') {
      return handleItemSub(interaction, sub, guildId);
    }

    return replyEphemeral(interaction, genericErrorEmbed());
  } catch (err) {
    return replyEphemeral(interaction, genericErrorEmbed());
  }
}

async function handleCreateCategory(interaction, guildId) {
  const name = interaction.options.getString('nama');
  const emoji = interaction.options.getString('emoji') || '';
  await repo.ensureStock(guildId);
  const result = await repo.addCategory(guildId, name, emoji);
  if (!result.changed) {
    return replyEphemeral(interaction, stockNotFoundEmbed(`Kategori "${name}" sudah ada.`));
  }
  await refreshBoard(interaction.guild);
  return replyEphemeral(interaction, successEmbed('Kategori dibuat', `Kategori "${name}" ditambahkan ke Live Stock.`));
}

async function handleDeleteCategory(interaction, guildId) {
  const name = interaction.options.getString('nama');
  const result = await repo.removeCategory(guildId, name);
  if (!result.changed) {
    return replyEphemeral(interaction, stockNotFoundEmbed(`Kategori "${name}" tidak ditemukan.`));
  }
  await refreshBoard(interaction.guild);
  return replyEphemeral(interaction, successEmbed('Kategori dihapus', `Kategori "${name}" dihapus.`));
}

async function handleItemSub(interaction, sub, guildId) {
  const categoryName = interaction.options.getString('kategori');
  const name = interaction.options.getString('nama');
  if (sub === 'add') {
    const quantity = interaction.options.getInteger('jumlah') ?? 0;
    const result = await repo.addItem(guildId, categoryName, name, quantity);
    if (!result.changed) {
      const msg =
        result.reason === 'category_not_found'
          ? `Kategori "${categoryName}" tidak ditemukan.`
          : `Item "${name}" sudah ada di "${categoryName}".`;
      return replyEphemeral(interaction, stockNotFoundEmbed(msg));
    }
    await refreshBoard(interaction.guild);
    return replyEphemeral(interaction, successEmbed('Item ditambah', `"${name}" ditambahkan ke "${categoryName}".`));
  }
  // remove
  const result = await repo.removeItem(guildId, categoryName, name);
  if (!result.changed) {
    const msg =
      result.reason === 'category_not_found'
        ? `Kategori "${categoryName}" tidak ditemukan.`
        : `Item "${name}" tidak ada di "${categoryName}".`;
    return replyEphemeral(interaction, stockNotFoundEmbed(msg));
  }
  await refreshBoard(interaction.guild);
  return replyEphemeral(interaction, successEmbed('Item dihapus', `"${name}" dihapus dari "${categoryName}".`));
}

function successEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Created by Allan' });
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

/**
 * Provide autocomplete suggestions for the `kategori`, `item`, and `nama`
 * options across /wd, /dp, and /livestock.
 *
 * @param {import('discord.js').AutocompleteInteraction} interaction
 * @returns {Promise<void>}
 */
async function handleAutocomplete(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    const stock = await repo.getStock(interaction.guild.id);
    const categories = stock ? toPlainCategories(stock.categories) : [];
    const query = String(focused.value || '').toLowerCase();

    let choices = [];
    if (focused.name === 'kategori') {
      choices = categories.map((c) => c.name);
    } else if (focused.name === 'item') {
      // Suggest items, optionally scoped to a chosen category if present.
      const chosenCategory = interaction.options.getString('kategori');
      const pool = chosenCategory
        ? categories.filter((c) => stockOps.namesEqual(c.name, chosenCategory))
        : categories;
      const names = new Set();
      pool.forEach((c) => (c.items || []).forEach((i) => names.add(i.name)));
      choices = [...names];
    } else if (focused.name === 'nama') {
      // For /livestock item remove (group 'item') -> suggest items.
      // For /livestock delete category (group 'delete') -> suggest categories.
      const group = interaction.options.getSubcommandGroup(false);
      if (group === 'item') {
        const chosenCategory = interaction.options.getString('kategori');
        const pool = chosenCategory
          ? categories.filter((c) => stockOps.namesEqual(c.name, chosenCategory))
          : categories;
        const names = new Set();
        pool.forEach((c) => (c.items || []).forEach((i) => names.add(i.name)));
        choices = [...names];
      } else {
        // delete category (or create category typing) -> category names
        choices = categories.map((c) => c.name);
      }
    }

    const filtered = choices
      .filter((name) => name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((name) => ({ name, value: name }));

    await interaction.respond(filtered);
  } catch (err) {
    // If anything fails, respond with an empty list rather than throwing.
    try {
      await interaction.respond([]);
    } catch (innerErr) {
      // give up
    }
  }
}

module.exports = {
  wdData,
  dpData,
  livestockData,
  getApproverRoleId,
  isStockManager,
  refreshBoard,
  handleWithdraw,
  handleDeposit,
  handleLivestock,
  handleAutocomplete,
};
