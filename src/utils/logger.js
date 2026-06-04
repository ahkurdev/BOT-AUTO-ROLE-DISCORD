'use strict';

/**
 * Lightweight structured logger wrapping `console`.
 *
 * Provides levelled output (debug / info / warn / error) with ISO-8601
 * timestamps and optional key=value context. No external dependencies.
 *
 * The active level is controlled by the `LOG_LEVEL` environment variable
 * (default: `info`). Set to `debug` for verbose output during development.
 */

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel =
  LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LOG_LEVELS.info;

/** @returns {string} ISO-8601 timestamp */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Render a context object as ` key=value key2=value2`.
 * @param {Record<string, unknown>} ctx
 * @returns {string}
 */
function formatContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return '';
  const pairs = Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
  return pairs.length > 0 ? ' ' + pairs.join(' ') : '';
}

/**
 * Core log function.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 * @param {Record<string, unknown>} [context]
 */
function log(level, message, context) {
  if ((LOG_LEVELS[level] ?? 0) < currentLevel) return;
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${message}${formatContext(context)}`;
  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      console.log(line);
  }
}

module.exports = {
  debug: (msg, ctx) => log('debug', msg, ctx),
  info: (msg, ctx) => log('info', msg, ctx),
  warn: (msg, ctx) => log('warn', msg, ctx),
  error: (msg, ctx) => log('error', msg, ctx),
};
