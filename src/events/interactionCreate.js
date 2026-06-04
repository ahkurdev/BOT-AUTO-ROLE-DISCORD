'use strict';

/**
 * `InteractionCreate` event handler.
 *
 * Discord.js emits `InteractionCreate` for every incoming interaction
 * (slash commands, message components, modals, etc.). This handler is the
 * router for the bot: it dispatches the `/role` chat-input subcommands and the
 * `role-select` String Select Menu to the matching handler in the command
 * module and ignores everything else.
 *
 * The handler is exported as a plain event descriptor `{ name, execute }` so
 * `index.js` can register it generically, e.g.:
 *
 *   const interactionCreate = require('./src/events/interactionCreate');
 *   client.on(interactionCreate.name, interactionCreate.execute);
 *
 * Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1
 */

const { Events, EmbedBuilder, MessageFlags } = require('discord.js');

const {
  ROLE_SELECT_CUSTOM_ID,
  APPROVE_BUTTON_PREFIX,
  REJECT_BUTTON_PREFIX,
  handleRoleMe,
  handleRoleSelect,
  handleApprovalButton,
  handleRoleAdd,
  handleRoleRemove,
  handleRoleList,
} = require('../commands/role');
const {
  handleWithdraw,
  handleDeposit,
  handleLivestock,
  handleAutocomplete,
  handleResetButton,
  RESET_CONFIRM_PREFIX,
  RESET_CANCEL_PREFIX,
} = require('../commands/stock');
const { handleHelp } = require('../commands/help');
const { handleConfig } = require('../commands/config-cmd');
const { checkRateLimit } = require('../utils/rateLimit');
const { COLORS, applyBranding } = require('../utils/shared');
const log = require('../utils/logger');

/**
 * Build a "rate limited" ephemeral embed.
 * @param {number} remainingMs
 * @returns {EmbedBuilder}
 */
function rateLimitedEmbed(remainingMs) {
  const seconds = Math.ceil(remainingMs / 1000);
  return applyBranding(
    new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('Terlalu cepat')
      .setDescription(`Tunggu ${seconds} detik sebelum menggunakan perintah ini lagi.`),
  );
}

module.exports = {
  name: Events.InteractionCreate,
  /**
   * Route an incoming interaction to the appropriate handler.
   *
   * @param {import('discord.js').Interaction} interaction - the incoming interaction
   * @returns {Promise<unknown> | undefined}
   */
  execute(interaction) {
    // Autocomplete for stock commands (/wd, /dp, /livestock).
    if (interaction.isAutocomplete()) {
      if (
        interaction.commandName === 'wd' ||
        interaction.commandName === 'dp' ||
        interaction.commandName === 'livestock'
      ) {
        return handleAutocomplete(interaction);
      }
      return undefined;
    }

    // --- Chat input commands ---------------------------------------------------
    if (interaction.isChatInputCommand()) {
      const userId = interaction.user?.id || interaction.member?.id;
      const cmd = interaction.commandName;

      // Rate limit check (skip autocomplete and non-command interactions).
      if (userId) {
        const rl = checkRateLimit(userId, cmd);
        if (rl.limited) {
          log.debug('Rate limited', { userId, command: cmd, remainingMs: rl.remainingMs });
          return interaction.reply({
            embeds: [rateLimitedEmbed(rl.remainingMs)],
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      // Route `/role` slash-command subcommands (Req 1.1, 3.1, 4.1, 5.1, 6.1).
      if (cmd === 'role') {
        switch (interaction.options.getSubcommand()) {
          case 'me':
            return handleRoleMe(interaction);
          case 'add':
            return handleRoleAdd(interaction);
          case 'remove':
            return handleRoleRemove(interaction);
          case 'list':
            return handleRoleList(interaction);
          default:
            return undefined;
        }
      }

      // Route stock commands (open to everyone for /wd and /dp).
      switch (cmd) {
        case 'wd':
          return handleWithdraw(interaction);
        case 'dp':
          return handleDeposit(interaction);
        case 'livestock':
          return handleLivestock(interaction);
        case 'help':
          return handleHelp(interaction);
        case 'config':
          return handleConfig(interaction);
        default:
          break;
      }
    }

    // Route the self-role String Select Menu selection (Req 2.1).
    // Supports pagination: customId can be 'role-select' or 'role-select:0', etc.
    if (
      interaction.isStringSelectMenu() &&
      (interaction.customId === ROLE_SELECT_CUSTOM_ID ||
        interaction.customId.startsWith(`${ROLE_SELECT_CUSTOM_ID}:`))
    ) {
      return handleRoleSelect(interaction);
    }

    // Route approval Accept/Reject button clicks (approval mode).
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith(`${APPROVE_BUTTON_PREFIX}:`) ||
        interaction.customId.startsWith(`${REJECT_BUTTON_PREFIX}:`))
    ) {
      return handleApprovalButton(interaction);
    }

    // Route livestock reset confirmation/cancel buttons.
    if (
      interaction.isButton() &&
      (interaction.customId.startsWith(`${RESET_CONFIRM_PREFIX}:`) ||
        interaction.customId.startsWith(`${RESET_CANCEL_PREFIX}:`))
    ) {
      return handleResetButton(interaction);
    }

    // Any other interaction type is ignored.
    return undefined;
  },
};
