'use strict';

/**
 * Unit tests for the approval flow in `src/commands/role.js`.
 *
 * Approval mode is enabled by setting APPROVAL_CHANNEL_ID + APPROVER_ROLE_ID.
 * These tests set those env vars, mock the discord.js `interaction`/guild
 * objects and the `GuildRoles` repository, and assert:
 *   - `/role me` selection posts a request (with Accept/Reject buttons) to the
 *     approval channel instead of toggling the role instantly,
 *   - a member who already holds the role gets told so (no request sent),
 *   - the Accept button grants the role to the original requester,
 *   - the Reject button changes no roles,
 *   - a non-approver clicking a button is refused.
 */

jest.mock('../src/models/GuildRoles');
// Mock GuildConfig so getApprovalConfig resolves with approval enabled.
jest.mock('../src/models/GuildConfig', () => ({
  getConfig: jest.fn().mockResolvedValue({
    guildId: 'guild-1',
    approverRoleId: 'approver-role',
    approvalChannelId: 'approval-chan',
    approvalEnabled: true,
  }),
}));

const { getRoles, pruneRoles } = require('../src/models/GuildRoles');

const APPROVAL_CHANNEL_ID = 'approval-chan';
const APPROVER_ROLE_ID = 'approver-role';
const GUILD_ID = 'guild-1';

const {
  handleRoleSelect,
  handleApprovalButton,
  APPROVE_BUTTON_PREFIX,
  REJECT_BUTTON_PREFIX,
} = require('../src/commands/role');

function makeRole({ id, name = 'Test Role', position = 1 }) {
  return { id, name, position, toString: () => `<@&${id}>` };
}

/** A fake text channel that records sent messages. */
function makeChannel() {
  return {
    isTextBased: () => true,
    send: jest.fn().mockResolvedValue(undefined),
  };
}

function makeGuild({ roleCache, channel, botHasManageRoles = true, botHighestPosition = 100 }) {
  return {
    id: GUILD_ID,
    roles: { cache: roleCache },
    channels: { fetch: jest.fn().mockResolvedValue(channel) },
    members: {
      me: {
        permissions: { has: jest.fn(() => botHasManageRoles) },
        roles: { highest: { position: botHighestPosition } },
      },
      fetch: jest.fn(),
    },
  };
}

function makeSelectInteraction({ guild, selectedId, memberRoleIds = [], memberId = 'requester-1' }) {
  return {
    guild,
    values: [selectedId],
    member: {
      id: memberId,
      roles: { cache: new Map(memberRoleIds.map((id) => [id, true])) },
      toString: () => `<@${memberId}>`,
    },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

function replyEmbedText(interaction) {
  const payload = interaction.reply.mock.calls[0][0];
  const embed = payload.embeds[0];
  const { title = '', description = '' } = embed.data;
  return `${title}\n${description}`;
}

beforeEach(() => {
  getRoles.mockResolvedValue([]);
  pruneRoles.mockResolvedValue([]);
});

describe('approval mode: handleRoleSelect', () => {
  it('posts an approval request to the channel instead of toggling', async () => {
    const roleId = 'role-x';
    const role = makeRole({ id: roleId });
    const channel = makeChannel();
    const guild = makeGuild({ roleCache: new Map([[roleId, role]]), channel });
    const interaction = makeSelectInteraction({ guild, selectedId: roleId, memberRoleIds: [] });

    await handleRoleSelect(interaction);

    // The request was posted to the approval channel.
    expect(guild.channels.fetch).toHaveBeenCalledWith(APPROVAL_CHANNEL_ID);
    expect(channel.send).toHaveBeenCalledTimes(1);

    const sent = channel.send.mock.calls[0][0];
    // Pings the approver role and carries Accept/Reject buttons.
    expect(sent.content).toContain(APPROVER_ROLE_ID);
    const buttons = sent.components[0].components.map((c) => c.data.custom_id);
    expect(buttons[0]).toBe(`${APPROVE_BUTTON_PREFIX}:requester-1:${roleId}`);
    expect(buttons[1]).toBe(`${REJECT_BUTTON_PREFIX}:requester-1:${roleId}`);

    // The member gets an ephemeral "request submitted" reply.
    expect(replyEmbedText(interaction)).toContain('Permintaan terkirim');
  });

  it('removes the role instantly when the member already has it (no approval for removal)', async () => {
    const roleId = 'role-have';
    const role = makeRole({ id: roleId });
    const channel = makeChannel();
    const guild = makeGuild({ roleCache: new Map([[roleId, role]]), channel });
    const interaction = makeSelectInteraction({
      guild,
      selectedId: roleId,
      memberRoleIds: [roleId],
    });
    // Add a remove mock to the member.roles
    interaction.member.roles.remove = jest.fn().mockResolvedValue(undefined);

    await handleRoleSelect(interaction);

    expect(channel.send).not.toHaveBeenCalled();
    expect(interaction.member.roles.remove).toHaveBeenCalledWith(roleId);
    expect(replyEmbedText(interaction)).toContain('Role dilepas');
  });
});

describe('approval mode: handleApprovalButton', () => {
  function makeButtonInteraction({ guild, customId, clickerRoleIds = [APPROVER_ROLE_ID] }) {
    return {
      guild,
      customId,
      member: {
        id: 'approver-1',
        roles: { cache: new Map(clickerRoleIds.map((id) => [id, true])) },
        toString: () => '<@approver-1>',
      },
      update: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      followUp: jest.fn().mockResolvedValue(undefined),
      message: { edit: jest.fn().mockResolvedValue(undefined) },
      replied: false,
      deferred: false,
    };
  }

  it('Accept grants the role to the original requester', async () => {
    const roleId = 'role-x';
    const role = makeRole({ id: roleId });
    const guild = makeGuild({ roleCache: new Map([[roleId, role]]), channel: makeChannel() });

    const requester = {
      id: 'requester-1',
      roles: { add: jest.fn().mockResolvedValue(undefined) },
      send: jest.fn().mockResolvedValue(undefined),
      toString: () => '<@requester-1>',
    };
    guild.members.fetch.mockResolvedValue(requester);

    const interaction = makeButtonInteraction({
      guild,
      customId: `${APPROVE_BUTTON_PREFIX}:requester-1:${roleId}`,
    });

    await handleApprovalButton(interaction);

    expect(requester.roles.add).toHaveBeenCalledWith(roleId);
    // The request message is resolved (buttons removed).
    expect(interaction.update).toHaveBeenCalledTimes(1);
    const updated = interaction.update.mock.calls[0][0];
    expect(updated.components).toEqual([]);
  });

  it('Reject grants no role', async () => {
    const roleId = 'role-x';
    const role = makeRole({ id: roleId });
    const guild = makeGuild({ roleCache: new Map([[roleId, role]]), channel: makeChannel() });

    const requester = {
      id: 'requester-1',
      roles: { add: jest.fn().mockResolvedValue(undefined) },
      send: jest.fn().mockResolvedValue(undefined),
      toString: () => '<@requester-1>',
    };
    guild.members.fetch.mockResolvedValue(requester);

    const interaction = makeButtonInteraction({
      guild,
      customId: `${REJECT_BUTTON_PREFIX}:requester-1:${roleId}`,
    });

    await handleApprovalButton(interaction);

    expect(requester.roles.add).not.toHaveBeenCalled();
    expect(interaction.update).toHaveBeenCalledTimes(1);
  });

  it('refuses a clicker who lacks the approver role', async () => {
    const roleId = 'role-x';
    const role = makeRole({ id: roleId });
    const guild = makeGuild({ roleCache: new Map([[roleId, role]]), channel: makeChannel() });

    const interaction = makeButtonInteraction({
      guild,
      customId: `${APPROVE_BUTTON_PREFIX}:requester-1:${roleId}`,
      clickerRoleIds: [], // not an approver
    });

    await handleApprovalButton(interaction);

    // No role granted, and the message is NOT resolved.
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledTimes(1);
  });
});
