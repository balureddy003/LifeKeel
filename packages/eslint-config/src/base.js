import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export const base = tseslint.config(
  {
    name: 'lifekeel/ignores',
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/out/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/*.cjs',
      'scripts/*.py',
    ],
  },
  {
    name: 'lifekeel/globals',
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'lifekeel/rules',
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
)

export default base
