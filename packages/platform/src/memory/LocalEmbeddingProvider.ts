import type { EmbeddingProvider } from '@agentoak/runtime'
import { cosineSimilarity } from '@agentoak/runtime'

/**
 * ADR-0069 — on-device embedding provider.
 *
 * Produces sentence embeddings in-process via ONNX Runtime (Transformers.js),
 * so semantic search / cache / RAG run offline with no external services. The
 * model is pinned and loaded lazily on first use; `@huggingface/transformers`
 * is an optional runtime dependency imported dynamically (the same pattern used
 * by `openBetterSqlite3` in `@agentoak/sqlite-adapter`) so the library is only
 * required on deployments that actually run local embeddings.
 *
 * `similarity()` delegates to the shared `cosineSimilarity` primitive, so the
 * ranking is identical to every other adapter (local/cloud parity).
 */
export interface LocalEmbeddingOptions {
  /** Pinned model id. Defaults to a small, INT8-friendly English model. */
  model?: string
  /** Pool strategy passed to the feature-extraction pipeline. */
  pooling?: 'mean' | 'cls'
  /** Whether to L2-normalise the output vectors. */
  normalize?: boolean
}

/** Minimal structural type for the Transformers.js feature-extraction output. */
interface FeatureTensor {
  tolist(): number[][]
}
type FeatureExtractor = (
  input: string[],
  options: { pooling: 'mean' | 'cls'; normalize: boolean },
) => Promise<FeatureTensor>
type TransformersModule = {
  pipeline: (task: string, model: string) => Promise<FeatureExtractor>
}

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5'

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private readonly model: string
  private readonly pooling: 'mean' | 'cls'
  private readonly normalize: boolean
  private extractor: Promise<FeatureExtractor> | null = null

  constructor(options: LocalEmbeddingOptions = {}) {
    this.model = options.model ?? DEFAULT_LOCAL_EMBEDDING_MODEL
    this.pooling = options.pooling ?? 'mean'
    this.normalize = options.normalize ?? true
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []
    const extractor = await this.load()
    const output = await extractor(texts, { pooling: this.pooling, normalize: this.normalize })
    return output.tolist()
  }

  similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b)
  }

  private load(): Promise<FeatureExtractor> {
    if (!this.extractor) {
      this.extractor = this.createExtractor()
    }
    return this.extractor
  }

  private async createExtractor(): Promise<FeatureExtractor> {
    let mod: TransformersModule
    try {
      mod = await import('@huggingface/transformers' as string) as TransformersModule
    } catch {
      throw new Error(
        "LocalEmbeddingProvider requires the optional dependency '@huggingface/transformers'. "
        + "Install it to enable on-device embeddings (ADR-0069), or use a cloud EmbeddingProvider.",
      )
    }
    return mod.pipeline('feature-extraction', this.model)
  }
}

export default LocalEmbeddingProvider
