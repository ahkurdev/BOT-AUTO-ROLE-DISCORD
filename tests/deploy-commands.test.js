'use strict';

/**
 * Integration test for the deploy script (`deploy-commands.js`).
 *
 * The deploy script registers the `/role` command and its subcommands as
 * **guild** commands for the Guild identified by `GUILD_ID`, using the Discord
 * REST API. To keep this test free of any network I/O we inject a fake REST
 * client (`{ put: jest.fn() }`) and an explicit `env` object, then assert that
 * `deploy` issues exactly one `rest.put` to the
 * `Routes.applicationGuildCommands(clientId, guildId)` route carrying the
 * `/role` command body.
 *
 * We compute the expected route and command body the same way the production
 * code does (via `Routes` from discord.js and `role.data.toJSON()`), so the
 * assertions track the real command definition rather than a hand-written copy.
 *
 * Validates: Requirements 8.1
 */

const { Routes } = require('discord.js');

const { deploy } = require('../deploy-commands');
const { data } = require('../src/commands/role');

/** A complete env object so `loadConfig` resolves without throwing. */
function makeEnv(overrides = {}) {
  return {
    DISCORD_TOKEN: 'tok',
    MONGODB_URI: 'mongodb://x',
    GUILD_ID: 'guild-123',
    CLIENT_ID: 'client-456',
    ...overrides,
  };
}

describe('deploy-commands deploy()', () => {
  it('registers the /role command on the applicationGuildCommands route (Req 8.1)', async () => {
    const rest = { put: jest.fn().mockResolvedValue([{ name: 'role' }]) };
    const env = makeEnv();

    await deploy({ env, rest });

    // Exactly one registration call is made.
    expect(rest.put).toHaveBeenCalledTimes(1);

    // First arg: the guild-scoped route built from CLIENT_ID + GUILD_ID.
    const expectedRoute = Routes.applicationGuildCommands('client-456', 'guild-123');
    const [routeArg, payloadArg] = rest.put.mock.calls[0];
    expect(routeArg).toBe(expectedRoute);

    // Second arg: { body: [...] } that includes the `/role` command.
    expect(payloadArg).toHaveProperty('body');
    expect(Array.isArray(payloadArg.body)).toBe(true);
    // The body registers /role plus the stock commands (/wd, /dp, /livestock).
    const commandNames = payloadArg.body.map((c) => c.name);
    expect(commandNames).toEqual(expect.arrayContaining(['role', 'wd', 'dp', 'livestock', 'help']));

    const roleCommand = payloadArg.body.find((c) => c.name === 'role');
    expect(roleCommand).toBeDefined();

    // The /role body should match the real command definition, incl. subcommands.
    const expectedBody = data.toJSON();
    expect(roleCommand).toEqual(expectedBody);

    // The `/role` command exposes its me/add/remove/list subcommands.
    const subcommandNames = (roleCommand.options || []).map((opt) => opt.name);
    expect(subcommandNames).toEqual(
      expect.arrayContaining(['me', 'add', 'remove', 'list']),
    );
  });

  it('returns the REST response from the registration call', async () => {
    const registered = [{ name: 'role' }];
    const rest = { put: jest.fn().mockResolvedValue(registered) };

    await expect(deploy({ env: makeEnv(), rest })).resolves.toBe(registered);
  });

  it('rejects with a CLIENT_ID message when CLIENT_ID is missing (Req 8.1)', async () => {
    const rest = { put: jest.fn() };
    const env = makeEnv({ CLIENT_ID: undefined });

    await expect(deploy({ env, rest })).rejects.toThrow(/CLIENT_ID/);
    expect(rest.put).not.toHaveBeenCalled();
  });

  it('rejects with a CLIENT_ID message when CLIENT_ID is empty/whitespace', async () => {
    const rest = { put: jest.fn() };
    const env = makeEnv({ CLIENT_ID: '   ' });

    await expect(deploy({ env, rest })).rejects.toThrow(/CLIENT_ID/);
    expect(rest.put).not.toHaveBeenCalled();
  });
});
