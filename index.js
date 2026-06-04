'use strict';

/**
 * Entry point for the Discord Self-Role Bot.
 *
 * Wires the application layers together in a fail-fast startup sequence:
 *
 *   1. loadConfig()            — validate env; throws ConfigError if a var is
 *                                missing so the operator sees exactly which one.
 *   2. mongoose.connect(...)   — connect MongoDB BEFORE any interaction can be
 *                                processed and before logging in to Discord
 *                                (Requirement 8.4).
 *   3. new Client({ intents }) — create the gateway client with the Guilds and
 *                                GuildMembers intents needed to manage member
 *                                roles.
 *   4. register handlers       — attach the `ready` and `interactionCreate`
 *                                event handlers.
 *   5. client.login(token)     — connect to Discord.
 *
 * On a ConfigError or a Mongo connection failure (or any other startup error),
 * the message is logged and the process exits with a non-zero status
 * (Requirements 8.3, 8.4).
 *
 * The startup logic lives in the exported async `start()` function and is only
 * invoked when this module is run directly (`node index.js`). This keeps the
 * module side-effect-free at require-time so it can be imported and driven with
 * mongoose/client mocked in integration tests (task 13.4).
 *
 * Requirements: 8.3, 8.4
 */

const dns = require('node:dns');
const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');

const { loadConfig, ConfigError } = require('./src/config');
const ready = require('./src/events/ready');
const interactionCreate = require('./src/events/interactionCreate');
const messageCreate = require('./src/events/messageCreate');
const log = require('./src/utils/logger');

/**
 * Optionally override the DNS servers Node uses to resolve hostnames.
 *
 * Some networks (corporate LANs, VPNs) run a DNS server that refuses the SRV
 * lookups required by `mongodb+srv://` connection strings, producing
 * `querySrv ECONNREFUSED` at startup even though the cluster is reachable.
 * Setting `DNS_SERVERS` (a comma-separated list, e.g. `8.8.8.8,1.1.1.1`) points
 * Node's resolver at servers that answer those queries. No-op when unset.
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 */
function applyDnsServers(env = process.env) {
  const raw = env.DNS_SERVERS;
  if (!raw || raw.trim() === '') {
    return;
  }
  const servers = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (servers.length > 0) {
    dns.setServers(servers);
  }
}

/**
 * Register slash commands at startup so each deployment (and each bot — test
 * vs live) keeps its own commands in sync without a manual deploy step.
 *
 * Controlled by `AUTO_DEPLOY_COMMANDS`: enabled unless explicitly set to
 * "false"/"0"/"no". Best-effort — a failure here (e.g. wrong CLIENT_ID) logs a
 * warning but never blocks the bot from starting.
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {Promise<void>}
 */
async function autoDeployCommands(env = process.env) {
  const flag = String(env.AUTO_DEPLOY_COMMANDS ?? 'true').trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(flag)) {
    return;
  }
  try {
    const { deploy } = require('./deploy-commands');
    const registered = await deploy({ env });
    const count = Array.isArray(registered) ? registered.length : 1;
    log.info(`Auto-deploy: registered ${count} guild command(s).`);
  } catch (err) {
    log.warn(`Auto-deploy skipped: ${err && err.message ? err.message : err}`);
  }
}

/**
 * Set up Mongoose connection event listeners so we know if the database
 * connection drops or reconnects while the bot is running.
 */
function setupMongooseListeners() {
  mongoose.connection.on('error', (err) => {
    log.error('MongoDB connection error', { error: err.message || err });
  });
  mongoose.connection.on('disconnected', () => {
    log.warn('MongoDB disconnected');
  });
  mongoose.connection.on('reconnected', () => {
    log.info('MongoDB reconnected');
  });
}

/**
 * Gracefully shut down the bot: destroy the Discord client, disconnect
 * MongoDB, then exit.
 *
 * @param {import('discord.js').Client} client
 * @param {string} signal — the signal that triggered the shutdown
 */
async function shutdown(client, signal) {
  log.info(`Received ${signal}. Shutting down gracefully...`);
  try {
    client.destroy();
  } catch (_e) {
    // ignore
  }
  try {
    await mongoose.disconnect();
  } catch (_e) {
    // ignore
  }
  process.exit(0);
}

/**
 * Run the full startup sequence: validate config, connect MongoDB, create and
 * wire the Discord client, then log in.
 *
 * Ordering is significant: MongoDB is connected before the client is created /
 * handlers are attached and before `client.login`, so interactions are never
 * processed without a live database connection (Requirement 8.4).
 *
 * @returns {Promise<import('discord.js').Client>} the logged-in client
 */
async function start() {
  // 1. Validate configuration (throws ConfigError when a var is missing).
  const config = loadConfig();

  // 1a. Optionally point Node's DNS resolver at explicit servers so that
  //     mongodb+srv:// SRV lookups work on networks whose default DNS refuses
  //     them (set DNS_SERVERS, e.g. "8.8.8.8,1.1.1.1"). No-op when unset.
  applyDnsServers();

  // 1b. Register/refresh slash commands for this bot's CLIENT_ID + GUILD_ID so
  //     a fresh upload doesn't need a separate manual deploy. Best-effort.
  await autoDeployCommands();

  // 2. Connect MongoDB before anything that could process interactions (8.4).
  setupMongooseListeners();
  await mongoose.connect(config.mongoUri);

  // 3. Create the gateway client with the intents required to manage roles.
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // 4. Register the event handlers.
  client.once(ready.name, ready.execute);
  client.on(interactionCreate.name, interactionCreate.execute);
  client.on(messageCreate.name, messageCreate.execute);

  // 5. Log in to Discord.
  await client.login(config.discordToken);

  // 6. Register graceful shutdown handlers.
  process.on('SIGINT', () => shutdown(client, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(client, 'SIGTERM'));

  return client;
}

/**
 * Run `start()` and translate any startup failure into a logged message plus a
 * non-zero process exit (Requirements 8.3, 8.4).
 */
async function main() {
  try {
    await start();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Configuration problem: surface exactly which variable is missing (8.3).
      log.error(error.message);
    } else {
      // Mongo connection failure or any other startup error (8.4).
      log.error(`Failed to start bot: ${error && error.message ? error.message : error}`);
    }
    process.exit(1);
  }
}

module.exports = { start, main, applyDnsServers, autoDeployCommands };

// Global error handlers: catch unhandled promise rejections and uncaught
// exceptions so the bot does not crash silently.
process.on('unhandledRejection', (err) => {
  log.error('Unhandled Rejection', { error: err && err.message ? err.message : String(err) });
});
process.on('uncaughtException', (err) => {
  log.error('Uncaught Exception — exiting', { error: err && err.message ? err.message : String(err) });
  process.exit(1);
});

// Only run the bot when this file is executed directly (e.g. `node index.js`).
// When required by a test, nothing runs, keeping require-time side-effect free.
if (require.main === module) {
  main();
}
