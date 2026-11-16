English version: [README.md](README.md)

# Bot Shellby

Bot Discord serbaguna untuk **self-role & Penanggung Jawab (PJ)**, **manajemen stok (withdraw/deposit)** dengan papan **Live Stock** real-time. Dibangun dengan Node.js + discord.js v14, data tersimpan per-guild di MongoDB.

## Fitur

- **Self-role & Person in Charge** — Member mengambil/melepas role sendiri lewat menu sekaligus menandai penanggung jawabnya via `/role me pj:@User`. Daftar kepemilikan role & PJ dikelola otomatis dalam embed publik.
- **Pembatasan channel** — `/role me`, `/wd`, dan `/dp` bisa dibatasi ke channel tertentu lewat konfigurasi.
- **Auto-delete pesan biasa** — Pesan teks biasa di channel khusus perintah (role me, wd, dp) **otomatis dihapus** dan pengirim diberi peringatan sementara (8 detik) sebelum dihapus lagi secara bersih tanpa emoji (pesan tutorial dikecualikan).
- **Withdraw / Deposit** — `/wd` dan `/dp` untuk semua member, dengan pencocokan kategori otomatis.
- **Papan Live Stock** — Papan stok yang ter-update otomatis setiap transaksi, angka diformat dengan pemisah ribuan (contoh `14.894.829`).
- **Log transaksi** — Setiap withdraw/deposit bisa dicatat ke log channel dan disimpan di database (auto-hapus setelah 90 hari).
- **Presence** — Status bot yang bisa dirotasi ("Playing/Watching ...").
- **Auto-deploy** — Slash command otomatis terdaftar saat bot start.
- **Rate limiting** — Anti-spam per user per command (cooldown 3-5 detik).
- **Konfigurasi per-guild** — Approver role, daftar channel PJ, channel tutorial, dan pembatasan channel diatur per server lewat `/config`.
- **Graceful shutdown** — Koneksi MongoDB dan Discord ditutup dengan bersih saat bot dimatikan.

## Persyaratan

- Node.js 18+
- MongoDB (lokal atau Atlas)
- Aplikasi bot di [Discord Developer Portal](https://discord.com/developers/applications)
  - **Server Members Intent** dan **Message Content Intent** harus diaktifkan (Bot > Privileged Gateway Intents).
  - Bot diundang dengan scope `bot` dan `applications.commands`, serta permission **Manage Roles** dan **Manage Messages**.

## Instalasi

```bash
git clone https://github.com/Allan4u/bot-shellby.git
cd bot-shellby
npm install
```

## Konfigurasi

Salin `.env.example` ke `.env` lalu isi nilainya:

```bash
cp .env.example .env
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DISCORD_TOKEN` | ya | Token bot dari Developer Portal. |
| `CLIENT_ID` | ya | Application (client) ID — dipakai untuk registrasi command. |
| `GUILD_ID` | ya | ID server tempat command didaftarkan. |
| `MONGODB_URI` | ya | Connection string MongoDB. |
| `DNS_SERVERS` | tidak | DNS server untuk Node (contoh `8.8.8.8,1.1.1.1`) jika `mongodb+srv://` gagal resolve. |
| `BOT_ACTIVITY` | tidak | Teks status; beberapa teks dipisah `\|` akan dirotasi. |
| `BOT_ACTIVITY_TYPE` | tidak | `Playing` \| `Watching` \| `Listening` \| `Competing` (default `Playing`). |
| `BOT_STATUS` | tidak | `online` \| `idle` \| `dnd` \| `invisible` (default `online`). |
| `BOT_ACTIVITY_ROTATE_MS` | tidak | Interval rotasi status (min 15000, default 30000). |
| `AUTO_DEPLOY_COMMANDS` | tidak | Daftarkan command otomatis saat start (default `true`; set `false` untuk manual). |
| `LOG_LEVEL` | tidak | Level log: `debug` \| `info` \| `warn` \| `error` (default `info`). |

## Menjalankan

```bash
# Daftarkan slash command secara manual
npm run deploy

# Jalankan bot
npm start

# Jalankan test
npm test
```

## Daftar Perintah

### Self-Role & PJ

| Perintah | Akses | Deskripsi |
|---|---|---|
| `/role me pj:@User` | Semua | Buka menu untuk mengambil/melepas role sendiri sambil menandai penanggung jawab. Hanya bisa di channel yang diizinkan. |
| `/role add <role>` | Admin | Tambah role ke daftar self-role. |
| `/role remove <role>` | Admin | Hapus role dari daftar. |
| `/role list` | Admin | Lihat daftar role yang tersedia. |

### Stok (Semua Member)

| Perintah | Deskripsi |
|---|---|
| `/wd <jumlah> <item> [kategori]` | Tarik item dari stok. Hanya bisa di channel yang diizinkan (jika diatur). |
| `/dp <jumlah> <item> [kategori]` | Simpan item. Hanya bisa di channel yang diizinkan (jika diatur). |

### Live Stock (Approver)

| Perintah | Deskripsi |
|---|---|
| `/livestock channel <channel>` | Tempatkan papan Live Stock di channel. |
| `/livestock log <channel>` | Atur channel log transaksi. |
| `/livestock create category <nama> [emoji]` | Buat kategori baru. |
| `/livestock delete category <nama>` | Hapus kategori. |
| `/livestock item add <kategori> <nama> [jumlah]` | Tambah item ke kategori. |
| `/livestock item remove <kategori> <nama>` | Hapus item dari kategori. |
| `/livestock refresh` | Refresh tampilan papan. |
| `/livestock reset` | Reset semua jumlah stok ke 0 (dengan konfirmasi). |
| `/livestock history [user] [jumlah]` | Lihat riwayat transaksi terakhir. |

### Konfigurasi (Admin)

| Perintah | Deskripsi |
|---|---|
| `/config approver add <role>` | Tambah approver role baru untuk transaksi (maks 3). |
| `/config approver remove <role>` | Hapus approver role dari daftar. |
| `/config list-channel <channel>` | Atur channel untuk menampilkan embed Penanggung Jawab (PJ) yang ter-update otomatis. |
| `/config tutorial-setup` | Tampilkan panduan cara memakai `/role me` di channel itu. |
| `/config role-channel add <channel>` | Batasi perintah `/role me` hanya ke channel ini. |
| `/config role-channel remove <channel>` | Hapus pembatasan channel `/role me`. |
| `/config role-channel list` | Tampilkan daftar channel yang diizinkan untuk `/role me`. |
| `/config wd-channel add <channel>` | Batasi perintah `/wd` hanya ke channel ini. |
| `/config wd-channel remove <channel>` | Hapus pembatasan channel `/wd`. |
| `/config wd-channel list` | Tampilkan daftar channel yang diizinkan untuk `/wd`. |
| `/config dp-channel add <channel>` | Batasi perintah `/dp` hanya ke channel ini. |
| `/config dp-channel remove <channel>` | Hapus pembatasan channel `/dp`. |
| `/config dp-channel list` | Tampilkan daftar channel yang diizinkan untuk `/dp`. |
| `/config show` | Tampilkan seluruh konfigurasi server saat ini. |

---

Dibuat oleh Allan
