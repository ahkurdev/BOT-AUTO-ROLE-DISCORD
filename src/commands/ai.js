'use strict';

/**
 * `/ai` command — chat santai dengan AI (Zen + OpenRouter, model gratis).
 *
 *   /ai chat <pesan> [model] — ngobrol dengan AI (ephemeral, anti-spam channel)
 *   /ai models                — lihat daftar model gratis yang dipakai
 *
 * Bukan untuk coding: permintaan coding ditolak sebelum request keluar
 * (lihat isCodingRequest di utils/aiChat) dan system prompt melarang model
 * membantu coding sebagai lapis kedua.
 */

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');

const {
  ZEN_FREE_MODELS,
  chatWithAI,
  isAiConfigured,
  getOpenRouterFreeModels,
} = require('../utils/aiChat');
const { COLORS, applyBranding, replyEphemeral } = require('../utils/shared');

const MODEL_CHOICES = [
  { name: 'Auto (coba semua)', value: 'auto' },
  ...ZEN_FREE_MODELS.map((m) => ({ name: `zen: ${m}`, value: m })),
  { name: 'or: llama-3.3-70b (free)', value: 'meta-llama/llama-3.3-70b-instruct:free' },
  { name: 'or: gemma-3-27b (free)', value: 'google/gemma-3-27b-it:free' },
  { name: 'or: qwen3-235b (free)', value: 'qwen/qwen3-235b-a22b:free' },
  { name: 'or: deepseek-r1 (free)', value: 'deepseek/deepseek-r1:free' },
];

const data = new SlashCommandBuilder()
  .setName('ai')
  .setDescription('Ngobrol santai dengan AI (bukan untuk coding)')
  .addSubcommand((sub) =>
    sub
      .setName('chat')
      .setDescription('Kirim pesan ke AI')
      .addStringOption((opt) =>
        opt.setName('pesan').setDescription('Pesan buat AI').setRequired(true).setMaxLength(1000),
      )
      .addStringOption((opt) =>
        opt
          .setName('model')
          .setDescription('Model (default: auto)')
          .setRequired(false)
          .addChoices(...MODEL_CHOICES),
      ),
  )
  .addSubcommand((sub) => sub.setName('models').setDescription('Lihat daftar model AI gratis'));

/**
 * Handle /ai chat. Deferred ephemeral reply karena request AI bisa lambat.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleAiChat(interaction) {
  if (!isAiConfigured()) {
    return replyEphemeral(
      interaction,
      applyBranding(
        new EmbedBuilder()
          .setColor(COLORS.error)
          .setTitle('AI belum dikonfigurasi')
          .setDescription('API key AI kosong. Hubungi admin server.'),
      ),
    );
  }

  const pesan = interaction.options.getString('pesan', true);
  const model = interaction.options.getString('model') || 'auto';

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await chatWithAI(pesan, { preferredModel: model });

  const embed = applyBranding(new EmbedBuilder().setColor(result.ok ? COLORS.info : COLORS.error));
  if (result.ok) {
    embed.setTitle('AI Chat').setDescription(result.text);
    if (result.model) {
      embed.setFooter({ text: `${result.provider}/${result.model} • Created by Allan` });
    }
  } else {
    embed.setTitle('AI sibuk').setDescription(result.text);
  }

  try {
    return await interaction.editReply({ embeds: [embed] });
  } catch (_e) {
    return undefined;
  }
}

/**
 * Handle /ai models.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleAiModels(interaction) {
  let orModels = [];
  try {
    orModels = await getOpenRouterFreeModels(process.env.OPENROUTER_API_KEY || undefined);
  } catch (_e) {
    orModels = [];
  }

  const desc =
    '**Zen (gratis):**\n' +
    ZEN_FREE_MODELS.map((m) => `• \`${m}\``).join('\n') +
    '\n\n**OpenRouter (gratis, bisa berubah):**\n' +
    (orModels.length > 0 ? orModels.map((m) => `• \`${m}\``).join('\n') : '_tidak bisa diambil saat ini_') +
    '\n\nCatatan: AI ini tidak melayani coding.';

  return replyEphemeral(
    interaction,
    applyBranding(new EmbedBuilder().setColor(COLORS.info).setTitle('Model AI Gratis').setDescription(desc)),
  );
}

module.exports = { data, handleAiChat, handleAiModels };
