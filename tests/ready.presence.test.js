'use strict';

const { ActivityType } = require('discord.js');
const ready = require('../src/events/ready');

/**
 * Unit tests for the bot presence logic in src/events/ready.js.
 *
 * applyPresence sets client.user.setPresence with the configured activity/type/
 * status, and rotates when more than one activity is configured.
 */

function makeClient() {
  return { user: { setPresence: jest.fn() } };
}

describe('getPresenceConfig', () => {
  it('uses defaults when env is empty', () => {
    const cfg = ready.getPresenceConfig({});
    expect(cfg.activities.length).toBeGreaterThan(0);
    expect(cfg.type).toBe(ActivityType.Playing);
    expect(cfg.status).toBe('online');
    expect(cfg.rotateMs).toBe(30000);
  });

  it('parses a pipe-separated activity list and known type/status', () => {
    const cfg = ready.getPresenceConfig({
      BOT_ACTIVITY: 'A | B | C',
      BOT_ACTIVITY_TYPE: 'Watching',
      BOT_STATUS: 'dnd',
      BOT_ACTIVITY_ROTATE_MS: '45000',
    });
    expect(cfg.activities).toEqual(['A', 'B', 'C']);
    expect(cfg.type).toBe(ActivityType.Watching);
    expect(cfg.status).toBe('dnd');
    expect(cfg.rotateMs).toBe(45000);
  });

  it('clamps the rotation interval to the minimum', () => {
    const cfg = ready.getPresenceConfig({ BOT_ACTIVITY: 'A|B', BOT_ACTIVITY_ROTATE_MS: '1000' });
    expect(cfg.rotateMs).toBe(15000);
  });

  it('falls back to defaults for unknown type/status', () => {
    const cfg = ready.getPresenceConfig({ BOT_ACTIVITY_TYPE: 'Nope', BOT_STATUS: 'weird' });
    expect(cfg.type).toBe(ActivityType.Playing);
    expect(cfg.status).toBe('online');
  });
});

describe('applyPresence', () => {
  it('sets a single presence and does not start a timer for one activity', () => {
    const client = makeClient();
    const timer = ready.applyPresence(client, { BOT_ACTIVITY: 'Solo', BOT_ACTIVITY_TYPE: 'Playing' });

    expect(client.user.setPresence).toHaveBeenCalledTimes(1);
    const arg = client.user.setPresence.mock.calls[0][0];
    expect(arg.activities[0]).toEqual({ name: 'Solo', type: ActivityType.Playing });
    expect(arg.status).toBe('online');
    expect(timer).toBeNull();
  });

  it('rotates through multiple activities on the timer', () => {
    jest.useFakeTimers();
    try {
      const client = makeClient();
      const timer = ready.applyPresence(client, {
        BOT_ACTIVITY: 'One|Two',
        BOT_ACTIVITY_ROTATE_MS: '15000',
      });

      // First activity applied immediately.
      expect(client.user.setPresence).toHaveBeenCalledTimes(1);
      expect(client.user.setPresence.mock.calls[0][0].activities[0].name).toBe('One');

      jest.advanceTimersByTime(15000);
      expect(client.user.setPresence).toHaveBeenCalledTimes(2);
      expect(client.user.setPresence.mock.calls[1][0].activities[0].name).toBe('Two');

      jest.advanceTimersByTime(15000);
      expect(client.user.setPresence.mock.calls[2][0].activities[0].name).toBe('One');

      clearInterval(timer);
    } finally {
      jest.useRealTimers();
    }
  });

  it('is a no-op when the client has no user', () => {
    const timer = ready.applyPresence({}, { BOT_ACTIVITY: 'X' });
    expect(timer).toBeNull();
  });
});
