module.exports = {
  testEnvironment: "node",
  testTimeout: 30000,
  setupFiles: ["<rootDir>/jest.setup.js"],
  globalTeardown: "<rootDir>/jest.teardown.js",
};
