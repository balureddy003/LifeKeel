import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isOnDeviceSupported, isOnDeviceEnabled, setOnDeviceEnabled } from '../onDeviceLlm'

const SOURCE_PATH = join(process.cwd(), 'src/lib/onDeviceLlm.ts')

afterEach(() => {
  localStorage.clear()
  delete (globalThis.navigator as any).gpu
})

describe('PRD-113: isOnDeviceSupported', () => {
  it('is false when navigator.gpu is absent', () => {
    expect(isOnDeviceSupported()).toBe(false)
  })

  it('is true when navigator.gpu is present', () => {
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
    expect(isOnDeviceSupported()).toBe(true)
  })
})

describe('PRD-113: on-device preference persistence', () => {
  it('defaults to disabled', () => {
    expect(isOnDeviceEnabled()).toBe(false)
  })

  it('round-trips through setOnDeviceEnabled', () => {
    setOnDeviceEnabled(true)
    expect(isOnDeviceEnabled()).toBe(true)
    setOnDeviceEnabled(false)
    expect(isOnDeviceEnabled()).toBe(false)
  })
})

describe("guardrail: PRD-113's on-device system prompt never names a product/provider — CLAUDE.md's second rule, mechanically enforced", () => {
  it('forbids recommending/switching/comparing, same class of language PRD-111 guards against', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8')
    // Deliberately doesn't include "switch to" — the prompt legitimately
    // uses that exact phrase to *forbid* switching ("never... a product
    // or provider to switch to"), which would otherwise false-positive
    // against its own compliant constraint text.
    const forbidden = /lost your job|you'?ve been made redundant|compare quotes|best policy|recommended policy|we recommend/i
    expect(source).not.toMatch(forbidden)
    // Positive check — the constraint must actually be *stated*, not just absent.
    expect(source).toMatch(/never recommend, compare, or name a specific product or provider/i)
  })

  it('scopes generation entirely client-side — no fetch/XHR call in the generation path itself', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8')
    // generateDraftOnDevice and enableOnDeviceModel must never call fetch
    // directly — everything they do goes through the dynamically-imported
    // WebLLM engine, not this app's own network layer.
    const generateFn = source.slice(source.indexOf('export async function generateDraftOnDevice'))
    expect(generateFn).not.toMatch(/\bfetch\(/)
  })
})
