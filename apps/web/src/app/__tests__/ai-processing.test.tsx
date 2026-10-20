import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AiDisclosure } from '@/lib/api'

const fetchAiDisclosure = vi.fn()
vi.mock('@/lib/api', () => ({ fetchAiDisclosure: () => fetchAiDisclosure() }))

import AiProcessingPage from '../ai-processing/page'
import {
  RETENTION_TEXT,
  RULE_TEXT,
  STATUS_TEXT,
  UNREVIEWED_NOTE,
  WHERE_TEXT,
} from '@/lib/ai-disclosure-copy'

const data: AiDisclosure = {
  generated_at: '2026-10-20T00:00:00Z',
  processors: [
    {
      id: 'ollama',
      name: 'LifeKeel self-hosted model',
      hosting: 'self_hosted',
      status: 'run_by_lifekeel',
      region: null,
      retention: ['none'],
      sub_processors: ['none'],
      review_due: null,
      used_by_tasks: 6,
    },
    {
      id: 'anthropic',
      name: 'Anthropic API',
      hosting: 'hosted',
      status: 'terms_under_review',
      region: null,
      retention: ['limited_abuse_log'],
      sub_processors: null,
      review_due: null,
      used_by_tasks: 6,
    },
  ],
  tasks: [
    {
      task_id: 'assistant.answer.v1',
      purpose: 'Answer a question',
      where: 'lifekeel_or_hosted',
      processors: ['ollama', 'anthropic'],
      retention_class: 'service_transient',
    },
    {
      task_id: 'draft.crisis_on_device.v1',
      purpose: 'Draft on your device',
      where: 'device',
      processors: [],
      retention_class: 'none',
    },
  ],
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('/ai-processing', () => {
  it('says what is true: self-hosted as run by LifeKeel, an unreviewed provider as not reviewed with nothing confirmed', async () => {
    fetchAiDisclosure.mockResolvedValue(data)
    render(<AiProcessingPage />)
    expect(await screen.findByText(STATUS_TEXT.run_by_lifekeel)).toBeTruthy()
    expect(screen.getByText(STATUS_TEXT.terms_under_review)).toBeTruthy()
    expect(screen.getAllByText('Not yet confirmed').length).toBeGreaterThanOrEqual(3) // region, retention, other companies
    expect(screen.getByText(UNREVIEWED_NOTE)).toBeTruthy()
    expect(screen.queryByText(STATUS_TEXT.approved)).toBeNull()
  })

  it('describes where each feature runs, including the hosted fallback, and omits providers for on-device', async () => {
    fetchAiDisclosure.mockResolvedValue(data)
    render(<AiProcessingPage />)
    expect(await screen.findByText(WHERE_TEXT.lifekeel_or_hosted)).toBeTruthy()
    expect(screen.getByText('May use: LifeKeel self-hosted model, Anthropic API')).toBeTruthy()
    expect(screen.getByText(WHERE_TEXT.device)).toBeTruthy()
    expect(screen.getAllByText(/May use:/)).toHaveLength(1)
  })

  it('states the rule and shows a friendly message when the data is unavailable', async () => {
    fetchAiDisclosure.mockResolvedValue(null)
    render(<AiProcessingPage />)
    expect(await screen.findByText(/not available right now/)).toBeTruthy()
    expect(screen.getByText(RULE_TEXT)).toBeTruthy()
  })
})

describe('disclosure copy', () => {
  const all = [
    RULE_TEXT,
    UNREVIEWED_NOTE,
    ...Object.values(STATUS_TEXT),
    ...Object.values(WHERE_TEXT),
    ...Object.values(RETENTION_TEXT),
  ].join(' ')

  it('never claims a provider is safe, compliant or approved without a review', () => {
    expect(STATUS_TEXT.terms_under_review).not.toMatch(/approved|safe|compliant|secure/i)
    expect(all).not.toMatch(/\b(guarantee|fully secure|100%|gdpr compliant)\b/i)
  })

  it('makes no recommendation and names no product provider (advice rule)', () => {
    expect(all).not.toMatch(/\b(you should|we recommend|buy|switch to)\b/i)
  })
})
