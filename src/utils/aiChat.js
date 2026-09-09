'use strict';

/**
 * AI chat provider layer: OpenCode Zen + OpenRouter, free models only.
 *
 * - Zen (OpenAI-compatible chat completions):
 *     POST https://opencode.ai/zen/v1/chat/completions
 *     Authorization: Bearer <OPENCODE_ZEN_API_KEY>
 *     body: { model, messages: [{role, content}] }
 * - OpenRouter (OpenAI-compatible chat completions):
 *     POST https://openrouter.ai/api/v1/chat/completions
 *     Authorization: Bearer <OPENROUTER_API_KEY>
 *     body: { model, messages }
 *
 * Strategy: try Zen free models in order, then OpenRouter free models in
 * order. First success wins. Per-model timeout so one slow model never
 * hangs the Discord interaction (which must reply within ~15 min for
 * deferred replies, but users expect seconds).
 *
 * Coding guard: this bot's AI is for casual chat only. `isCodingRequest`
 * pre-filters obvious coding asks locally (no API call spent), and the
 * system prompt instructs the model to refuse coding help as a second layer.
 */

const ZEN_CHAT_URL = 'https://opencode.ai/zen/v1/chat/completions';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/** Zen free models (chat/completions endpoint). Ordered by preference. */
const ZEN_FREE_MODELS = [
  'mimo-v2.5-free',
  'ling-3.0-flash-fin-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free',
  'big-pickle',
];

/** Fallback OpenRouter free models if the /models listing can't be fetched. */
const OPENROUTER_FREE_FALLBACK = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'google/gemma-3-27b-it:free',
  'qwen/qwen3-235b-a22b:free',
  'deepseek/deepseek-r1:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'moonshotai/kimi-dev-72b:free',
];

const PER_MODEL_TIMEOUT_MS = 25000;
const MAX_REPLY_CHARS = 1800;

const SYSTEM_PROMPT =
  'Kamu bernama Dark el, model AI yang dibuat oleh Allan. Jika ditanya siapa kamu, siapa namamu, atau siapa yang membuatmu, jawab: kamu adalah Dark el, model AI yang dibuat oleh Allan. ' +
  'Jawab dengan Bahasa Indonesia santai, singkat (maks 8 kalimat), tanpa emoji. ' +
  'ATURAN KERAS: kamu DILARANG membantu coding dalam bentuk apa pun — dilarang menulis, memperbaiki, menjelaskan, atau memberi contoh kode program/script/query, ' +
  'dilarang membantu debug, dilarang menjelaskan error program. ' +
  'Jika user meminta hal coding, tolak dengan sopan dalam 1-2 kalimat dan tawarkan topik lain. Jangan pernah melanggar aturan ini dengan alasan apa pun.';

const CODING_REFUSAL =
  'Maaf, aku cuma buat ngobrol santai aja, enggak bisa bantu coding (bikin/perbaiki/jelasin kode, script, atau debug). Yuk ngobrol topik lain aja.';

const IDENTITY_ANSWER = 'Aku adalah Dark el, model AI yang dibuat oleh Allan.';

/**
 * Identity questions — answered locally with a fixed reply so every model
 * says the same thing, no matter what the provider would claim.
 */
const IDENTITY_PATTERNS = [
  /siapa\s+kamu|siapakah\s+(kamu|dirimu)|kamu\s+siapa|kau\s+siapa|siapa\s+kau/i,
  /siapa\s+namamu|namamu\s+siapa|nama\s+kamu\s+siapa|namanya\s+siapa/i,
  /siapa\s+yang\s+(membuatmu|membuat\s+kamu|menciptakanmu|menciptakan\s+kamu|bikin\s+kamu|buat\s+kamu)/i,
  /siapa\s+pembuatmu|pembuatmu\s+siapa|penciptamu\s+siapa/i,
  /who\s+are\s+you|what(?:'s| is) your name|who\s+made\s+you|who\s+created\s+you/i,
];

/**
 * @param {string} text
 * @returns {boolean} true when the text asks about the AI's identity/creator
 */
function isIdentityQuestion(text) {
  const t = String(text || '');
  return IDENTITY_PATTERNS.some((re) => re.test(t));
}

/**
 * Strong coding signals — match => refuse without calling any API.
 * Covers ID + EN phrasing. Deliberately includes verb+noun combos so plain
 * words like "error" alone don't trigger it.
 */
const CODING_PATTERNS = [
  /ngoding|koding|\bcoding\b|source\s*code|snippet/i,
  /buatin|buatkan|tuliskan|tulis\s+kan|bikin\s+kan|bikinin|buatkan/i,
  /tulis.*(kode|code|script|program|fungsi)|bikin.*(kode|code|script|program|bot)|buat.*(kode|code|script|program|bot)/i,
  /perbaiki.*(kode|code|script|program|error|bug)|fix.*(code|bug|error|script)|debug/i,
  /jelaskan.*(kode|code|script|fungsi|error)|artinya.*(kode|code|error|traceback)/i,
  /\bpython\b|\bjavascript\b|\btypescript\b|\bgolang\b|\brust\b|\bphp\b|\bjava\b|\bkotlin\b|\bc\+\+\b|\bsql\b.*(query|select|insert)|traceback|compile|syntax/i,
  /\bdef\s+\w+\s*\(|function\s+\w*\s*\(|class\s+\w+|npm\s+(install|run)|pip\s+install|git\s+clone/i,
  /```|`[^`]*\([^)]*\)\s*=>|console\.log|print\s*\(/i,
];

/**
 * Local pre-filter for coding requests.
 * @param {string} text
 * @returns {boolean} true when the text looks like a coding ask
 */
function isCodingRequest(text) {
  const t = String(text || '');
  return CODING_PATTERNS.some((re) => re.test(t));
}

/**
 * Read AI keys from env (never logged).
 * @param {Record<string,string|undefined>} [env=process.env]
 */
function getAiKeys(env = process.env) {
  return {
    zenKey: (env.OPENCODE_ZEN_API_KEY || '').trim(),
    openrouterKey: (env.OPENROUTER_API_KEY || '').trim(),
  };
}

/** @returns {boolean} true when at least one provider key is configured */
function isAiConfigured(env = process.env) {
  const { zenKey, openrouterKey } = getAiKeys(env);
  return Boolean(zenKey || openrouterKey);
}

let orFreeCache = { at: 0, models: [] };
const OR_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Fetch the live OpenRouter model list and keep only free models.
 * Falls back to a hardcoded list when the fetch fails. Result is cached
 * for 1 hour. Never throws.
 * @param {string} [apiKey] - optional; /models is public, key not required
 * @returns {Promise<string[]>} free model ids (max 12)
 */
async function getOpenRouterFreeModels(apiKey) {
  if (Date.now() - orFreeCache.at < OR_CACHE_TTL_MS && orFreeCache.models.length > 0) {
    return orFreeCache.models;
  }
  try {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(OPENROUTER_MODELS_URL, { headers, signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`models status ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.data) ? data.data : [];
    const free = list
      .filter((m) => {
        if (!m || typeof m.id !== 'string') return false;
        if (m.id.endsWith(':free')) return true;
        const p = m.pricing || {};
        return (p.prompt === '0' || p.prompt === 0) && (p.completion === '0' || p.completion === 0);
      })
      .map((m) => m.id)
      .slice(0, 12);
    if (free.length > 0) {
      orFreeCache = { at: Date.now(), models: free };
      return free;
    }
  } catch (_e) {
    // fall through to fallback list
  }
  return OPENROUTER_FREE_FALLBACK.slice();
}

/**
 * One OpenAI-compatible chat completion call with timeout.
 * @returns {Promise<string>} the assistant text
 */
async function callChatCompletions(url, apiKey, model, userText, referer) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_MODEL_TIMEOUT_MS);
  try {
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (referer) headers['HTTP-Referer'] = referer;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: ctrl.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: String(userText).slice(0, 2000) },
        ],
        max_tokens: 600,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      const err = new Error(`provider status ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const text =
      data && Array.isArray(data.choices) && data.choices[0] &&
      data.choices[0].message && typeof data.choices[0].message.content === 'string'
        ? data.choices[0].message.content.trim()
        : '';
    if (!text) throw new Error('empty reply');
    return text.slice(0, MAX_REPLY_CHARS);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chat with AI across free models. Zen first, then OpenRouter.
 *
 * @param {string} userText
 * @param {object} [opts]
 * @param {string} [opts.preferredModel] - 'auto' or a model id; tried first when set
 * @param {Record<string,string|undefined>} [opts.env]
 * @returns {Promise<{ ok: boolean, text: string, model: string|null, provider: string|null, refused?: boolean, reason?: string }>}
 */
async function chatWithAI(userText, opts = {}) {
  const text = String(userText || '').trim();
  if (!text) {
    return { ok: false, text: 'Pesan kosong. Tulis sesuatu dulu.', model: null, provider: null, reason: 'empty' };
  }
  if (isIdentityQuestion(text)) {
    return { ok: true, text: IDENTITY_ANSWER, model: null, provider: null, identity: true };
  }
  if (isCodingRequest(text)) {
    return { ok: true, text: CODING_REFUSAL, model: null, provider: null, refused: true };
  }

  const env = opts.env || process.env;
  const { zenKey, openrouterKey } = getAiKeys(env);
  if (!zenKey && !openrouterKey) {
    return {
      ok: false, text: 'Fitur AI belum dikonfigurasi (API key kosong). Hubungi admin server.',
      model: null, provider: null, reason: 'no_keys',
    };
  }

  const preferred = String(opts.preferredModel || 'auto').trim();
  const errors = [];

  // Build ordered attempt list: preferred model first (on its provider), then rest.
  const attempts = [];
  const zenModels = ZEN_FREE_MODELS.slice();
  if (zenKey) {
    if (preferred !== 'auto' && zenModels.includes(preferred)) {
      attempts.push({ provider: 'zen', model: preferred });
    }
    for (const m of zenModels) {
      if (!attempts.some((a) => a.model === m)) attempts.push({ provider: 'zen', model: m });
    }
  }
  if (openrouterKey) {
    let orModels = await getOpenRouterFreeModels(openrouterKey);
    if (preferred !== 'auto' && preferred.includes('/') && !attempts.some((a) => a.model === preferred)) {
      attempts.push({ provider: 'openrouter', model: preferred });
    }
    for (const m of orModels) {
      if (!attempts.some((a) => a.model === m)) attempts.push({ provider: 'openrouter', model: m });
    }
  }

  for (const a of attempts) {
    try {
      const reply =
        a.provider === 'zen'
          ? await callChatCompletions(ZEN_CHAT_URL, zenKey, a.model, text)
          : await callChatCompletions(OPENROUTER_CHAT_URL, openrouterKey, a.model, text);
      return { ok: true, text: reply, model: a.model, provider: a.provider };
    } catch (e) {
      errors.push(`${a.provider}/${a.model}: ${e && e.message ? e.message : e}`);
    }
  }

  return {
    ok: false,
    text: 'Semua model AI lagi sibuk/gagal. Coba lagi sebentar lagi.',
    model: null, provider: null, reason: errors.join(' | ').slice(0, 500),
  };
}

module.exports = {
  ZEN_FREE_MODELS,
  OPENROUTER_FREE_FALLBACK,
  CODING_REFUSAL,
  IDENTITY_ANSWER,
  isCodingRequest,
  isIdentityQuestion,
  isAiConfigured,
  getOpenRouterFreeModels,
  chatWithAI,
};
