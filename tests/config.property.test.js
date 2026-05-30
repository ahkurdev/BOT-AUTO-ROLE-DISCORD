'use strict';

const fc = require('fast-check');
const { validateConfig } = require('../src/config/index');

const REQUIRED_ENV_VARS = ['DISCORD_TOKEN', 'MONGODB_URI', 'GUILD_ID'];

// A value is "present and valid" only when it is a non-empty,
// non-whitespace-only string. Model the four interesting states a required
// variable can be in within an env object:
//   - absent:     the key is omitted entirely
//   - empty:      the key maps to ""
//   - whitespace: the key maps to a string of only spaces/tabs/newlines
//   - valid:      the key maps to a string with at least one non-whitespace char
const whitespaceArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r', '\f', '\v'), {
    minLength: 1,
    maxLength: 6,
  })
  .map((chars) => chars.join(''));

// A valid value: contains at least one non-whitespace character, possibly with
// surrounding whitespace so we exercise trimming without becoming "missing".
const validValueArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => s.trim() !== '');

const varStateArb = fc.oneof(
  fc.record({ kind: fc.constant('absent') }),
  fc.record({ kind: fc.constant('empty'), value: fc.constant('') }),
  fc.record({ kind: fc.constant('whitespace'), value: whitespaceArb }),
  fc.record({ kind: fc.constant('valid'), value: validValueArb })
);

// Extra unrelated keys that must never influence the result. Constrain key
// names so they cannot collide with the required variable names.
const extraKeyArb = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((k) => !REQUIRED_ENV_VARS.includes(k));

const extraKeysArb = fc.dictionary(extraKeyArb, fc.string({ maxLength: 20 }), {
  maxKeys: 5,
});

// Build an env object plus the independently-computed expected missing set.
const envArb = fc
  .tuple(
    varStateArb, // DISCORD_TOKEN
    varStateArb, // MONGODB_URI
    varStateArb, // GUILD_ID
    extraKeysArb
  )
  .map(([tokenState, uriState, guildState, extras]) => {
    const env = { ...extras };
    const states = {
      DISCORD_TOKEN: tokenState,
      MONGODB_URI: uriState,
      GUILD_ID: guildState,
    };

    const expectedMissing = [];
    for (const name of REQUIRED_ENV_VARS) {
      const state = states[name];
      if (state.kind === 'absent') {
        expectedMissing.push(name);
      } else {
        env[name] = state.value;
        if (state.value.trim() === '') {
          expectedMissing.push(name);
        }
      }
    }

    return { env, expectedMissing };
  });

describe('Feature: discord-self-role-bot, Property 8: Configuration validation identifies exactly the missing variables', () => {
  test('validateConfig is valid iff all required vars are present and non-empty, and missing lists exactly the absent/empty ones (Validates: Requirements 8.3)', () => {
    fc.assert(
      fc.property(envArb, ({ env, expectedMissing }) => {
        const { valid, missing } = validateConfig(env);

        // valid is true iff there are no missing required variables.
        expect(valid).toBe(expectedMissing.length === 0);

        // missing must contain exactly the expected variables — no more, no
        // fewer — compared order-insensitively.
        expect([...missing].sort()).toEqual([...expectedMissing].sort());

        // missing only ever contains required variable names (never extras).
        for (const name of missing) {
          expect(REQUIRED_ENV_VARS).toContain(name);
        }

        // No duplicates in the missing list.
        expect(new Set(missing).size).toBe(missing.length);
      }),
      { numRuns: 200 }
    );
  });
});
