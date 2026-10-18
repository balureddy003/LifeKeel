import importPlugin from 'eslint-plugin-import'
import { base } from './base.js'

export const node = [
  ...base,
  importPlugin.flatConfigs.recommended,
  {
    name: 'lifekeel/import-rules',
    rules: {
      'import/default': 'off',
      'import/named': 'off',
      'import/no-unresolved': 'off',
      'import/order': 'off',
    },
  },
]

export default node
