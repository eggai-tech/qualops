import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import eslintPluginImport from 'eslint-plugin-import';

export default [
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.qualops/**'],
  },
  ...tseslint.configs.recommended,
  eslintPluginImport.flatConfigs.recommended,
  eslintPluginImport.flatConfigs.typescript,
  prettier,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: [
          './tsconfig.lib.json',
          './tsconfig.spec.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Import order
      'import/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
          ],
          alphabetize: { order: 'asc' },
          'newlines-between': 'always',
        },
      ],
    },
    "settings": {
      "import/resolver": {
        "typescript": {}
      }
    },
  }
];
