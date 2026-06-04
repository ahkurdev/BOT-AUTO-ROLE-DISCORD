'use strict';

/**
 * Shared utilities used across all command handlers and embed builders.
 *
 * Centralises the brand footer, colour palette, generic error embed, and the
 * ephemeral/public reply helpers so they are defined once and imported
 * everywhere rather than duplicated in each module.
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');

const BRAND_FOOTER = 'Created by Allan';

const COLORS = {
  success: 0x57f287,
  error: 0xed4245,
  warning: 0xfee75c,
  info: 0x5865f2,
  stock: 0xf1c40f,
};

/**
 * Apply the "Created by Allan" footer to an embed. If the embed already has a
 * footer, the brand is appended rather than replacing it. Idempotent.
 * @param {EmbedBuilder} embed
 * @returns {EmbedBuilder}
 */
function applyBranding(embed) {
  const existing = embed && embed.data && embed.data.footer ? embed.data.footer.text : '';
  if (existing) {
    if (!existing.includes(BRAND_FOOTER)) {
      embed.setFooter({ text: `${existing} • ${BRAND_FOOTER}` });
    }
  } else {
    embed.setFooter({ text: BRAND_FOOTER });
  }
  return embed;
}

/**
 * Wrap an embed-returning builder so its result always carries the brand footer.
 * @param {(...args: any[]) => EmbedBuilder} fn
 * @returns {(...args: any[]) => EmbedBuilder}
 */
function branded(fn) {
  return (...args) => applyBranding(fn(...args));
}

/**
 * Build a safe, generic failure embed.
 * @param {string} [message]
 * @returns {EmbedBuilder}
 */
function genericErrorEmbed(message) {
  return applyBranding(
    new EmbedBuilder()
      .setColor(COLORS.error)
      .setTitle('Terjadi kesalahan')
      .setDescription(message || 'Aksi tidak dapat diselesaikan. Coba lagi sebentar lagi.'),
  );
}

/**
 * Reply to an interaction ephemerally, falling back to `followUp` if the
 * interaction has already been replied to or deferred.
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
 * Reply publicly (visible to everyone in the channel).
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

module.exports = {
  BRAND_FOOTER,
  COLORS,
  applyBranding,
  branded,
  genericErrorEmbed,
  replyEphemeral,
  replyPublic,
};
