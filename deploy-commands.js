'use strict';

/**
 * Deploy script for the Discord Self-Role Bot.
 *
 * Registers the `/role` slash command (and its subcommands) as **guild**
 * commands for the Guild identified by `GUILD_ID`, using the Discord REST API.
 *
 * Configuration is read from environment variables (loaded via dotenv through
 * `loadConfig`): the Discord bot token and `GUILD_ID` come from validated
 * config, and the application/client id (`CLIENT_ID`) is read directly from the
 * environment. Following the config layer's fail-fast approach, a missing
 * `CLIENT_ID` causes the script to log a clear message and exit non-zero.
 *
 * The deploy logic lives in an exported async `deploy` function so it can be
 * integration-tested with the REST client mocked. The script only performs the
 * registration (a network call) when executed directly, never at require-time.
 *
 * Requirements: 8.1, 8.2
 */

const { REST, Routes } = require('discord.js');

const { loadConfig } = require('./src/config');
const { data } = require('./src/commands/role');
const { wdData, dpData, livestockData } = require('./src/commands/stock');
const { data: helpData } = require('./src/commands/help');

/**
 * Build the array of command JSON bodies to register.
 *
 * @returns {object[]} the command bodies (`/role`, `/wd`, `/dp`, `/livestock`, `/help`)
 */
function buildCommands() {
  return [
    data.toJSON(),
    wdData.toJSON(),
    dpData.toJSON(),
    livestockData.toJSON(),
    helpData.toJSON(),
  ];
}

/**
 * Register the bot's slash commands as guild commands.
 *
 * Resolves the Discord token and `GUILD_ID` from validated config and the
 * application id from `CLIENT_ID` in the environment, then calls
 * `rest.put(Routes.applicationGuildCommands(clientId, guildId), { body })`.
 *
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env=process.env] env source
 * @param {REST} [options.rest] an optional pre-configured REST client (testing)
 * @returns {Promise<unknown>} the REST response (registered command data)
 * @throws {Error} when `CLIENT_ID` is absent or config validation fails
 */
async function deploy({ env = process.env, rest } = {}) {
  // Validated config supplies the token and GUILD_ID (throws if missing).
  const { discordToken, guildId } = loadConfig(env);

  // CLIENT_ID is not part of loadConfig's output; read and validate it here so
  // the deploy script fails fast with a clear message (consistent with 8.3).
  const clientId = env.CLIENT_ID;
  if (!clientId || String(clientId).trim() === '') {
    throw new Error('Missing required environment variable(s): CLIENT_ID');
  }

  const commands = buildCommands();
  const client = rest || new REST({ version: '10' }).setToken(discordToken);

  return client.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands,
  });
}

// Only perform the network registration when run directly (e.g. `npm run
// deploy`); requiring this module (for tests) must not trigger any I/O.
if (require.main === module) {
  deploy()
    .then((registered) => {
      const count = Array.isArray(registered) ? registered.length : 1;
      console.log(`Successfully registered ${count} guild command(s).`);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

module.exports = { deploy, buildCommands };
