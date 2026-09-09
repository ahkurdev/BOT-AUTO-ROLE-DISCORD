'use strict';

const mongoose = require('mongoose');
const stockOps = require('../utils/stockOps');

/**
 * Mongoose model + repository for per-guild Live Stock.
 *
 * Document shape (collection `guild_stock`):
 *   {
 *     guildId: string,            // unique, indexed
 *     channelId: string|null,     // channel where the board message lives
 *     messageId: string|null,     // the board message to edit on updates
 *     logChannelId: string|null,  // optional transaction log channel
 *     title: string,              // board title
 *     categories: [{ name, emoji, items: [{ name, quantity }] }],
 *   }
 *
 * All operations are scoped by guildId. Pure mutations are delegated to
 * `stockOps`; this layer only loads/persists and returns the decision objects.
 */
const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    quantity: { type: Number, default: 0 },
  },
  { _id: false },
);

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    emoji: { type: String, default: '' },
    items: { type: [itemSchema], default: [] },
  },
  { _id: false },
);

const guildStockSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, unique: true, index: true },
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    logChannelId: { type: String, default: null },
    wdChannelId: { type: String, default: null },
    dpChannelId: { type: String, default: null },
    title: { type: String, default: 'Live Stock' },
    categories: { type: [categorySchema], default: [] },
  },
  { collection: 'guild_stock' },
);

const GuildStock =
  mongoose.models.GuildStock || mongoose.model('GuildStock', guildStockSchema);

/**
 * Get the stock document for a guild, or null if none exists.
 * @param {string} guildId
 * @returns {Promise<object|null>}
 */
async function getStock(guildId) {
  return GuildStock.findOne({ guildId });
}

/**
 * Ensure a stock document exists for the guild. The board starts empty;
 * approvers create categories via `/livestock create category`.
 * @param {string} guildId
 * @returns {Promise<object>}
 */
async function ensureStock(guildId) {
  let doc = await GuildStock.findOne({ guildId });
  if (!doc) {
    doc = await GuildStock.create({ guildId, categories: [] });
  }
  return doc;
}

/**
 * Persist the board location (channel + message) for a guild.
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} messageId
 * @returns {Promise<object>}
 */
async function setBoardLocation(guildId, channelId, messageId) {
  return GuildStock.findOneAndUpdate(
    { guildId },
    { $set: { channelId, messageId } },
    { upsert: true, new: true },
  );
}

/**
 * Persist the transaction log channel for a guild.
 * @param {string} guildId
 * @param {string|null} logChannelId
 * @returns {Promise<object>}
 */
async function setLogChannel(guildId, logChannelId) {
  return GuildStock.findOneAndUpdate(
    { guildId },
    { $set: { logChannelId } },
    { upsert: true, new: true },
  );
}

/**
 * Restrict a transaction command to a specific channel.
 * @param {string} guildId
 * @param {'withdraw'|'deposit'} type
 * @param {string|null} channelId - channel id, or null to clear the restriction
 * @returns {Promise<object>}
 */
async function setTransactionChannel(guildId, type, channelId) {
  const field = type === 'withdraw' ? 'wdChannelId' : 'dpChannelId';
  return GuildStock.findOneAndUpdate(
    { guildId },
    { $set: { [field]: channelId } },
    { upsert: true, new: true },
  );
}

/**
 * Persist a new categories array for a guild.
 * @param {string} guildId
 * @param {Array} categories
 * @returns {Promise<object>}
 */
async function setCategories(guildId, categories) {
  return GuildStock.findOneAndUpdate(
    { guildId },
    { $set: { categories } },
    { upsert: true, new: true },
  );
}

/**
 * Apply a pure stockOps mutation and persist when it changed something.
 *
 * Uses **optimistic concurrency control**: the document's `__v` (version key)
 * is checked at write time. If another operation modified the document between
 * the read and the write, the version will not match and the write is a no-op.
 * The function then retries with the fresh document up to `maxRetries` times.
 *
 * This prevents the "lost update" race condition when two users `/wd` or `/dp`
 * the same item simultaneously.
 *
 * @param {string} guildId
 * @param {(categories: Array) => { categories: Array, changed: boolean, reason: string }} mutate
 * @param {number} [maxRetries=3]
 * @returns {Promise<object>} the decision object, augmented with `categories`
 *   reflecting the stored state.
 */
async function applyMutation(guildId, mutate, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const doc = await ensureStock(guildId);
    const version = doc.__v;
    const current = doc.categories ? doc.categories.toObject?.() ?? doc.categories : [];
    // Normalise to plain objects for the pure helper.
    const plain = JSON.parse(JSON.stringify(current));
    const result = mutate(plain);
    if (!result.changed) {
      return result;
    }
    // Attempt to write only if the version has not changed since the read.
    const updated = await GuildStock.findOneAndUpdate(
      { guildId, __v: version },
      { $set: { categories: result.categories }, $inc: { __v: 1 } },
      { new: true },
    );
    if (updated) {
      return result;
    }
    // Version mismatch — another operation modified the document. Retry.
  }
  // All retries exhausted: report a conflict so the caller can inform the user.
  return { changed: false, reason: 'conflict' };
}

/** Deposit amount of an item; persists on success. */
async function depositItem(guildId, categoryName, itemName, amount) {
  return applyMutation(guildId, (cats) =>
    stockOps.deposit(cats, categoryName, itemName, amount),
  );
}

/** Withdraw amount of an item; persists on success, refuses if insufficient. */
async function withdrawItem(guildId, categoryName, itemName, amount) {
  return applyMutation(guildId, (cats) =>
    stockOps.withdraw(cats, categoryName, itemName, amount),
  );
}

/**
 * Smart deposit for `/dp <jumlah> <item> [kategori]`: creates the item when a
 * category is given, auto-matches an existing item when not. Persists on
 * success.
 */
async function depositSmartItem(guildId, itemName, amount, categoryName) {
  return applyMutation(guildId, (cats) =>
    stockOps.depositSmart(cats, itemName, amount, categoryName),
  );
}

/**
 * Smart withdraw for `/wd <jumlah> <item> [kategori]`: auto-matches the item's
 * category when not supplied. Persists on success, refuses if insufficient.
 */
async function withdrawSmartItem(guildId, itemName, amount, categoryName) {
  return applyMutation(guildId, (cats) =>
    stockOps.withdrawSmart(cats, itemName, amount, categoryName),
  );
}

/** Add a category; persists on success. */
async function addCategory(guildId, categoryName, emoji) {
  return applyMutation(guildId, (cats) => stockOps.addCategory(cats, categoryName, emoji));
}

/** Remove a category; persists on success. */
async function removeCategory(guildId, categoryName) {
  return applyMutation(guildId, (cats) => stockOps.removeCategory(cats, categoryName));
}

/** Add an item to a category; persists on success. */
async function addItem(guildId, categoryName, itemName, quantity) {
  return applyMutation(guildId, (cats) =>
    stockOps.addItem(cats, categoryName, itemName, quantity),
  );
}

/** Remove an item from a category; persists on success. */
async function removeItem(guildId, categoryName, itemName) {
  return applyMutation(guildId, (cats) => stockOps.removeItem(cats, categoryName, itemName));
}

/**
 * Reset all item quantities to 0 across every category.
 *
 * Uses the same optimistic concurrency control as applyMutation: the write
 * only lands when `__v` is unchanged since the read, with retries on
 * conflict, so a concurrent /wd or /dp cannot be silently lost.
 * @param {string} guildId
 * @param {number} [maxRetries=3]
 * @returns {Promise<object|null>}
 */
async function resetAllStock(guildId, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const doc = await ensureStock(guildId);
    if (!doc) return null;
    const version = doc.__v;
    const cats = doc.categories ? (doc.categories.toObject?.() ?? doc.categories) : [];
    const reset = JSON.parse(JSON.stringify(cats)).map((c) => ({
      ...c,
      items: (c.items || []).map((i) => ({ ...i, quantity: 0 })),
    }));
    const updated = await GuildStock.findOneAndUpdate(
      { guildId, __v: version },
      { $set: { categories: reset }, $inc: { __v: 1 } },
      { new: true },
    );
    if (updated) return updated;
    // Version mismatch — retry with fresh document.
  }
  return null;
}

module.exports = {
  GuildStock,
  getStock,
  ensureStock,
  setBoardLocation,
  setLogChannel,
  setTransactionChannel,
  setCategories,
  applyMutation,
  depositItem,
  withdrawItem,
  depositSmartItem,
  withdrawSmartItem,
  addCategory,
  removeCategory,
  addItem,
  removeItem,
  resetAllStock,
};

