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
 *   /livestock setwd <channel>       — batasi /wd ke channel tertentu (approver)
 *   /livestock setdp <channel>       — batasi /dp ke channel tertentu (approver)
 *   /livestock clearwd               — hapus batasan channel /wd (approver)
 *   /livestock cleardp               — hapus batasan channel /dp (approver)
 *   /livestock clearlog              — hapus channel log (approver)
 *   /livestock reset                 — reset semua stok ke 0 (approver)
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
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
} = require('discord.js');

const stockOps = require('../utils/stockOps');
const { genericErrorEmbed, replyEphemeral, replyPublic, COLORS, applyBranding } = require('../utils/shared');
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
const { getConfig: getGuildConfig } = require('../models/GuildConfig');
const { logTransaction, getHistory } = require('../models/GuildTransactions');

/** customId prefix for the reset confirmation button. */
const RESET_CONFIRM_PREFIX = 'livestock-reset-confirm';
const RESET_CANCEL_PREFIX = 'livestock-reset-cancel';

/**
 * Whether the interacting member may use approver-only stock subcommands.
 * Holds when the member has at least one of the configured approver roles, or
 * when they hold Administrator / Manage Guild.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string[]} approverRoleIds — resolved from GuildConfig
 * @returns {boolean}
 */
function isStockManager(interaction, approverRoleIds) {
  const ids = Array.isArray(approverRoleIds) ? approverRoleIds : (approverRoleIds ? [approverRoleIds] : []);
  if (ids.length > 0 && ids.some((id) => interaction.member?.roles?.cache?.has(id))) {
    return true;
  }
  const perms = interaction.memberPermissions;
  return Boolean(
    perms &&
      (perms.has(PermissionFlagsBits.Administrator) ||
        perms.has(PermissionFlagsBits.ManageGuild)),
  );
}

function notManagerEmbed() {
  return applyBranding(
    new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('Tidak berwenang')
      .setDescription('Hanya approver yang bisa mengatur Live Stock.'),
  );
}

function successEmbed(title, description) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle(title)
      .setDescription(description),
  );
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
  .addSubcommand((sub) => sub.setName('clearwd').setDescription('Hapus batasan channel /wd'))
  .addSubcommand((sub) => sub.setName('cleardp').setDescription('Hapus batasan channel /dp'))
  .addSubcommand((sub) => sub.setName('clearlog').setDescription('Hapus channel log transaksi'))
  .addSubcommand((sub) => sub.setName('reset').setDescription('Reset semua stok ke 0'))
  .addSubcommand((sub) =>
    sub
      .setName('history')
      .setDescription('Lihat riwayat transaksi terakhir')
      .addUserOption((o) => o.setName('user').setDescription('Filter per user (opsional)'))
      .addIntegerOption((o) =>
        o.setName('jumlah').setDescription('Jumlah transaksi (default 10, max 25)').setMinValue(1).setMaxValue(25),
      ),
  )
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
  } catch (_err) {
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
  } catch (_err) {
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
      case 'conflict':
        return replyEphemeral(
          interaction,
          genericErrorEmbed('Terjadi konflik data (transaksi bersamaan). Silakan coba lagi.'),
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

  // Persist transaction to the database for audit trail (best-effort).
  const userId = interaction.user?.id || interaction.member?.id || '';
  const userName = interaction.user?.tag || '';
  await logTransaction({
    guildId,
    type,
    userId,
    userName,
    itemName: resolvedItem,
    categoryName: resolvedCategory,
    amount,
    balanceAfter: newQty,
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
  const guildId = interaction.guild.id;
  const guildCfg = await getGuildConfig(guildId);
  if (!isStockManager(interaction, guildCfg.approverRoleIds)) {
    return replyEphemeral(interaction, notManagerEmbed());
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

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

    // --- New: clear channel restrictions ---
    if (!group && sub === 'clearwd') {
      await repo.ensureStock(guildId);
      await repo.setTransactionChannel(guildId, 'withdraw', null);
      return replyEphemeral(
        interaction,
        successEmbed('Batasan dihapus', 'Perintah `/wd` sekarang bisa digunakan di semua channel.'),
      );
    }

    if (!group && sub === 'cleardp') {
      await repo.ensureStock(guildId);
      await repo.setTransactionChannel(guildId, 'deposit', null);
      return replyEphemeral(
        interaction,
        successEmbed('Batasan dihapus', 'Perintah `/dp` sekarang bisa digunakan di semua channel.'),
      );
    }

    if (!group && sub === 'clearlog') {
      await repo.setLogChannel(guildId, null);
      return replyEphemeral(
        interaction,
        successEmbed('Log dihapus', 'Channel log transaksi sudah dinonaktifkan.'),
      );
    }

    // --- Reset with confirmation ---
    if (!group && sub === 'reset') {
      const stock = await repo.getStock(guildId);
      if (!stock || !stock.channelId) {
        return replyEphemeral(interaction, stockNotConfiguredEmbed());
      }
      const confirmBtn = new ButtonBuilder()
        .setCustomId(`${RESET_CONFIRM_PREFIX}:${guildId}`)
        .setLabel('Ya, reset semua')
        .setStyle(ButtonStyle.Danger);
      const cancelBtn = new ButtonBuilder()
        .setCustomId(`${RESET_CANCEL_PREFIX}:${guildId}`)
        .setLabel('Batal')
        .setStyle(ButtonStyle.Secondary);
      const row = new ActionRowBuilder().addComponents(confirmBtn, cancelBtn);
      return interaction.reply({
        embeds: [
          applyBranding(
            new EmbedBuilder()
              .setColor(COLORS.warning)
              .setTitle('Konfirmasi reset')
              .setDescription('Semua jumlah stok akan direset ke **0**. Tindakan ini tidak bisa dibatalkan.\n\nApakah kamu yakin?'),
          ),
        ],
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    // --- History ---
    if (!group && sub === 'history') {
      return handleLivestockHistory(interaction, guildId);
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
  } catch (_err) {
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
  } catch (_err) {
    // If anything fails, respond with an empty list rather than throwing.
    try {
      await interaction.respond([]);
    } catch (_innerErr) {
      // give up
    }
  }
}

// ---------------------------------------------------------------------------
// /livestock history handler
// ---------------------------------------------------------------------------

/**
 * Show recent transaction history from the database.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} guildId
 */
async function handleLivestockHistory(interaction, guildId) {
  const targetUser = interaction.options.getUser('user');
  const limit = interaction.options.getInteger('jumlah') ?? 10;
  const userId = targetUser ? targetUser.id : undefined;

  const history = await getHistory(guildId, { limit, userId });
  if (!history || history.length === 0) {
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.info)
          .setTitle('Riwayat transaksi')
          .setDescription(targetUser ? `Belum ada transaksi dari ${targetUser}.` : 'Belum ada transaksi.'),
      ),
    );
  }

  const lines = history.map((tx) => {
    const date = new Date(tx.createdAt);
    const ts = `<t:${Math.floor(date.getTime() / 1000)}:R>`;
    const sign = tx.type === 'withdraw' ? '-' : '+';
    const label = tx.type === 'withdraw' ? 'WD' : 'DP';
    return `${ts} **${label}** ${sign}${tx.amount} ${tx.itemName} (${tx.categoryName}) oleh <@${tx.userId}> | sisa: ${tx.balanceAfter}`;
  });

  return replyEphemeral(
    interaction,
    applyBranding(
      new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('Riwayat transaksi')
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Menampilkan ${history.length} transaksi terakhir` }),
    ),
  );
}

// ---------------------------------------------------------------------------
// /livestock reset confirmation button handler
// ---------------------------------------------------------------------------

/**
 * Handle the reset confirmation or cancellation button.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleResetButton(interaction) {
  const isConfirm = interaction.customId.startsWith(RESET_CONFIRM_PREFIX);

  if (isConfirm) {
    const guildId = interaction.guild.id;
    await repo.resetAllStock(guildId);
    await refreshBoard(interaction.guild);
    await interaction.update({
      embeds: [
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.success)
            .setTitle('Stok direset')
            .setDescription('Semua jumlah stok sudah direset ke 0.'),
        ),
      ],
      components: [],
    });
  } else {
    await interaction.update({
      embeds: [
        applyBranding(
          new EmbedBuilder()
            .setColor(COLORS.info)
            .setTitle('Reset dibatalkan')
            .setDescription('Stok tidak diubah.'),
        ),
      ],
      components: [],
    });
  }
}

module.exports = {
  wdData,
  dpData,
  livestockData,
  isStockManager,
  refreshBoard,
  handleWithdraw,
  handleDeposit,
  handleLivestock,
  handleAutocomplete,
  handleResetButton,
  RESET_CONFIRM_PREFIX,
  RESET_CANCEL_PREFIX,
};
