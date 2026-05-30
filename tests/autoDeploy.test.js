'use strict';

/**
 * Unit tests for autoDeployCommands in index.js.
 *
 * It should register commands on startup by default, skip when the
 * AUTO_DEPLOY_COMMANDS flag is disabled, and never throw when deploy fails
 * (best-effort).
 */

jest.mock('../deploy-commands', () => ({
  deploy: jest.fn(),
}));

const { deploy } = require('../deploy-commands');
const { autoDeployCommands } = require('../index');

describe('autoDeployCommands', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deploys by default when the flag is unset', async () => {
    deploy.mockResolvedValue([{}, {}, {}, {}]);
    await autoDeployCommands({});
    expect(deploy).toHaveBeenCalledTimes(1);
    expect(deploy).toHaveBeenCalledWith({ env: {} });
  });

  it('deploys when the flag is "true"', async () => {
    deploy.mockResolvedValue([]);
    await autoDeployCommands({ AUTO_DEPLOY_COMMANDS: 'true' });
    expect(deploy).toHaveBeenCalledTimes(1);
  });

  it.each(['false', '0', 'no', 'off', 'FALSE', 'Off'])(
    'skips deploy when the flag is %p',
    async (flag) => {
      await autoDeployCommands({ AUTO_DEPLOY_COMMANDS: flag });
      expect(deploy).not.toHaveBeenCalled();
    },
  );

  it('never throws when deploy rejects (best-effort)', async () => {
    deploy.mockRejectedValue(new Error('bad CLIENT_ID'));
    await expect(autoDeployCommands({})).resolves.toBeUndefined();
  });
});
