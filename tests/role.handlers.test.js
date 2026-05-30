'use strict';

/**
 * Unit tests for the `/role` command handlers.
 *
 * These tests exercise the handler orchestration in `src/commands/role.js` by
 * mocking the discord.js `interaction` object and the `GuildRoles` repository
 * (so no MongoDB connection is required). The pure helpers (`staleRoles`,
 * `roleToggle`, `roleValidation`, `permissions`) and the real embed builders
 * are used as-is.
 *
 * For each path we assert two things:
 *   1. the correct Response_Embed builder result is sent (by inspecting the
 *      reply payload's embed title/description), and
 *   2. the correct side effect happens (member role add/remove, repository
 *      op called or not called).
 *
 * Validates: Requirements 1.2, 2.3, 2.5, 3.2, 4.2, 5.3, 6.1, 6.2
 */

// Mock the repository so the handlers never touch MongoDB.
jest.mock('../src/models/GuildRoles');

const { getRoles, addRole, removeRole, pruneRoles } = require('../src/models/GuildRoles');
const {
  handleRoleSelect,
  handleRoleAdd,
  handleRoleRemove,
  handleRoleList,
} = require('../src/commands/role');

const GUILD_ID = 'guild-1';

/**
 * Build a minimal discord.js Role-like stub.
 * @param {{ id: string, name?: string, position?: number }} opts
 */
function makeRole({ id, name = 'Test Role', position = 1 }) {
  return {
    id,
    name,
    position,
    toString: () => `<@&${id}>`,
  };
}

/**
 * Build a fake guild.
 * @param {object} [opts]
 * @param {Map<string, object>} [opts.roleCache] map of roleId -> role object
 * @param {boolean} [opts.botHasManageRoles]
 * @param {number} [opts.botHighestPosition]
 */
function makeGuild({
  roleCache = new Map(),
  botHasManageRoles = true,
  botHighestPosition = 100,
} = {}) {
  return {
    id: GUILD_ID,
    roles: { cache: roleCache },
    members: {
      me: {
        permissions: { has: jest.fn(() => botHasManageRoles) },
        roles: { highest: { position: botHighestPosition } },
      },
    },
  };
}

/**
 * Build a fake String Select Menu interaction.
 * @param {{ guild: object, selectedId: string, memberRoleIds?: string[] }} opts
 */
function makeSelectInteraction({ guild, selectedId, memberRoleIds = [] }) {
  return {
    guild,
    values: [selectedId],
    member: {
      roles: {
        cache: new Map(memberRoleIds.map((id) => [id, true])),
        add: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn().mockResolvedValue(undefined),
      },
    },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

/**
 * Build a fake chat-input (slash command) interaction.
 * @param {{ guild: object, role?: object|null, isAdmin?: boolean }} opts
 */
function makeChatInteraction({ guild, role = null, isAdmin = true }) {
  return {
    guild,
    memberPermissions: { has: jest.fn(() => isAdmin) },
    options: { getRole: jest.fn(() => role) },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

/** Return the first embed sent by the single reply call. */
function replyEmbed(interaction) {
  expect(interaction.reply).toHaveBeenCalledTimes(1);
  const payload = interaction.reply.mock.calls[0][0];
  return payload.embeds[0];
}

/** Combine an embed's title + description into one searchable string. */
function embedText(embed) {
  const { title = '', description = '' } = embed.data;
  return `${title}\n${description}`;
}

beforeEach(() => {
  // Sensible defaults; individual tests override as needed.
  getRoles.mockResolvedValue([]);
  addRole.mockResolvedValue({ changed: true, reason: 'added', roles: [] });
  removeRole.mockResolvedValue({ changed: true, reason: 'removed', roles: [] });
  pruneRoles.mockResolvedValue([]);
});

describe('handleRoleSelect', () => {
  // Requirement 2.1
  test('toggle ADD: member does not hold the role -> roles.add + "Role added"', async () => {
    const roleId = 'role-add';
    const role = makeRole({ id: roleId, name: 'Gamer', position: 1 });
    const guild = makeGuild({ roleCache: new Map([[roleId, role]]) });
    const interaction = makeSelectInteraction({ guild, selectedId: roleId, memberRoleIds: [] });

    await handleRoleSelect(interaction);

    expect(interaction.member.roles.add).toHaveBeenCalledWith(roleId);
    expect(interaction.member.roles.remove).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('Role added');
  });

  // Requirement 2.2
  test('toggle REMOVE: member holds the role -> roles.remove + "Role removed"', async () => {
    const roleId = 'role-remove';
    const role = makeRole({ id: roleId, name: 'Gamer', position: 1 });
    const guild = makeGuild({ roleCache: new Map([[roleId, role]]) });
    const interaction = makeSelectInteraction({
      guild,
      selectedId: roleId,
      memberRoleIds: [roleId],
    });

    await handleRoleSelect(interaction);

    expect(interaction.member.roles.remove).toHaveBeenCalledWith(roleId);
    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('Role removed');
  });

  // Requirement 2.3
  test('bot missing Manage Roles -> bot-missing-permission embed, no role change', async () => {
    const roleId = 'role-x';
    const role = makeRole({ id: roleId, position: 1 });
    const guild = makeGuild({
      roleCache: new Map([[roleId, role]]),
      botHasManageRoles: false,
    });
    const interaction = makeSelectInteraction({ guild, selectedId: roleId, memberRoleIds: [] });

    await handleRoleSelect(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.member.roles.remove).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('Cannot manage roles');
  });

  // Requirement 2.4
  test('hierarchy: selected role above bot highest -> hierarchy embed, no role change', async () => {
    const roleId = 'role-high';
    const role = makeRole({ id: roleId, position: 50 });
    const guild = makeGuild({
      roleCache: new Map([[roleId, role]]),
      botHighestPosition: 10, // role is above the bot
    });
    const interaction = makeSelectInteraction({ guild, selectedId: roleId, memberRoleIds: [] });

    await handleRoleSelect(interaction);

    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.member.roles.remove).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('Cannot manage this role');
  });

  // Requirement 2.5
  test('deleted role: not in guild cache -> pruneRoles([id]) + role-no-longer-available embed', async () => {
    const roleId = 'role-gone';
    const guild = makeGuild({ roleCache: new Map() }); // role not present
    const interaction = makeSelectInteraction({ guild, selectedId: roleId, memberRoleIds: [] });

    await handleRoleSelect(interaction);

    expect(pruneRoles).toHaveBeenCalledWith(GUILD_ID, [roleId]);
    expect(interaction.member.roles.add).not.toHaveBeenCalled();
    expect(interaction.member.roles.remove).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('Role no longer available');
  });
});

describe('handleRoleAdd', () => {
  // Requirement 3.2
  test('duplicate: addRole reports duplicate -> duplicate embed', async () => {
    const role = makeRole({ id: 'role-dup', position: 1 });
    const guild = makeGuild({ botHighestPosition: 100 });
    const interaction = makeChatInteraction({ guild, role, isAdmin: true });

    addRole.mockResolvedValue({ changed: false, reason: 'duplicate', roles: [] });

    await handleRoleAdd(interaction);

    expect(addRole).toHaveBeenCalledWith(GUILD_ID, role.id);
    expect(embedText(replyEmbed(interaction))).toContain('That role is already in the list');
  });

  // Requirement 3.1
  test('success: addRole reports added -> addedConfirm embed', async () => {
    const role = makeRole({ id: 'role-new', position: 1 });
    const guild = makeGuild({ botHighestPosition: 100 });
    const interaction = makeChatInteraction({ guild, role, isAdmin: true });

    addRole.mockResolvedValue({ changed: true, reason: 'added', roles: [role.id] });

    await handleRoleAdd(interaction);

    expect(addRole).toHaveBeenCalledWith(GUILD_ID, role.id);
    expect(embedText(replyEmbed(interaction))).toContain('Role added to the self-role list');
  });
});

describe('handleRoleRemove', () => {
  // Requirement 4.2
  test('absent: removeRole reports absent -> not-in-list embed', async () => {
    const role = makeRole({ id: 'role-absent', position: 1 });
    const guild = makeGuild();
    const interaction = makeChatInteraction({ guild, role, isAdmin: true });

    removeRole.mockResolvedValue({ changed: false, reason: 'absent', roles: [] });

    await handleRoleRemove(interaction);

    expect(removeRole).toHaveBeenCalledWith(GUILD_ID, role.id);
    expect(embedText(replyEmbed(interaction))).toContain("That role isn't in the list");
  });

  // Requirement 4.1
  test('success: removeRole reports removed -> removedConfirm embed', async () => {
    const role = makeRole({ id: 'role-present', position: 1 });
    const guild = makeGuild();
    const interaction = makeChatInteraction({ guild, role, isAdmin: true });

    removeRole.mockResolvedValue({ changed: true, reason: 'removed', roles: [] });

    await handleRoleRemove(interaction);

    expect(removeRole).toHaveBeenCalledWith(GUILD_ID, role.id);
    expect(embedText(replyEmbed(interaction))).toContain('Role removed from the self-role list');
  });
});

describe('non-admin permission gate (Requirement 6.2)', () => {
  test('handleRoleAdd: non-admin -> no-permission embed, addRole not called', async () => {
    const role = makeRole({ id: 'role-x', position: 1 });
    const guild = makeGuild();
    const interaction = makeChatInteraction({ guild, role, isAdmin: false });

    await handleRoleAdd(interaction);

    expect(addRole).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('You lack permission');
  });

  test('handleRoleRemove: non-admin -> no-permission embed, removeRole not called', async () => {
    const role = makeRole({ id: 'role-x', position: 1 });
    const guild = makeGuild();
    const interaction = makeChatInteraction({ guild, role, isAdmin: false });

    await handleRoleRemove(interaction);

    expect(removeRole).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('You lack permission');
  });

  test('handleRoleList: non-admin -> no-permission embed, getRoles not called', async () => {
    const guild = makeGuild();
    const interaction = makeChatInteraction({ guild, isAdmin: false });

    await handleRoleList(interaction);

    expect(getRoles).not.toHaveBeenCalled();
    expect(embedText(replyEmbed(interaction))).toContain('You lack permission');
  });
});

describe('handleRoleList', () => {
  // Requirement 5.3
  test('empty: no stored roles -> listEmpty embed', async () => {
    const guild = makeGuild({ roleCache: new Map() });
    const interaction = makeChatInteraction({ guild, isAdmin: true });

    getRoles.mockResolvedValue([]);

    await handleRoleList(interaction);

    expect(getRoles).toHaveBeenCalledWith(GUILD_ID);
    expect(embedText(replyEmbed(interaction))).toContain('The self-role list is empty');
  });

  // Requirement 5.1
  test('valid roles: stored roles exist in guild -> listRoles embed enumerating them', async () => {
    const roleA = makeRole({ id: 'role-a', name: 'Alpha', position: 1 });
    const roleB = makeRole({ id: 'role-b', name: 'Beta', position: 2 });
    const guild = makeGuild({
      roleCache: new Map([
        [roleA.id, roleA],
        [roleB.id, roleB],
      ]),
    });
    const interaction = makeChatInteraction({ guild, isAdmin: true });

    getRoles.mockResolvedValue([roleA.id, roleB.id]);

    await handleRoleList(interaction);

    const text = embedText(replyEmbed(interaction));
    expect(text).toContain('Self-assignable roles');
    expect(text).toContain('<@&role-a>');
    expect(text).toContain('<@&role-b>');
  });
});
