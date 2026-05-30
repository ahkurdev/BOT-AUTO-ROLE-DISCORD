# Bot Shellby

Bot Discord serbaguna untuk **self-role**, **manajemen stok (withdraw/deposit)** dengan papan **Live Stock** real-time, dan alur **persetujuan role** opsional. Dibangun dengan Node.js + discord.js v14, data tersimpan per-guild di MongoDB.

## Fitur

- **Self-role** — anggota mengambil/melepas role sendiri lewat menu (`/role me`); approver mengelola daftar role.
- **Approval role (opsional)** — permintaan role dikirim ke channel approval dengan tombol Accept/Reject.
- **Withdraw / Deposit** — `/wd` dan `/dp` untuk semua anggota, dengan pencocokan kategori otomatis.
- **Live Stock board** — papan stok yang otomatis diperbarui setiap transaksi, angka diformat dengan pemisah ribuan (mis. `14.894.829`).
- **Log transaksi** — setiap withdraw/deposit dapat dicatat ke channel log.
- **Pembatasan channel** — `/wd` dan `/dp` dapat dikunci ke channel tertentu.
- **Presence** — status bot ("Playing/Watching ...") yang dapat dirotasi.
- **Auto-deploy** — slash command otomatis terdaftar saat bot start.

## Persyaratan

- Node.js 18+
- MongoDB (lokal atau Atlas)
- Aplikasi bot di [Discord Developer Portal](https://discord.com/developers/applications)
  - **Server Members Intent** harus diaktifkan (Bot → Privileged Gateway Intents).
  - Bot diundang dengan scope `bot` dan `applications.commands`, serta permission **Manage Roles**.

## Instalasi

```bash
git clone https://github.com/Allan4u/bot-shellby.git
cd bot-shellby
npm install
```

## Konfigurasi

Salin `.env.example` menjadi `.env` lalu isi nilainya:

```bash
cp .env.example .env
```

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DISCORD_TOKEN` | ya | Token bot dari Developer Portal. |
| `CLIENT_ID` | ya | Application (client) ID — dipakai untuk registrasi command. |
| `GUILD_ID` | ya | ID server tempat command didaftarkan. |
| `MONGODB_URI` | ya | Connection string MongoDB. |
| `APPROVAL_CHANNEL_ID` | tidak | Channel permintaan approval role (aktifkan mode approval bersama `APPROVER_ROLE_ID`). |
| `APPROVER_ROLE_ID` | tidak | Role yang boleh menyetujui/menolak & mengelola stok. |
| `DNS_SERVERS` | tidak | DNS server untuk Node (mis. `8.8.8.8,1.1.1.1`) bila `mongodb+srv://` gagal resolve. |
| `BOT_ACTIVITY` | tidak | Teks status; beberapa teks dipisah `\|` akan dirotasi. |
| `BOT_ACTIVITY_TYPE` | tidak | `Playing` \| `Watching` \| `Listening` \| `Competing` (default `Playing`). |
| `BOT_STATUS` | tidak | `online` \| `idle` \| `dnd` \| `invisible` (default `online`). |
| `BOT_ACTIVITY_ROTATE_MS` | tidak | Interval rotasi status (min 15000, default 30000). |
| `AUTO_DEPLOY_COMMANDS` | tidak | Daftarkan command otomatis saat start (default `true`; set `false` untuk manual). |

> **Keamanan:** jangan commit file `.env`. File ini sudah masuk `.gitignore`.

## Menjalankan

```bash
# daftarkan slash command secara manual (opsional bila AUTO_DEPLOY_COMMANDS=true)
npm run deploy

# jalankan bot
npm start

# jalankan test
npm test
```

Saat start, bot akan: validasi konfigurasi → (opsional) daftarkan command → konek MongoDB → login Discord.

## Daftar Perintah

### Self-Role
| Perintah | Akses | Keterangan |
|---|---|---|
| `/role me` | Semua | Buka menu untuk ambil/lepas role sendiri. |
| `/role add <role>` | Approver | Tambah role ke daftar self-role. |
| `/role remove <role>` | Approver | Hapus role dari daftar. |
| `/role list` | Approver | Lihat daftar role yang tersedia. |

Bila mode approval aktif, memilih role di `/role me` akan mengirim permintaan ke channel approval; role baru diberikan setelah approver menekan **Accept**.

### Stock (semua anggota)
| Perintah | Keterangan |
|---|---|
| `/wd <jumlah> <item> [kategori]` | Tarik item dari stok. Kategori otomatis dicari; sebutkan hanya bila nama item ada di beberapa kategori. |
| `/dp <jumlah> <item> [kategori]` | Setor item. Item baru dibuat di kategori yang disebut; kategori baru otomatis dibuat bila belum ada. Item yang sudah ada cukup tanpa kategori. |

Contoh:
- `/wd 200 Drill`
- `/dp 200 Nail Gun Alat Rampok`
- `/dp 50 Drill`

### Live Stock (approver)
| Perintah | Keterangan |
|---|---|
| `/livestock channel <channel>` | Pasang papan Live Stock di channel. |
| `/livestock log <channel>` | Set channel log transaksi. |
| `/livestock setwd <channel>` | Batasi `/wd` hanya di channel itu. |
| `/livestock setdp <channel>` | Batasi `/dp` hanya di channel itu. |
| `/livestock create category <nama> [emoji]` | Buat kategori baru. |
| `/livestock delete category <nama>` | Hapus kategori. |
| `/livestock item add <kategori> <nama> [jumlah]` | Tambah item ke kategori. |
| `/livestock item remove <kategori> <nama>` | Hapus item dari kategori. |
| `/livestock refresh` | Perbarui tampilan papan. |

### Lain-lain
| Perintah | Akses | Keterangan |
|---|---|---|
| `/help` | Semua | Tampilkan panduan perintah. |

## Struktur Proyek

```
index.js              Entry point (config → deploy → Mongo → login)
deploy-commands.js    Registrasi slash command ke guild
src/
  commands/           Definisi & handler command (role, stock, help)
  events/             ready (presence) & interactionCreate (router)
  models/             Model + repository Mongoose (GuildRoles, GuildStock)
  utils/              Logika murni & embed builder
tests/                Unit & property-based test (Jest + fast-check)
```

## Pengujian

Proyek memakai Jest dengan property-based testing (fast-check) dan `mongodb-memory-server` untuk test repository.

```bash
npm test
```

## Deployment (Wispbyte / Pterodactyl)

1. Set environment variable di panel (sama seperti `.env`, karena `.env` tidak ikut repo).
2. Pastikan **Server Members Intent** aktif dan IP server di-whitelist di MongoDB Atlas (Network Access).
3. Startup command: `node index.js`. Command akan otomatis terdaftar (`AUTO_DEPLOY_COMMANDS=true`).

## Catatan Keamanan

- Jangan pernah membagikan `DISCORD_TOKEN` atau `MONGODB_URI`. Bila pernah terekspos, rotasi token bot dan ganti password database.
- Untuk hosting dengan IP dinamis, whitelist Atlas `0.0.0.0/0` mempermudah koneksi tetapi mengurangi lapisan keamanan — pastikan kredensial database kuat.

## Lisensi

MIT

---

Created by Allan
