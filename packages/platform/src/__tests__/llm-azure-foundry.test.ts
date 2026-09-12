import { describe, expect, it } from 'vitest'
import { isAzureFoundryEndpoint } from '../llm.js'

describe('isAzureFoundryEndpoint', () => {
  it('returns false for classic Azure OpenAI endpoints (.openai.azure.com)', () => {
    expect(isAzureFoundryEndpoint('https://myresource.openai.azure.com')).toBe(false)
    expect(isAzureFoundryEndpoint('https://myresource.openai.azure.com/')).toBe(false)
    expect(isAzureFoundryEndpoint('https://myresource.openai.azure.com/openai/v1')).toBe(false)
    expect(isAzureFoundryEndpoint('https://myresource.openai.azure.com/openai/deployments/gpt-4')).toBe(false)
  })

  it('returns true for AI Foundry endpoints (.services.ai.azure.com)', () => {
    expect(isAzureFoundryEndpoint('https://wppgenai.services.ai.azure.com')).toBe(true)
    expect(isAzureFoundryEndpoint('https://wppgenai.services.ai.azure.com/')).toBe(true)
    expect(isAzureFoundryEndpoint('https://wppgenai.services.ai.azure.com/openai/v1/responses')).toBe(true)
    expect(isAzureFoundryEndpoint('https://wppgenai.services.ai.azure.com/openai/v1')).toBe(true)
  })

  it('returns true for other .ai.azure.com subdomains (not .openai.azure.com)', () => {
    expect(isAzureFoundryEndpoint('https://myresource.ai.azure.com')).toBe(true)
    expect(isAzureFoundryEndpoint('https://myresource.ai.azure.com/openai/v1')).toBe(true)
  })

  it('returns false for non-Azure endpoints', () => {
    expect(isAzureFoundryEndpoint('https://api.openai.com')).toBe(false)
    expect(isAzureFoundryEndpoint('https://example.com')).toBe(false)
    expect(isAzureFoundryEndpoint('')).toBe(false)
  })

  it('strips /openai/* path suffixes before checking', () => {
    expect(isAzureFoundryEndpoint('https://wppgenai.services.ai.azure.com/openai/v1/chat/completions')).toBe(true)
    expect(isAzureFoundryEndpoint('https://myresource.openai.azure.com/openai/deployments/gpt-4/chat/completions')).toBe(false)
  })
})
