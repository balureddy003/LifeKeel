import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'
import { base } from './base.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
})

export const next = [
  ...base,
  ...compat.extends('next/core-web-vitals'),
  {
    name: 'lifekeel/next-rules',
    rules: {
      'react/no-unescaped-entities': 'off',
    },
  },
]

export default next
