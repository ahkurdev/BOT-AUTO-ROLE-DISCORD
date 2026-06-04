'use strict';

/**
 * In-memory sliding-window rate limiter.
 *
 * Tracks command usage per user and enforces cooldowns. Data is stored in
 * memory (Map) and is intentionally ephemeral — a bot restart clears all
 * cooldowns, which is acceptable for this use case.
 */

/** @type {Map<string, number>} key `userId:command` → last usage timestamp */
const usageMap = new Map();

/** Default cooldowns in milliseconds, keyed by command name. */
const DEFAULT_COOLDOWNS = {
  wd: 3000,
  dp: 3000,
  livestock: 5000,
  role: 2000,
  config: 5000,
};

// Periodic cleanup to prevent memory leaks from departed users.
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 60 * 1000;

let cleanupTimer = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of usageMap) {
      if (now - ts > MAX_AGE_MS) {
        usageMap.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }
}

/**
 * Check whether a user is rate-limited for a command.
 *
 * If not limited, the usage timestamp is recorded automatically so the
 * caller does not need a separate "consume" call.
 *
 * @param {string} userId
 * @param {string} commandName
 * @param {number} [cooldownMs] — override the default cooldown
 * @returns {{ limited: boolean, remainingMs: number }}
 */
function checkRateLimit(userId, commandName, cooldownMs) {
  startCleanup();
  const key = `${userId}:${commandName}`;
  const cooldown = cooldownMs ?? DEFAULT_COOLDOWNS[commandName] ?? 3000;
  const lastUsed = usageMap.get(key);
  const now = Date.now();

  if (lastUsed && now - lastUsed < cooldown) {
    return { limited: true, remainingMs: cooldown - (now - lastUsed) };
  }

  usageMap.set(key, now);
  return { limited: false, remainingMs: 0 };
}

/**
 * Reset all rate-limit state (useful for testing).
 */
function resetAll() {
  usageMap.clear();
}

module.exports = { checkRateLimit, resetAll, DEFAULT_COOLDOWNS };
