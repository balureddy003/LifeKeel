import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCAL_EMBEDDING_MODEL, LocalEmbeddingProvider } from '../memory/LocalEmbeddingProvider.js'

describe('LocalEmbeddingProvider', () => {
  it('exposes a pinned default model', () => {
    expect(DEFAULT_LOCAL_EMBEDDING_MODEL).toBe('Xenova/bge-small-en-v1.5')
  })

  it('computes cosine similarity via the shared primitive', () => {
    const provider = new LocalEmbeddingProvider()
    expect(provider.similarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
    expect(provider.similarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })

  it('returns an empty result without loading a model for empty input', async () => {
    const provider = new LocalEmbeddingProvider()
    await expect(provider.embed([])).resolves.toEqual([])
  })

  it('fails clearly when the optional transformers dependency is absent', async () => {
    const provider = new LocalEmbeddingProvider({ model: 'definitely-not-installed-model' })
    await expect(provider.embed(['hello'])).rejects.toThrow(/@huggingface\/transformers/)
  })
})
