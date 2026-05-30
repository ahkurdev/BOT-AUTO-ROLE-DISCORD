'use strict';

/**
 * Configuration layer for the Discord Self-Role Bot.
 *
 * Loads environment variables (via dotenv), validates that every required
 * variable is present and non-empty, and exposes a typed config object.
 *
 * The validation logic (`findMissingEnvVars` / `validateConfig`) is pure so it
 * can be exercised with fast unit and property-based tests without touching
 * `process.env` or the filesystem. `loadConfig` is the side-effecting entry
 * point used at startup; on invalid configuration it throws a `ConfigError`
 * that names exactly which variable(s) are missing.
 *
 * Requirements: 8.2, 8.3
 */

const REQUIRED_ENV_VARS = ['DISCORD_TOKEN', 'MONGODB_URI', 'GUILD_ID'];

/**
 * Error thrown when required configuration is missing or invalid.
 */
class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    // Maintain a proper stack trace where available (V8).
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ConfigError);
    }
  }
}

/**
 * Pure: return the names of required environment variables that are absent or
 * empty in the provided env object. A value is considered missing when it is
 * not present, or when it is an empty/whitespace-only string.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {string[]} the missing required variable names
 */
function findMissingEnvVars(env) {
  const source = env || {};
  return REQUIRED_ENV_VARS.filter((name) => {
    const value = source[name];
    return value === undefined || value === null || String(value).trim() === '';
  });
}

/**
 * Pure: validate an env object against the required variables.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateConfig(env) {
  const missing = findMissingEnvVars(env);
  return { valid: missing.length === 0, missing };
}

/**
 * Side-effecting: load `.env` via dotenv, validate the configuration, and
 * return the resolved config object. Throws a `ConfigError` naming the missing
 * variable(s) when validation fails.
 *
 * Accepts an `env` parameter (defaulting to `process.env`) for testability.
 *
 * @param {Record<string, string|undefined>} [env=process.env]
 * @returns {{ discordToken: string, mongoUri: string, guildId: string }}
 * @throws {ConfigError} when a required variable is absent or empty
 */
function loadConfig(env = process.env) {
  // Load variables from a local .env file into process.env (no-op if absent).
  require('dotenv').config();

  const { valid, missing } = validateConfig(env);
  if (!valid) {
    throw new ConfigError(
      `Missing required environment variable(s): ${missing.join(', ')}`
    );
  }

  return {
    discordToken: env.DISCORD_TOKEN,
    mongoUri: env.MONGODB_URI,
    guildId: env.GUILD_ID,
  };
}

module.exports = { findMissingEnvVars, validateConfig, loadConfig, ConfigError };
