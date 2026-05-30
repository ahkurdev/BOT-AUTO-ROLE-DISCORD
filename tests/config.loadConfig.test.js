'use strict';

/**
 * Unit tests for `loadConfig` (src/config/index.js).
 *
 * Feature: discord-self-role-bot
 * Requirements: 8.2, 8.3
 *
 * These tests pass an explicit `env` object to `loadConfig` so that validation
 * is driven entirely by the argument and never depends on real process-level
 * environment variables or a local .env file.
 */

const { loadConfig, ConfigError } = require('../src/config');

describe('loadConfig', () => {
  test('returns the resolved config when env is complete (smoke)', () => {
    const env = {
      DISCORD_TOKEN: 'token-abc',
      MONGODB_URI: 'mongodb://localhost:27017/selfroles',
      GUILD_ID: '123456789012345678',
    };

    const config = loadConfig(env);

    expect(config).toEqual({
      discordToken: 'token-abc',
      mongoUri: 'mongodb://localhost:27017/selfroles',
      guildId: '123456789012345678',
    });
  });

  test('exposes the Discord token, Mongo URI, and guild id individually', () => {
    const env = {
      DISCORD_TOKEN: 'secret-token',
      MONGODB_URI: 'mongodb://db/selfroles',
      GUILD_ID: '987654321098765432',
    };

    const config = loadConfig(env);

    expect(config.discordToken).toBe('secret-token');
    expect(config.mongoUri).toBe('mongodb://db/selfroles');
    expect(config.guildId).toBe('987654321098765432');
  });

  test('throws ConfigError naming the missing variable when MONGODB_URI is absent', () => {
    const env = {
      DISCORD_TOKEN: 'token-abc',
      GUILD_ID: '123456789012345678',
    };

    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/MONGODB_URI/);
  });

  test('throws ConfigError naming the variable when MONGODB_URI is empty/whitespace', () => {
    const env = {
      DISCORD_TOKEN: 'token-abc',
      MONGODB_URI: '   ',
      GUILD_ID: '123456789012345678',
    };

    let error;
    try {
      loadConfig(env);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ConfigError);
    expect(error.message).toContain('MONGODB_URI');
  });
});
