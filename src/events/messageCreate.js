'use strict';

/**
 * `MessageCreate` event handler.
 *
 * Monitors text channels configured as restricted command-only channels.
 * Any regular text message in these channels is deleted and the author
 * receives a temporary warning embed that auto-deletes after 8 seconds.
 *
 * Supported restrictions (configured via /config):
 *   - roleMeChannelIds : only /role me is allowed
 *   - wdChannelIds     : only /wd (withdraw) is allowed
 *   - dpChannelIds     : only /dp (deposit) is allowed
 *
 * Behaviour:
 *   - If a channel has no restriction configured -> no-op.
 *   - If the message is from a bot -> silently delete only (no warning).
 *   - If the message is from a human -> delete + send temporary warning.
 *   - All errors are swallowed (best-effort) to avoid crashing the bot.
 */

const { Events, EmbedBuilder } = require('discord.js');
const { getConfig } = require('../models/GuildConfig');
const { COLORS, applyBranding } = require('../utils/shared');
const log = require('../utils/logger');

/**
 * Build a temporary warning embed shown in-channel after deleting the message.
 *
 * @param {import('discord.js').GuildMember|import('discord.js').User} author
 * @param {string} commandHint  - e.g. '/role me' or '/wd' or '/dp'
 * @returns {EmbedBuilder}
 */
function restrictedChannelEmbed(author, commandHint) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('Channel khusus command')
      .setDescription(
        `${author} Channel ini hanya untuk perintah \`${commandHint}\`.\n\n` +
          `Pesan kamu telah dihapus secara otomatis.\n` +
          `Gunakan \`${commandHint}\` di channel ini.`,
      ),
  );
}

module.exports = {
  name: Events.MessageCreate,

  /**
   * @param {import('discord.js').Message} message
   */
  async execute(message) {
    // Ignore DMs or anything outside a guild.
    if (!message.guild) return;

    // Ignore messages from the bot itself to avoid loops.
    if (message.author.id === message.client.user.id) return;

    try {
      const cfg = await getConfig(message.guild.id);

      // Build a lookup: channelId -> command hint string.
      // A channel can only belong to one restriction type (first match wins).
      const channelId = message.channelId;
      let commandHint = null;

      if ((cfg.roleMeChannelIds || []).includes(channelId)) {
        commandHint = '/role me';
      } else if ((cfg.wdChannelIds || []).includes(channelId)) {
        commandHint = '/wd';
      } else if ((cfg.dpChannelIds || []).includes(channelId)) {
        commandHint = '/dp';
      }

      // Message is not in any restricted channel -> ignore.
      if (!commandHint) return;

      // --- Message is in a restricted channel ---
      // Check if this message is the designated tutorial message.
      // If it is the tutorial message, leave it alone.
      if (cfg.tutorialMessageId && message.id === cfg.tutorialMessageId) {
        return;
      }

      // Delete the message
      try {
        await message.delete();
      } catch (_err) {
        // Message may already be deleted or bot lacks Manage Messages.
        log.debug('messageCreate: could not delete message', {
          channelId,
          messageId: message.id,
        });
        return;
      }

      // Only warn human authors (skip other bots silently).
      if (message.author.bot) return;

      // Send a temporary warning in the same channel, auto-delete after 8 s.
      let warning;
      try {
        warning = await message.channel.send({
          embeds: [restrictedChannelEmbed(message.member || message.author, commandHint)],
        });
      } catch (_err) {
        return;
      }

      // Auto-delete the warning after 8 seconds.
      setTimeout(() => {
        warning.delete().catch(() => {});
      }, 8000);
    } catch (err) {
      log.debug('messageCreate handler error', { error: err && err.message });
    }
  },
};
