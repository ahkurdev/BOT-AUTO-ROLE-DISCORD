'use strict';

/**
 * `/help` — a README-style overview of every command the bot offers, grouped
 * by audience (self-role, stock for everyone, stock admin/approver, info).
 *
 * The help content is built as a single rich embed so it reads like a quick
 * reference. It is open to everyone and replies ephemerally so it never
 * clutters the channel.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const BRAND_FOOTER = 'Created by Allan';
const HELP_COLOR = 0x5865f2;

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Tampilkan daftar perintah dan cara pakainya');

/**
 * Build the help/README embed describing all commands.
 * @returns {EmbedBuilder}
 */
function helpEmbed() {
  return new EmbedBuilder()
    .setColor(HELP_COLOR)
    .setTitle('Panduan Perintah')
    .setDescription(
      'Berikut semua perintah yang tersedia beserta cara pakainya. ' +
        'Perintah bertanda **(Approver)** hanya bisa dipakai oleh approver.',
    )
    .addFields(
      {
        name: 'Self-Role',
        value: [
          '`/role me` — buka menu untuk ambil/lepas role sendiri.',
          '`/role add <role>` — **(Approver)** tambah role ke daftar self-role.',
          '`/role remove <role>` — **(Approver)** hapus role dari daftar.',
          '`/role list` — **(Approver)** lihat daftar role yang tersedia.',
        ].join('\n'),
      },
      {
        name: 'Stock — Semua Member',
        value: [
          '`/wd <jumlah> <item> [kategori]` — tarik item dari stok.',
          '• Contoh: `/wd 200 Drill` (kategori otomatis dicari).',
          '• Sebutkan kategori hanya bila nama item ada di beberapa kategori.',
          '`/dp <jumlah> <item> [kategori]` — setor item ke stok.',
          '• Item baru: sebutkan kategori, mis. `/dp 200 Nail Gun Alat Rampok`.',
          '• Kategori baru otomatis dibuat bila belum ada.',
          '• Item yang sudah ada: cukup `/dp 50 Drill`.',
        ].join('\n'),
      },
      {
        name: 'Live Stock — Approver',
        value: [
          '`/livestock channel <channel>` — pasang papan Live Stock.',
          '`/livestock log <channel>` — set channel log transaksi.',
          '`/livestock setwd <channel>` — batasi `/wd` hanya di channel itu.',
          '`/livestock setdp <channel>` — batasi `/dp` hanya di channel itu.',
          '`/livestock create category <nama> [emoji]` — buat kategori.',
          '`/livestock delete category <nama>` — hapus kategori.',
          '`/livestock item add <kategori> <nama> [jumlah]` — tambah item.',
          '`/livestock item remove <kategori> <nama>` — hapus item.',
          '`/livestock refresh` — perbarui tampilan papan.',
        ].join('\n'),
      },
      {
        name: 'Lain-lain',
        value: '`/help` — tampilkan panduan ini.',
      },
    )
    .setFooter({ text: BRAND_FOOTER });
}

/**
 * Handle `/help`. Replies publicly with the help embed.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<unknown>}
 */
function handleHelp(interaction) {
  return interaction.reply({ embeds: [helpEmbed()] });
}

module.exports = { data, helpEmbed, handleHelp };
