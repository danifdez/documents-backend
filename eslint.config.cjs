const tsPlugin = require('@typescript-eslint/eslint-plugin');
const globals = require('globals');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  ...tsPlugin.configs['flat/recommended'],
  prettierRecommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'max-len': ['warn', { code: 100 }],
    },
  },
];
