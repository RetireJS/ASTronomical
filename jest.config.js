module.exports = {
  transform: {
    '^.+\\.ts?$': [
      'ts-jest',
      { tsconfig: 'tsconfig.esm.json' }
    ],
  },
  testEnvironment: 'node',
  testRegex: '/tests/.*\\.(test|spec)?\\.(ts|tsx)$',
  moduleFileExtensions: ['ts', 'js' ],
};