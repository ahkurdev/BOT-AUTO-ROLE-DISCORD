'use strict';

const { data, helpEmbed, handleHelp } = require('../src/commands/help');

/**
 * Unit tests for the /help command embed and handler.
 */
describe('/help', () => {
  it('defines the help slash command', () => {
    expect(data.toJSON().name).toBe('help');
  });

  it('builds an embed listing the main commands with the brand footer', () => {
    const embed = helpEmbed();
    const text = JSON.stringify(embed.data);
    // A representative command from each group is present.
    expect(text).toContain('/role me');
    expect(text).toContain('/wd');
    expect(text).toContain('/dp');
    expect(text).toContain('/livestock channel');
    expect(text).toContain('/livestock create category');
    expect(text).toContain('/help');
    expect(embed.data.footer.text).toBe('Created by Allan');
  });

  it('replies publicly with the help embed (not ephemeral)', async () => {
    const interaction = { reply: jest.fn().mockResolvedValue(undefined) };
    await handleHelp(interaction);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    const payload = interaction.reply.mock.calls[0][0];
    expect(payload.embeds).toHaveLength(1);
    // Public reply: no ephemeral flag.
    expect(payload.flags).toBeUndefined();
  });
});
