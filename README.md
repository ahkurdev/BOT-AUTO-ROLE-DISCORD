Bahasa Indonesia version: [readme.id.md](readme.id.md)

# Bot Shellby

A versatile Discord bot for **self-role & Person in Charge (PJ)**, **stock management (withdraw/deposit)** with a real-time **Live Stock** board. Built with Node.js + discord.js v14, with data stored per-guild in MongoDB.

## Features

- **Self-role & Person in Charge** — Members take/remove roles themselves via a menu while also assigning their person in charge via `/role me pj:@User`. The role ownership and PJ lists are automatically managed in a public embed.
- **Channel restrictions** — `/role me`, `/wd`, and `/dp` can be restricted to specific channels via configuration.
- **Auto-delete plain messages** — Plain text messages in command-specific channels (role me, wd, dp) are **automatically deleted** and the sender is given a temporary warning (8 seconds) before it is cleanly deleted again without emoji (tutorial messages are excluded).
- **Withdraw / Deposit** — `/wd` and `/dp` for all members, with automatic category matching.
- **Live Stock board** — A stock board that updates automatically with every transaction, numbers formatted with thousand separators (e.g. `14.894.829`).
- **Transaction log** — Every withdraw/deposit can be recorded to a log channel and stored in the database (auto-deleted after 90 days).
- **Presence** — Rotatable bot status ("Playing/Watching ...").
- **Auto-deploy** — Slash commands are automatically registered when the bot starts.
- **Rate limiting** — Anti-spam per user per command (3-5 second cooldown).
- **Per-guild configuration** — Approver role, PJ channel list, tutorial channel, and channel restrictions are set per server via `/config`.
- **Graceful shutdown** — MongoDB and Discord connections are closed cleanly when the bot is stopped.

## Requirements

- Node.js 18+
- MongoDB (local or Atlas)
- A bot application in the [Discord Developer Portal](https://discord.com/developers/applications)
  - **Server Members Intent** and **Message Content Intent** must be enabled (Bot > Privileged Gateway Intents).
  - The bot is invited with the `bot` and `applications.commands` scopes, and the **Manage Roles** and **Manage Messages** permissions.

## Installation

```bash
git clone https://github.com/Allan4u/bot-shellby.git
cd bot-shellby
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token from the Developer Portal. |
| `CLIENT_ID` | yes | Application (client) ID — used for command registration. |
| `GUILD_ID` | yes | ID of the server where commands are registered. |
| `MONGODB_URI` | yes | MongoDB connection string. |
| `DNS_SERVERS` | no | DNS servers for Node (e.g. `8.8.8.8,1.1.1.1`) if `mongodb+srv://` fails to resolve. |
| `BOT_ACTIVITY` | no | Status text; multiple texts separated by `\|` will be rotated. |
| `BOT_ACTIVITY_TYPE` | no | `Playing` \| `Watching` \| `Listening` \| `Competing` (default `Playing`). |
| `BOT_STATUS` | no | `online` \| `idle` \| `dnd` \| `invisible` (default `online`). |
| `BOT_ACTIVITY_ROTATE_MS` | no | Status rotation interval (min 15000, default 30000). |
| `AUTO_DEPLOY_COMMANDS` | no | Register commands automatically on start (default `true`; set `false` for manual). |
| `LOG_LEVEL` | no | Log level: `debug` \| `info` \| `warn` \| `error` (default `info`). |

## Running

```bash
# Register slash commands manually
npm run deploy

# Run the bot
npm start

# Run tests
npm test
```

## Command List

### Self-Role & PJ

| Command | Access | Description |
|---|---|---|
| `/role me pj:@User` | Everyone | Open the menu to take/remove your own roles while tagging your person in charge. Only usable in allowed channels. |
| `/role add <role>` | Admin | Add a role to the self-role list. |
| `/role remove <role>` | Admin | Remove a role from the list. |
| `/role list` | Admin | View the list of available roles. |

### Stock (All Members)

| Command | Description |
|---|---|
| `/wd <amount> <item> [category]` | Withdraw an item from stock. Only usable in allowed channels (if set). |
| `/dp <amount> <item> [category]` | Deposit an item. Only usable in allowed channels (if set). |

### Live Stock (Approver)

| Command | Description |
|---|---|
| `/livestock channel <channel>` | Place the Live Stock board in a channel. |
| `/livestock log <channel>` | Set the transaction log channel. |
| `/livestock create category <name> [emoji]` | Create a new category. |
| `/livestock delete category <name>` | Delete a category. |
| `/livestock item add <category> <name> [amount]` | Add an item to a category. |
| `/livestock item remove <category> <name>` | Remove an item from a category. |
| `/livestock refresh` | Refresh the board display. |
| `/livestock reset` | Reset all stock amounts to 0 (with confirmation). |
| `/livestock history [user] [amount]` | View the latest transaction history. |

### Configuration (Admin)

| Command | Description |
|---|---|
| `/config approver add <role>` | Add a new approver role for transactions (max 3). |
| `/config approver remove <role>` | Remove an approver role from the list. |
| `/config list-channel <channel>` | Set the channel for displaying the Person in Charge (PJ) embed, which updates automatically. |
| `/config tutorial-setup` | Show a guide on how to use `/role me` in that channel. |
| `/config role-channel add <channel>` | Restrict the `/role me` command to this channel only. |
| `/config role-channel remove <channel>` | Remove the `/role me` channel restriction. |
| `/config role-channel list` | Show the list of allowed channels for `/role me`. |
| `/config wd-channel add <channel>` | Restrict the `/wd` command to this channel only. |
| `/config wd-channel remove <channel>` | Remove the `/wd` channel restriction. |
| `/config wd-channel list` | Show the list of allowed channels for `/wd`. |
| `/config dp-channel add <channel>` | Restrict the `/dp` command to this channel only. |
| `/config dp-channel remove <channel>` | Remove the `/dp` channel restriction. |
| `/config dp-channel list` | Show the list of allowed channels for `/dp`. |
| `/config show` | Show all current server configuration. |

---

Created by Allan
