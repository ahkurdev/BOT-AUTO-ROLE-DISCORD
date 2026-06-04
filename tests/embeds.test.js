'use strict';

const {
  roleAddedEmbed,
  roleRemovedEmbed,
  duplicateRoleEmbed,
  notInListEmbed,
  noRolesAvailableEmbed,
  listEmptyEmbed,
} = require('../src/utils/embeds');

/**
 * Unit tests for embed text.
 *
 * Verifies that each user-facing Response_Embed builder produces the exact
 * required copy. Assertions check the combined title + description string so
 * they remain robust regardless of which field carries the text.
 *
 * Validates: Requirements 2.1, 2.2, 3.2, 4.2, 1.2, 5.3
 */

// A minimal Role-like stub: prefers a mention via toString(), exposes a name.
const roleStub = { name: 'Cool', toString: () => '<@&123>' };

/**
 * Combine an embed's title and description into a single searchable string.
 * @param {import('discord.js').EmbedBuilder} embed
 * @returns {string}
 */
function embedText(embed) {
  const { title = '', description = '' } = embed.data;
  return `${title}\n${description}`;
}

describe('embed text', () => {
  // Requirement 2.1: assigning a role responds with "Role ditambahkan".
  test('roleAddedEmbed contains "Role ditambahkan"', () => {
    expect(embedText(roleAddedEmbed(roleStub))).toContain('Role ditambahkan');
  });

  // Requirement 2.2: removing a role responds with "Role dilepas".
  test('roleRemovedEmbed contains "Role dilepas"', () => {
    expect(embedText(roleRemovedEmbed(roleStub))).toContain('Role dilepas');
  });

  // Requirement 3.2: adding a role already present responds with the duplicate warning.
  test('duplicateRoleEmbed contains "Role sudah ada di daftar"', () => {
    expect(embedText(duplicateRoleEmbed())).toContain('Role sudah ada di daftar');
  });

  // Requirement 4.2: removing a role that is absent responds with the not-in-list warning.
  test('notInListEmbed contains "Role tidak ada di daftar"', () => {
    expect(embedText(notInListEmbed())).toContain('Role tidak ada di daftar');
  });

  // Requirement 1.2: /role me with no available roles states that none are available.
  test('noRolesAvailableEmbed states that no self-assignable roles are available', () => {
    const text = embedText(noRolesAvailableEmbed());
    expect(text).toContain('Tidak ada role tersedia');
  });

  // Requirement 5.3: /role list with an empty list states that the list is empty.
  test('listEmptyEmbed states that the self-role list is empty', () => {
    const text = embedText(listEmptyEmbed());
    expect(text).toContain('Daftar self-role kosong');
  });

  // The role-parameterized builders also accept a plain string role argument.
  test('roleAddedEmbed accepts a plain string role and still reports success', () => {
    const text = embedText(roleAddedEmbed('Cool'));
    expect(text).toContain('Role ditambahkan');
    expect(text).toContain('Cool');
  });

  test('roleRemovedEmbed accepts a plain string role and still reports removal', () => {
    const text = embedText(roleRemovedEmbed('Cool'));
    expect(text).toContain('Role dilepas');
    expect(text).toContain('Cool');
  });
});
