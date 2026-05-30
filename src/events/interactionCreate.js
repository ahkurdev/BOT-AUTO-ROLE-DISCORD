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

const { Events } = require('discord.js');

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
} = require('../commands/stock');
const { handleHelp } = require('../commands/help');

module.exports = {
  name: Events.InteractionCreate,
  /**
   * Route an incoming interaction to the appropriate `/role` handler.
   *
   * - `/role` chat-input commands dispatch on the subcommand name:
   *   `me` → handleRoleMe, `add` → handleRoleAdd, `remove` → handleRoleRemove,
   *   `list` → handleRoleList.
   * - The `role-select` String Select Menu dispatches to handleRoleSelect.
   * - Any other interaction is ignored (no-op).
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

    // Route `/role` slash-command subcommands (Req 1.1, 3.1, 4.1, 5.1, 6.1).
    if (interaction.isChatInputCommand() && interaction.commandName === 'role') {
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
          // Unknown subcommand: ignore (no-op).
          return undefined;
      }
    }

    // Route the stock commands (open to everyone for /wd and /dp).
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'wd':
          return handleWithdraw(interaction);
        case 'dp':
          return handleDeposit(interaction);
        case 'livestock':
          return handleLivestock(interaction);
        case 'help':
          return handleHelp(interaction);
        default:
          break;
      }
    }

    // Route the self-role String Select Menu selection (Req 2.1).
    if (interaction.isStringSelectMenu() && interaction.customId === ROLE_SELECT_CUSTOM_ID) {
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

    // Any other interaction type is ignored.
    return undefined;
  },
};
