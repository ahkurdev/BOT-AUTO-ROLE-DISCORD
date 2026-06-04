'use strict';

const mongoose = require('mongoose');

/**
 * Transaction audit log stored in MongoDB.
 *
 * Every `/wd` and `/dp` creates a record here so operators have a queryable
 * history beyond the ephemeral Discord channel log. A TTL index automatically
 * deletes entries older than 90 days to keep storage bounded.
 *
 * Collection: `guild_transactions`
 */
const guildTransactionSchema = new mongoose.Schema(
  {
    guildId: { type: String, required: true, index: true },
    type: { type: String, enum: ['withdraw', 'deposit'], required: true },
    userId: { type: String, required: true },
    userName: { type: String, default: '' },
    itemName: { type: String, required: true },
    categoryName: { type: String, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'guild_transactions' },
);

// TTL index: auto-delete records older than 90 days.
guildTransactionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// Compound index for efficient per-guild history queries.
guildTransactionSchema.index({ guildId: 1, createdAt: -1 });

const GuildTransactions =
  mongoose.models.GuildTransactions ||
  mongoose.model('GuildTransactions', guildTransactionSchema);

/**
 * Log a transaction to the database. Best-effort: failures are swallowed so
 * a logging issue never breaks the command flow.
 *
 * @param {object} entry
 * @returns {Promise<object|null>}
 */
async function logTransaction({ guildId, type, userId, userName, itemName, categoryName, amount, balanceAfter }) {
  try {
    return await GuildTransactions.create({
      guildId,
      type,
      userId,
      userName,
      itemName,
      categoryName,
      amount,
      balanceAfter,
    });
  } catch (_err) {
    // Best-effort: never let a logging failure break the command.
    return null;
  }
}

/**
 * Get recent transactions for a guild, optionally filtered by user.
 *
 * @param {string} guildId
 * @param {object} [options]
 * @param {number} [options.limit=20]
 * @param {string} [options.userId]
 * @returns {Promise<object[]>}
 */
async function getHistory(guildId, { limit = 20, userId } = {}) {
  const filter = { guildId };
  if (userId) filter.userId = userId;
  return GuildTransactions.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = {
  GuildTransactions,
  logTransaction,
  getHistory,
};
