import tsPlugin from '@typescript-eslint/eslint-plugin';
import globals from 'globals';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default [
  ...tsPlugin.configs['flat/recommended'],
  prettierRecommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
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
      'max-len': [
        'warn',
        {
          code: 100,
          // Module specifiers cannot be wrapped without path aliases.
          ignorePattern: String.raw`^import\s.+from\s.+;$`,
        },
      ],
    },
  },
];
