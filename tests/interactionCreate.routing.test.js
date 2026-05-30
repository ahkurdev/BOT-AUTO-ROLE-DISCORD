'use strict';

/**
 * Unit tests for the `InteractionCreate` event router
 * (`src/events/interactionCreate.js`).
 *
 * The router itself contains no domain logic: its single responsibility is to
 * inspect an incoming interaction and dispatch it to the matching `/role`
 * handler (or ignore it). To test that routing in isolation we mock the
 * `../src/commands/role` command module so every handler is a `jest.fn()`.
 * This lets us assert exactly which handler was invoked (and that the others
 * were not) without exercising any real handler logic or touching Discord.
 *
 * The mock must still expose `ROLE_SELECT_CUSTOM_ID` and `data` because
 * `interactionCreate.js` destructures them at require time.
 *
 * Validates: Requirements 1.1, 2.1
 */

// Mock the command module so the router dispatches to jest.fn() handlers.
jest.mock('../src/commands/role', () => ({
  ROLE_SELECT_CUSTOM_ID: 'role-select',
  APPROVE_BUTTON_PREFIX: 'role-approve',
  REJECT_BUTTON_PREFIX: 'role-reject',
  data: { toJSON: () => ({}) },
  handleRoleMe: jest.fn(),
  handleRoleSelect: jest.fn(),
  handleApprovalButton: jest.fn(),
  handleRoleAdd: jest.fn(),
  handleRoleRemove: jest.fn(),
  handleRoleList: jest.fn(),
}));

const {
  handleRoleMe,
  handleRoleSelect,
  handleApprovalButton,
  handleRoleAdd,
  handleRoleRemove,
  handleRoleList,
} = require('../src/commands/role');
const interactionCreate = require('../src/events/interactionCreate');

/** All mocked handlers, for "no handler called" assertions. */
const allHandlers = [
  handleRoleMe,
  handleRoleSelect,
  handleApprovalButton,
  handleRoleAdd,
  handleRoleRemove,
  handleRoleList,
];

/**
 * Build a `/role <subcommand>` chat-input interaction stub.
 * @param {string} subcommand
 * @param {string} [commandName]
 */
function makeChatInput(subcommand, commandName = 'role') {
  return {
    isChatInputCommand: () => true,
    isStringSelectMenu: () => false,
    isButton: () => false,
    isAutocomplete: () => false,
    commandName,
    options: { getSubcommand: () => subcommand },
  };
}

/**
 * Build a String Select Menu interaction stub.
 * @param {string} customId
 */
function makeSelectMenu(customId) {
  return {
    isChatInputCommand: () => false,
    isStringSelectMenu: () => true,
    isButton: () => false,
    isAutocomplete: () => false,
    customId,
  };
}

/**
 * Build a button interaction stub.
 * @param {string} customId
 */
function makeButton(customId) {
  return {
    isChatInputCommand: () => false,
    isStringSelectMenu: () => false,
    isButton: () => true,
    isAutocomplete: () => false,
    customId,
  };
}

/** Assert that exactly one handler was called once with `interaction`. */
function expectOnlyHandlerCalled(handler, interaction) {
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(interaction);
  for (const other of allHandlers) {
    if (other !== handler) {
      expect(other).not.toHaveBeenCalled();
    }
  }
}

describe('interactionCreate router', () => {
  // jest.config.js sets clearMocks: true, but be explicit for clarity.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes the InteractionCreate event descriptor', () => {
    expect(interactionCreate.name).toBe('interactionCreate');
    expect(typeof interactionCreate.execute).toBe('function');
  });

  describe('chat-input /role subcommands (Req 1.1)', () => {
    it('routes /role me to handleRoleMe', () => {
      const interaction = makeChatInput('me');
      interactionCreate.execute(interaction);
      expectOnlyHandlerCalled(handleRoleMe, interaction);
    });

    it('routes /role add to handleRoleAdd', () => {
      const interaction = makeChatInput('add');
      interactionCreate.execute(interaction);
      expectOnlyHandlerCalled(handleRoleAdd, interaction);
    });

    it('routes /role remove to handleRoleRemove', () => {
      const interaction = makeChatInput('remove');
      interactionCreate.execute(interaction);
      expectOnlyHandlerCalled(handleRoleRemove, interaction);
    });

    it('routes /role list to handleRoleList', () => {
      const interaction = makeChatInput('list');
      interactionCreate.execute(interaction);
      expectOnlyHandlerCalled(handleRoleList, interaction);
    });

    it('ignores an unknown /role subcommand (no handler called)', () => {
      const interaction = makeChatInput('bogus');
      interactionCreate.execute(interaction);
      for (const handler of allHandlers) {
        expect(handler).not.toHaveBeenCalled();
      }
    });
  });

  describe('String Select Menu (Req 2.1)', () => {
    it('routes the role-select menu to handleRoleSelect', () => {
      const interaction = makeSelectMenu('role-select');
      interactionCreate.execute(interaction);
      expectOnlyHandlerCalled(handleRoleSelect, interaction);
    });

    it('ignores a select menu with a different customId', () => {
      const interaction = makeSelectMenu('some-other-menu');
      interactionCreate.execute(interaction);
      expect(handleRoleSelect).not.toHaveBeenCalled();
      for (const handler of allHandlers) {
        expect(handler).not.toHaveBeenCalled();
      }
    });
  });

  describe('approval buttons (approval mode)', () => {
    it('routes an Accept button to handleApprovalButton', () => {
      const interaction = makeButton('role-approve:123:456');
      interactionCreate.execute(interaction);
      expectOnlyHandlerCalled(handleApprovalButton, interaction);
    });

    it('routes a Reject button to handleApprovalButton', () => {
      const interaction = makeButton('role-reject:123:456');
      interactionCreate.execute(interaction);
      expectOnlyHandlerCalled(handleApprovalButton, interaction);
    });

    it('ignores a button with an unrelated customId', () => {
      const interaction = makeButton('some-other-button');
      interactionCreate.execute(interaction);
      for (const handler of allHandlers) {
        expect(handler).not.toHaveBeenCalled();
      }
    });
  });

  describe('non-/role and non-component interactions', () => {
    it('ignores an unknown chat-input command (commandName !== "role")', () => {
      const interaction = makeChatInput('me', 'ping');
      interactionCreate.execute(interaction);
      for (const handler of allHandlers) {
        expect(handler).not.toHaveBeenCalled();
      }
    });

    it('ignores an interaction that is neither command nor select menu (no throw)', () => {
      const interaction = {
        isChatInputCommand: () => false,
        isStringSelectMenu: () => false,
        isButton: () => false,
        isAutocomplete: () => false,
      };
      expect(() => interactionCreate.execute(interaction)).not.toThrow();
      for (const handler of allHandlers) {
        expect(handler).not.toHaveBeenCalled();
      }
    });
  });
});
