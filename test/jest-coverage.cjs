// eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest loads this file as CommonJS.
const { jest: unit } = require('../package.json');

module.exports = {
  ...unit,
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testRegex: ['\\.spec\\.ts$', '\\.e2e-spec\\.ts$'],
  collectCoverageFrom: [...unit.collectCoverageFrom, 'migrations/**/*.ts'],
  coverageReporters: ['text-summary', 'lcov'],
};
