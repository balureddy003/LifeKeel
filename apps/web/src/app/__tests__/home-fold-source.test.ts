/**
 * A new household used to see every empty card on home (Health, Life Timeline, "One option to
 * consider") stacked into a page about 3,200px tall, because the fold only applied once the account
 * had data. Home reads the fold from source here: jsdom cannot lay the whole page out.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const page = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

describe('home page fold (source)', () => {
  it('folds the secondary sections for every account, not only ones with data', () => {
    expect(page).not.toMatch(/<MoreOnHome\s+fold=\{hasLiveData\}/)
    expect(page).toMatch(/<MoreOnHome[^>]*\bfold\b/)
  })

  it('tells a new account what is inside the fold', () => {
    expect(page).toMatch(/<MoreOnHome[^>]*hint/)
  })
})
