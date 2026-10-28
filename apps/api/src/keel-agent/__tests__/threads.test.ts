import { describe, expect, it } from 'vitest'
import { buildKeelContext } from '../context.js'
import { appendMessage, ensureThread, getThread } from '../threads.js'
import { classifyIntent } from '../intent.js'
import { createFakeDb } from './fake-db.js'

const members = [{ id: 'u1', user_id: 'u1', role: 'organizer', status: 'active' }]
const setup = async () => {
  const fake = createFakeDb({ family_groups: [{ tenant_id: 'T', members }] })
  const ctx = await buildKeelContext(fake.db, { tenant_id: 'T', user_id: 'u1', roles: ['owner'] })
  return { fake, ctx }
}

describe('thread ordering and retention', () => {
  it('parallel appends (two tabs, a retry racing the original) never share a position', async () => {
    const { fake, ctx } = await setup()
    const id = await ensureThread(fake.db, ctx, undefined, 'first')
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        appendMessage(fake.db, ctx, id, { author: 'user', content: `m${i}` }),
      ),
    )
    const seqs = fake.data['keel_messages']!.map((m) => m['seq'] as number).sort((a, b) => a - b)
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('messages come back in order even when saved in the same millisecond', async () => {
    const { fake, ctx } = await setup()
    const id = await ensureThread(fake.db, ctx, undefined, 'q')
    await appendMessage(fake.db, ctx, id, { author: 'user', content: 'question' })
    await appendMessage(fake.db, ctx, id, { author: 'keel', content: 'answer' })
    const thread = await getThread(fake.db, ctx, id)
    expect(thread!.messages.map((m) => m.content)).toEqual(['question', 'answer'])
  })

  it('an active conversation keeps all of its messages: continuing it extends their retention', async () => {
    const { fake, ctx } = await setup()
    const id = await ensureThread(fake.db, ctx, undefined, 'q')
    await appendMessage(fake.db, ctx, id, { author: 'user', content: 'old question' })
    const soon = new Date(Date.now() + 60_000)
    fake.data['keel_messages']![0]!['expires_at'] = soon
    await ensureThread(fake.db, ctx, id, 'continuing')
    const days =
      ((fake.data['keel_messages']![0]!['expires_at'] as Date).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
  })

  it('appending to a thread the user does not own fails instead of writing', async () => {
    const { fake, ctx } = await setup()
    await expect(
      appendMessage(fake.db, ctx, 'someone-elses-thread', { author: 'user', content: 'x' }),
    ).rejects.toThrow()
    expect(fake.data['keel_messages'] ?? []).toHaveLength(0)
  })
})

describe('intent: curly apostrophes from phones', () => {
  it("treats what’s next like what's next", () => {
    expect(classifyIntent('What’s next?')).toBe('setup_next')
  })
})
