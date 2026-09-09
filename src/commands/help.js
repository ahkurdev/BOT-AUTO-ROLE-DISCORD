'use strict';

/**
 * `/help` — a README-style overview of every command the bot offers, grouped
 * by audience (self-role, stock, live stock, config, info).
 *
 * The help content is built as a single rich embed so it reads like a quick
 * reference. It is open to everyone and replies ephemerally so it never
 * clutters the channel.
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { applyBranding, COLORS } = require('../utils/shared');

const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Tampilkan daftar perintah dan cara pakainya');

/**
 * Build the help/README embed describing all commands.
 * @returns {EmbedBuilder}
 */
function helpEmbed() {
  return applyBranding(
    new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('Panduan Perintah')
      .setDescription(
        'Berikut semua perintah yang tersedia beserta cara pakainya.\n' +
          'Perintah bertanda **(Admin)** hanya bisa dipakai oleh Administrator server.',
      )
      .addFields(
        {
          name: 'Self-Role',
          value: [
            '`/role me pj:@User` — buka menu untuk ambil/lepas role dan tentukan penanggung jawab.',
            '`/role add <role>` — **(Admin)** tambah role ke daftar self-role.',
            '`/role remove <role>` — **(Admin)** hapus role dari daftar.',
            '`/role list` — **(Admin)** lihat daftar role yang tersedia.',
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
            '• Item yang sudah ada: cukup `/dp 50 Drill`.',
          ].join('\n'),
        },
        {
          name: 'Live Stock — Approver',
          value: [
            '`/livestock channel <channel>` — pasang papan Live Stock.',
            '`/livestock log <channel>` — set channel log transaksi.',
            '`/livestock create category <nama> [emoji]` — buat kategori.',
            '`/livestock delete category <nama>` — hapus kategori.',
            '`/livestock item add <kategori> <nama> [jumlah]` — tambah item.',
            '`/livestock item remove <kategori> <nama>` — hapus item.',
            '`/livestock refresh` — perbarui tampilan papan.',
            '`/livestock reset` — reset semua stok ke 0 (dengan konfirmasi).',
            '`/livestock history [user] [jumlah]` — lihat riwayat transaksi.',
          ].join('\n'),
        },
        {
          name: 'Konfigurasi — Admin',
          value: [
            '`/config approver add <role>` — tambah role approver untuk Live Stock (maks 3).',
            '`/config approver remove <role>` — hapus role approver.',
            '`/config list-channel <channel>` — set channel list untuk embed Penanggung Jawab.',
            '`/config tutorial-setup` — tampilkan pesan panduan otomatis di channel.',
            '`/config role-channel add <channel>` — batasi `/role me` ke channel tertentu.',
            '`/config role-channel remove <channel>` — hapus batasan channel `/role me`.',
            '`/config role-channel list` — lihat daftar channel yang diizinkan untuk `/role me`.',
            '`/config wd-channel add <channel>` — batasi `/wd` ke channel tertentu.',
            '`/config wd-channel remove <channel>` — hapus batasan channel `/wd`.',
            '`/config wd-channel list` — lihat daftar channel yang diizinkan untuk `/wd`.',
            '`/config dp-channel add <channel>` — batasi `/dp` ke channel tertentu.',
            '`/config dp-channel remove <channel>` — hapus batasan channel `/dp`.',
            '`/config dp-channel list` — lihat daftar channel yang diizinkan untuk `/dp`.',
            '`/config show` — tampilkan semua konfigurasi server saat ini.',
          ].join('\n'),
        },
        {
          name: 'Pembatasan Channel',
          value: [
            'Setelah channel dibatasi via `/config`, pesan biasa yang dikirim di channel tersebut',
            'akan **otomatis dihapus** dan pengirim mendapat peringatan sementara (8 detik).',
            'Hal ini berlaku untuk channel `/role me`, `/wd`, dan `/dp`.',
          ].join('\n'),
        },
        {
          name: 'Lain-lain',
          value: [
            '`/help` — tampilkan panduan ini.',
            '`/ai chat <pesan> [model]` — ngobrol santai dengan AI (tidak melayani coding).',
            '`/ai models` — lihat daftar model AI gratis.',
          ].join('\n'),
        },
      ),
  );
}

/**
 * Handle `/help`. Replies ephemerally with the help embed.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @returns {Promise<unknown>}
 */
function handleHelp(interaction) {
  return interaction.reply({ embeds: [helpEmbed()] });
}

module.exports = { data, helpEmbed, handleHelp };
