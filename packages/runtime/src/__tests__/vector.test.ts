import { describe, expect, it } from 'vitest'
import { bruteKnnSearch, cosineSimilarity } from '../index.js'

describe('cosineSimilarity', () => {
  it('returns 1 for identical direction and 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })

  it('returns 0 for mismatched lengths or zero vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0)
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0)
  })
})

describe('bruteKnnSearch', () => {
  const items = [
    { id: 'far', v: [0, 0, 1] },
    { id: 'near', v: [1, 0, 0] },
    { id: 'mid', v: [0.8, 0.6, 0] },
  ]

  it('orders candidates by descending cosine similarity', () => {
    const result = bruteKnnSearch(items, [1, 0, 0], item => item.v)
    expect(result.map(match => match.item.id)).toEqual(['near', 'mid', 'far'])
  })

  it('honours the limit', () => {
    const result = bruteKnnSearch(items, [1, 0, 0], item => item.v, 2)
    expect(result.map(match => match.item.id)).toEqual(['near', 'mid'])
  })

  it('skips candidates with missing or mismatched embeddings', () => {
    const mixed = [{ id: 'a', v: [1, 0, 0] }, { id: 'b', v: undefined }, { id: 'c', v: [1, 0] }]
    const result = bruteKnnSearch(mixed, [1, 0, 0], item => item.v)
    expect(result.map(match => match.item.id)).toEqual(['a'])
  })

  it('breaks ties deterministically by input order', () => {
    const tied = [{ id: 'first', v: [1, 0, 0] }, { id: 'second', v: [1, 0, 0] }]
    const result = bruteKnnSearch(tied, [1, 0, 0], item => item.v)
    expect(result.map(match => match.item.id)).toEqual(['first', 'second'])
  })
})
