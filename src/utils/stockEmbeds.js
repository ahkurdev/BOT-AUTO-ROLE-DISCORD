'use strict';

const { EmbedBuilder } = require('discord.js');
const { formatQuantity } = require('./stockOps');
const { BRAND_FOOTER, COLORS, applyBranding, branded } = require('./shared');

/**
 * Embed builders for the Live Stock board and the withdraw/deposit/log
 * messages. These are pure (no I/O) and return discord.js EmbedBuilders.
 *
 * The Live Stock board mirrors the operator's example: a titled embed with one
 * section per category (category emoji + name as a bold header, then each item
 * as `| Name — quantity`). Quantities use '.' as the thousands separator.
 *
 * The withdraw/deposit confirmation and log embeds are intentionally
 * emoji-free, consistent with the rest of the bot's messages.
 */
// COLORS imported from ./shared

const ZERO_WIDTH = '\u200b';

/**
 * Render an actor (GuildMember-like) as a mention, falling back to a string.
 * @param {object|string} actor
 * @returns {string}
 */
function formatActor(actor) {
  if (actor == null) {
    return 'Seseorang';
  }
  if (typeof actor === 'string') {
    return actor;
  }
  if (typeof actor.toString === 'function') {
    const mention = actor.toString();
    if (mention && mention !== '[object Object]') {
      return mention;
    }
  }
  if (actor.user && actor.user.tag) {
    return actor.user.tag;
  }
  return 'Seseorang';
}

/**
 * Render a single category block as a string.
 * @param {{ name: string, emoji?: string, items: Array<{name:string, quantity:number}> }} category
 * @returns {string}
 */
function renderCategory(category) {
  const header = `${category.emoji ? `${category.emoji} ` : ''}**${category.name}**`;
  const items = Array.isArray(category.items) ? category.items : [];
  if (items.length === 0) {
    return `${header}\n| _(kosong)_`;
  }
  const lines = items.map((item) => `| ${item.name} — \`${formatQuantity(item.quantity)}\``);
  return `${header}\n${lines.join('\n')}`;
}

/**
 * Build the Live Stock board embed from a categories array.
 *
 * @param {Array} categories
 * @param {object} [options]
 * @param {string} [options.title='Live Stock']
 * @param {string} [options.thumbnail] - optional thumbnail image URL
 * @param {Date} [options.updatedAt] - timestamp to show in the footer
 * @returns {EmbedBuilder}
 */
function liveStockEmbed(categories, options = {}) {
  const list = Array.isArray(categories) ? categories : [];
  const embed = new EmbedBuilder()
    .setColor(COLORS.stock)
    .setTitle(options.title || 'Live Stock');

  if (options.thumbnail) {
    embed.setThumbnail(options.thumbnail);
  }

  if (list.length === 0) {
    embed.setDescription('_Belum ada kategori. Tambahkan lewat `/livestock category add`._');
  } else {
    embed.setDescription(list.map(renderCategory).join('\n\n'));
  }

  const stamp = options.updatedAt instanceof Date ? options.updatedAt : new Date();
  embed.setFooter({ text: 'Terakhir diperbarui' }).setTimestamp(stamp);
  return embed;
}

/**
 * Confirmation shown to the member after a successful withdraw.
 * @param {{ amount: number, itemName: string, categoryName: string, remaining: number }} info
 * @returns {EmbedBuilder}
 */
function withdrawSuccessEmbed({ amount, itemName, categoryName, remaining, actor }) {
  const who = actor ? `${formatActor(actor)} menarik` : 'Menarik';
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('Withdraw berhasil')
    .setDescription(`${who} ${formatQuantity(amount)} ${itemName} dari ${categoryName}.`)
    .addFields({ name: 'Sisa stok', value: `${formatQuantity(remaining)}`, inline: true });
}

/**
 * Confirmation shown to the member after a successful deposit.
 * @param {{ amount: number, itemName: string, categoryName: string, total: number }} info
 * @returns {EmbedBuilder}
 */
function depositSuccessEmbed({ amount, itemName, categoryName, total, created, categoryCreated, actor }) {
  const who = actor ? formatActor(actor) : null;
  let description;
  if (categoryCreated) {
    description = `Kategori ${categoryName} dibuat dan item ${itemName} ditambah ${formatQuantity(amount)}${who ? ` oleh ${who}` : ''}.`;
  } else if (created) {
    description = `Item baru ${itemName} dibuat di ${categoryName} dan ditambah ${formatQuantity(amount)}${who ? ` oleh ${who}` : ''}.`;
  } else {
    description = `${who ? `${who} menyetor` : 'Menyetor'} ${formatQuantity(amount)} ${itemName} ke ${categoryName}.`;
  }
  return new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('Deposit berhasil')
    .setDescription(description)
    .addFields({ name: 'Total stok', value: `${formatQuantity(total)}`, inline: true });
}

/**
 * Insufficient-stock rejection for a withdraw.
 * @param {{ itemName: string, requested: number, available: number }} info
 * @returns {EmbedBuilder}
 */
function insufficientStockEmbed({ itemName, requested, available }) {
  return new EmbedBuilder()
    .setColor(COLORS.error)
    .setTitle('Stok tidak cukup')
    .setDescription(
      `Stok ${itemName} hanya ${formatQuantity(available)}, tidak bisa menarik ${formatQuantity(requested)}.`,
    );
}

/**
 * The requested item or category was not found.
 * @param {string} message
 * @returns {EmbedBuilder}
 */
function stockNotFoundEmbed(message) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Tidak ditemukan')
    .setDescription(message);
}

/**
 * The amount entered was not a positive whole number.
 * @returns {EmbedBuilder}
 */
function invalidAmountEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Jumlah tidak valid')
    .setDescription('Jumlah harus berupa angka bulat lebih besar dari 0.');
}

/**
 * The Live Stock board has not been set up yet for this guild.
 * @returns {EmbedBuilder}
 */
function stockNotConfiguredEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Live Stock belum diatur')
    .setDescription('Minta approver menjalankan `/livestock channel` terlebih dahulu.');
}

/**
 * Transaction log entry posted to the configured log channel.
 * @param {{ type: 'withdraw'|'deposit', actor: object|string, amount: number, itemName: string, categoryName: string, balance: number }} info
 * @returns {EmbedBuilder}
 */
function transactionLogEmbed({ type, actor, amount, itemName, categoryName, balance }) {
  const isWithdraw = type === 'withdraw';
  const actorText =
    actor && typeof actor.toString === 'function' && actor.toString() !== '[object Object]'
      ? actor.toString()
      : String(actor);
  return new EmbedBuilder()
    .setColor(isWithdraw ? COLORS.error : COLORS.success)
    .setTitle(isWithdraw ? 'Withdraw' : 'Deposit')
    .addFields(
      { name: 'Oleh', value: actorText, inline: true },
      { name: 'Item', value: `${itemName} (${categoryName})`, inline: true },
      {
        name: 'Jumlah',
        value: `${isWithdraw ? '-' : '+'}${formatQuantity(amount)}`,
        inline: true,
      },
      { name: 'Sisa stok', value: `${formatQuantity(balance)}`, inline: true },
    )
    .setTimestamp(new Date());
}

/**
 * The item name exists in multiple categories — ask the user to specify.
 * @param {{ itemName: string, options: string[] }} info
 * @returns {EmbedBuilder}
 */
function ambiguousItemEmbed({ itemName, options }) {
  const list = (options || []).map((c) => `• ${c}`).join('\n');
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Pilih kategori')
    .setDescription(
      `"${itemName}" ada di beberapa kategori. Ulangi perintah dan sebutkan kategorinya:\n${list}`,
    );
}

/**
 * `/dp` for a brand-new item without a category — tell the user to pick one.
 * @param {string} itemName
 * @returns {EmbedBuilder}
 */
function needCategoryEmbed(itemName) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Pilih kategori')
    .setDescription(
      `"${itemName}" belum ada di Live Stock. Sebutkan kategori pada perintah agar item dibuat di sana.`,
    );
}

/**
 * The command was used in the wrong channel.
 * @param {{ commandLabel: string, channelId: string }} info
 * @returns {EmbedBuilder}
 */
function wrongChannelEmbed({ commandLabel, channelId }) {
  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle('Channel salah')
    .setDescription(`Perintah ${commandLabel} hanya bisa digunakan di <#${channelId}>.`);
}

// BRAND_FOOTER, applyBranding, branded imported from ./shared

module.exports = {
  ZERO_WIDTH,
  BRAND_FOOTER,
  applyBranding,
  formatActor,
  renderCategory,
  liveStockEmbed: branded(liveStockEmbed),
  withdrawSuccessEmbed: branded(withdrawSuccessEmbed),
  depositSuccessEmbed: branded(depositSuccessEmbed),
  insufficientStockEmbed: branded(insufficientStockEmbed),
  stockNotFoundEmbed: branded(stockNotFoundEmbed),
  invalidAmountEmbed: branded(invalidAmountEmbed),
  stockNotConfiguredEmbed: branded(stockNotConfiguredEmbed),
  transactionLogEmbed: branded(transactionLogEmbed),
  ambiguousItemEmbed: branded(ambiguousItemEmbed),
  needCategoryEmbed: branded(needCategoryEmbed),
  wrongChannelEmbed: branded(wrongChannelEmbed),
};
