/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js', '**/?(*.)+(spec|test).js'],
  // mongodb-memory-server can take time to download/start the binary on first run.
  testTimeout: 30000,
  clearMocks: true,
};
