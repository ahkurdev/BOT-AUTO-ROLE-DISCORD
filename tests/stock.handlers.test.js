'use strict';

/**
 * Unit tests for the /wd and /dp handlers (src/commands/stock.js).
 *
 * The GuildStock repository is mocked so no MongoDB is needed. We assert the
 * handler reads the options, calls the right repo op, and replies with the
 * matching embed for success, insufficient stock, not-configured, and
 * not-found cases.
 */

jest.mock('../src/models/GuildStock');

const repo = require('../src/models/GuildStock');
const { handleWithdraw, handleDeposit } = require('../src/commands/stock');

const GUILD_ID = 'guild-1';

function makeInteraction({ jumlah, item, kategori, channelId = 'tx-chan' }) {
  return {
    guild: {
      id: GUILD_ID,
      iconURL: () => null,
      channels: { fetch: jest.fn().mockResolvedValue(null) },
    },
    channelId,
    member: { id: 'm1', toString: () => '<@m1>' },
    options: {
      getInteger: (n) => (n === 'jumlah' ? jumlah : null),
      getString: (n) => (n === 'item' ? item : n === 'kategori' ? kategori : null),
    },
    reply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  };
}

function replyText(interaction) {
  const payload = interaction.reply.mock.calls[0][0];
  const embed = payload.embeds[0];
  const { title = '', description = '' } = embed.data;
  return `${title}\n${description}`;
}

beforeEach(() => {
  // Default: board configured, refresh/log are no-ops via fetch -> null.
  repo.getStock.mockResolvedValue({ guildId: GUILD_ID, channelId: 'chan', categories: [] });
});

describe('handleWithdraw', () => {
  it('replies not-configured when there is no board channel', async () => {
    repo.getStock.mockResolvedValue(null);
    const interaction = makeInteraction({ jumlah: 5, item: 'Drill', kategori: 'Alat Rampok' });

    await handleWithdraw(interaction);

    expect(replyText(interaction)).toContain('Live Stock belum diatur');
    expect(repo.withdrawItem).not.toHaveBeenCalled();
  });

  it('on success calls withdrawSmartItem (no category needed) and confirms remaining', async () => {
    repo.withdrawSmartItem.mockResolvedValue({
      changed: true,
      reason: 'ok',
      item: { name: 'Drill', quantity: 5 },
      category: { name: 'Alat Rampok' },
    });
    const interaction = makeInteraction({ jumlah: 3, item: 'Drill' });

    await handleWithdraw(interaction);

    expect(repo.withdrawSmartItem).toHaveBeenCalledWith(GUILD_ID, 'Drill', 3, undefined);
    expect(replyText(interaction)).toContain('Withdraw berhasil');
  });

  it('on insufficient stock replies with the stock-too-low embed', async () => {
    repo.withdrawSmartItem.mockResolvedValue({
      changed: false,
      reason: 'insufficient_stock',
      available: 8,
      item: { name: 'Drill' },
    });
    const interaction = makeInteraction({ jumlah: 200, item: 'Drill' });

    await handleWithdraw(interaction);

    expect(replyText(interaction)).toContain('Stok tidak cukup');
  });

  it('on ambiguous item asks the user to pick a category', async () => {
    repo.withdrawSmartItem.mockResolvedValue({
      changed: false,
      reason: 'ambiguous',
      options: ['Perlengkapan', 'Crafting'],
    });
    const interaction = makeInteraction({ jumlah: 1, item: 'Paket Coccaine' });

    await handleWithdraw(interaction);

    expect(replyText(interaction)).toContain('Pilih kategori');
  });

  it('on unknown item replies with a not-found embed', async () => {
    repo.withdrawSmartItem.mockResolvedValue({ changed: false, reason: 'item_not_found' });
    const interaction = makeInteraction({ jumlah: 1, item: 'Nope' });

    await handleWithdraw(interaction);

    expect(replyText(interaction)).toContain('tidak');
  });

  it('refuses /wd in the wrong channel when a wd channel is set', async () => {
    repo.getStock.mockResolvedValue({
      guildId: GUILD_ID,
      channelId: 'chan',
      wdChannelId: 'only-here',
      categories: [],
    });
    const interaction = makeInteraction({ jumlah: 1, item: 'Drill', channelId: 'somewhere-else' });

    await handleWithdraw(interaction);

    expect(replyText(interaction)).toContain('Channel salah');
    expect(repo.withdrawSmartItem).not.toHaveBeenCalled();
  });

  it('allows /wd in the configured channel', async () => {
    repo.getStock.mockResolvedValue({
      guildId: GUILD_ID,
      channelId: 'chan',
      wdChannelId: 'only-here',
      categories: [],
    });
    repo.withdrawSmartItem.mockResolvedValue({
      changed: true,
      reason: 'ok',
      item: { name: 'Drill', quantity: 1 },
      category: { name: 'Alat Rampok' },
    });
    const interaction = makeInteraction({ jumlah: 1, item: 'Drill', channelId: 'only-here' });

    await handleWithdraw(interaction);

    expect(repo.withdrawSmartItem).toHaveBeenCalled();
    expect(replyText(interaction)).toContain('Withdraw berhasil');
  });
});

describe('handleDeposit', () => {
  it('on success calls depositSmartItem and confirms with total stock', async () => {
    repo.depositSmartItem.mockResolvedValue({
      changed: true,
      reason: 'ok',
      item: { name: 'Drill', quantity: 13 },
      category: { name: 'Alat Rampok' },
    });
    const interaction = makeInteraction({ jumlah: 5, item: 'Drill', kategori: 'Alat Rampok' });

    await handleDeposit(interaction);

    expect(repo.depositSmartItem).toHaveBeenCalledWith(GUILD_ID, 'Drill', 5, 'Alat Rampok');
    expect(replyText(interaction)).toContain('Deposit berhasil');
  });

  it('creating a brand-new item with a category reports it as created', async () => {
    repo.depositSmartItem.mockResolvedValue({
      changed: true,
      reason: 'created',
      item: { name: 'Nail Gun', quantity: 200 },
      category: { name: 'Alat Rampok' },
    });
    const interaction = makeInteraction({ jumlah: 200, item: 'Nail Gun', kategori: 'Alat Rampok' });

    await handleDeposit(interaction);

    expect(replyText(interaction)).toContain('Item baru');
  });

  it('auto-creates a new category on deposit and says so', async () => {
    repo.depositSmartItem.mockResolvedValue({
      changed: true,
      reason: 'created',
      categoryCreated: true,
      item: { name: 'Repair Kit', quantity: 7 },
      category: { name: 'Utils' },
    });
    const interaction = makeInteraction({ jumlah: 7, item: 'Repair Kit', kategori: 'Utils' });

    await handleDeposit(interaction);

    const text = replyText(interaction);
    expect(text).toContain('Kategori Utils dibuat');
  });

  it('a brand-new item without a category asks for one', async () => {
    repo.depositSmartItem.mockResolvedValue({ changed: false, reason: 'need_category' });
    const interaction = makeInteraction({ jumlah: 200, item: 'Nail Gun' });

    await handleDeposit(interaction);

    expect(replyText(interaction)).toContain('Pilih kategori');
  });
});
