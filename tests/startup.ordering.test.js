'use strict';

/**
 * Integration test for the startup ordering in `index.js` (`start()`).
 *
 * Requirement 8.4 states that when the Bot establishes its connection to
 * Discord, it SHALL connect to MongoDB using the configured connection string
 * BEFORE processing command interactions. In practice this means the startup
 * sequence must call `mongoose.connect(...)` before it attaches the
 * `interactionCreate` handler and before `client.login(...)` — otherwise an
 * interaction could arrive (after login) without a live database connection.
 *
 * To assert that ordering in isolation we mock at the module boundary:
 *
 *  - `mongoose` so `connect` is a jest.fn() that resolves and records its call
 *    in a shared order log.
 *  - `discord.js` so `Client` is a lightweight mock class whose instances have
 *    `once`/`on`/`login` jest.fns. `on` records 'on' and `login` records
 *    'login' (resolved) in the shared order log. The created instance is
 *    captured on a module-scoped variable so the test can inspect it.
 *    `GatewayIntentBits` is exported because `index.js` references it.
 *  - `../src/config` so `loadConfig` returns a valid config without real env.
 *  - the `ready` / `interactionCreate` event modules so `index.js` can require
 *    them without pulling in the real command/Discord stack.
 *
 * We assert ordering both via the shared order log and via jest's
 * `mock.invocationCallOrder` (a monotonic counter across all mocks).
 *
 * Validates: Requirements 8.4
 */

// Shared, ordered log of significant startup steps, populated by the mocks
// below. Reset before each test.
const orderLog = [];

// Captures the most recently constructed mock Client instance so the test can
// inspect its `once`/`on`/`login` jest.fns.
let lastClient = null;

jest.mock('mongoose', () => ({
  connect: jest.fn(() => {
    orderLog.push('connect');
    return Promise.resolve();
  }),
  connection: {
    on: jest.fn(),
  },
}));

jest.mock('discord.js', () => {
  class Client {
    constructor(options) {
      this.options = options;
      this.once = jest.fn();
      this.on = jest.fn(() => {
        orderLog.push('on');
      });
      this.login = jest.fn(() => {
        orderLog.push('login');
        return Promise.resolve('logged-in');
      });
      lastClient = this;
    }
  }

  return {
    Client,
    GatewayIntentBits: { Guilds: 1, GuildMembers: 2 },
  };
});

jest.mock('../src/config', () => {
  class ConfigError extends Error {}
  return {
    loadConfig: () => ({
      discordToken: 'tok',
      mongoUri: 'mongodb://x',
      guildId: 'g',
    }),
    ConfigError,
  };
});

jest.mock('../src/events/ready', () => ({
  name: 'ready',
  once: true,
  execute: jest.fn(),
}));

jest.mock('../src/events/interactionCreate', () => ({
  name: 'interactionCreate',
  execute: jest.fn(),
}));

// Mock the deploy module so auto-deploy at startup is a no-op in this test
// (we are asserting connect/login ordering, not command registration).
jest.mock('../deploy-commands', () => ({
  deploy: jest.fn(() => Promise.resolve([])),
}));

const mongoose = require('mongoose');
const { Client } = require('discord.js');
const { start } = require('../index');

describe('startup ordering (Req 8.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    orderLog.length = 0;
    lastClient = null;
  });

  it('connects MongoDB before attaching interaction handling and logging in', async () => {
    const client = await start();

    // Sanity: every step ran exactly once.
    expect(mongoose.connect).toHaveBeenCalledTimes(1);
    expect(mongoose.connect).toHaveBeenCalledWith('mongodb://x');
    expect(client).toBe(lastClient);
    expect(client.login).toHaveBeenCalledTimes(1);
    expect(client.login).toHaveBeenCalledWith('tok');

    // The shared order log proves connect happened first, then the
    // interactionCreate handler was attached (`on`), then login.
    expect(orderLog).toEqual(['connect', 'on', 'login']);
  });

  it('orders mongoose.connect before client.login via invocationCallOrder', async () => {
    const client = await start();

    const connectOrder = mongoose.connect.mock.invocationCallOrder[0];
    const loginOrder = client.login.mock.invocationCallOrder[0];

    expect(connectOrder).toBeLessThan(loginOrder);
  });

  it('attaches the interactionCreate handler only after MongoDB connects', async () => {
    const client = await start();

    const connectOrder = mongoose.connect.mock.invocationCallOrder[0];
    // `client.on` registers the interactionCreate handler.
    const onOrder = client.on.mock.invocationCallOrder[0];

    expect(client.on).toHaveBeenCalledWith('interactionCreate', expect.any(Function));
    expect(connectOrder).toBeLessThan(onOrder);
  });

  it('creates the client with the Guilds and GuildMembers intents', async () => {
    await start();

    // The Client constructor was invoked once with the role-management intents.
    expect(lastClient.options).toEqual({ intents: [1, 2] });
    // Client is the mocked constructor.
    expect(typeof Client).toBe('function');
  });
});
