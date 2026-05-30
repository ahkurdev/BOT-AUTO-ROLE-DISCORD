'use strict';

/**
 * `ClientReady` event handler.
 *
 * Discord.js emits the `ClientReady` event once, after the client has
 * successfully logged in and finished its initial connection. This handler
 * confirms the bot is online (logging the account tag) and sets a presence
 * ("Playing ...", "Watching ...", etc.). When more than one activity is
 * configured, the presence rotates on an interval so the bot looks lively.
 *
 * The handler is exported as a plain event descriptor `{ name, once, execute }`
 * so `index.js` can register it generically, e.g.:
 *
 *   const ready = require('./src/events/ready');
 *   client.once(ready.name, ready.execute);
 *
 * Configuration (all optional):
 *   BOT_ACTIVITY        — text for the presence; multiple entries separated by
 *                         `|` rotate (e.g. "Black Lotus Court|/wd /dp|Live Stock").
 *   BOT_ACTIVITY_TYPE   — Playing | Watching | Listening | Competing (default Playing).
 *   BOT_STATUS          — online | idle | dnd | invisible (default online).
 *   BOT_ACTIVITY_ROTATE_MS — rotation interval in ms (default 30000, min 15000).
 *
 * Requirements: 8.4
 */

const { Events, ActivityType } = require('discord.js');

const DEFAULT_ACTIVITIES = ['Black Lotus Court', '/wd · /dp · Live Stock', 'menjaga Brankas BLC'];
const DEFAULT_ROTATE_MS = 30000;
const MIN_ROTATE_MS = 15000;

/**
 * Map a human activity-type name to the discord.js ActivityType enum.
 * Defaults to Playing for unknown values.
 * @param {string} [name]
 * @returns {number}
 */
function resolveActivityType(name) {
  switch (String(name || '').trim().toLowerCase()) {
    case 'watching':
      return ActivityType.Watching;
    case 'listening':
      return ActivityType.Listening;
    case 'competing':
      return ActivityType.Competing;
    case 'playing':
    default:
      return ActivityType.Playing;
  }
}

/**
 * Map a status string to a valid discord.js presence status.
 * @param {string} [name]
 * @returns {'online'|'idle'|'dnd'|'invisible'}
 */
function resolveStatus(name) {
  const value = String(name || '').trim().toLowerCase();
  return ['online', 'idle', 'dnd', 'invisible'].includes(value) ? value : 'online';
}

/**
 * Build the presence configuration from the environment.
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {{ activities: string[], type: number, status: string, rotateMs: number }}
 */
function getPresenceConfig(env = process.env) {
  const raw = (env.BOT_ACTIVITY || '').trim();
  const activities = raw
    ? raw.split('|').map((s) => s.trim()).filter((s) => s.length > 0)
    : DEFAULT_ACTIVITIES.slice();

  const parsed = Number.parseInt(env.BOT_ACTIVITY_ROTATE_MS || '', 10);
  const rotateMs = Number.isFinite(parsed) ? Math.max(parsed, MIN_ROTATE_MS) : DEFAULT_ROTATE_MS;

  return {
    activities,
    type: resolveActivityType(env.BOT_ACTIVITY_TYPE),
    status: resolveStatus(env.BOT_STATUS),
    rotateMs,
  };
}

/**
 * Apply the presence to the client, starting a rotation timer when more than
 * one activity is configured. The timer is unref'd so it never keeps the
 * process alive on its own.
 *
 * @param {import('discord.js').Client} client
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {NodeJS.Timeout|null} the rotation interval (or null when not rotating)
 */
function applyPresence(client, env = process.env) {
  const { activities, type, status, rotateMs } = getPresenceConfig(env);
  if (!client.user || activities.length === 0) {
    return null;
  }

  let index = 0;
  const setNext = () => {
    const name = activities[index % activities.length];
    index += 1;
    client.user.setPresence({
      activities: [{ name, type }],
      status,
    });
  };

  setNext();

  if (activities.length > 1) {
    const timer = setInterval(setNext, rotateMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    return timer;
  }
  return null;
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  getPresenceConfig,
  resolveActivityType,
  resolveStatus,
  applyPresence,
  /**
   * Log that the bot is online and ready, then set its presence.
   *
   * @param {import('discord.js').Client} client - the ready Discord client
   */
  execute(client) {
    const tag = client && client.user ? client.user.tag : 'unknown user';
    console.log(`Bot is online. Logged in as ${tag}`);
    try {
      applyPresence(client);
    } catch (err) {
      // Presence is cosmetic; never let it break startup.
      console.error('Failed to set presence:', err && err.message ? err.message : err);
    }
  },
};
