/**
 * @deprecated Use `llm-response-cache.ts` instead. This module is kept as a
 * thin re-export for backward compatibility. The old name "SemanticCache" was
 * misleading — this is an exact-match hash cache, not a semantic (embedding-
 * based) cache. The new name `LlmResponseCache` is honest about this.
 *
 * This file will be removed in a future release.
 */

export {
  LlmResponseCache as SemanticCache,
  type LlmCacheEntry as SemanticCacheEntry,
  type LlmCacheStore as SemanticCacheStore,
} from './llm-response-cache.js'
