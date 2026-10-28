import { describe, expect, it } from 'vitest'
import { buildKeelContext } from '../context.js'
import { confirmProposal, createProposal, dismissProposal } from '../proposals.js'
import {
  diffSettings,
  NOTIFICATION_DEFAULTS,
  PRESETS,
  PROPOSABLE_SETTINGS,
  type SettingChange,
} from '../presets.js'
import { createFakeDb } from './fake-db.js'

const T = 't1'
const members = [
  { id: 'u1', user_id: 'u1', role: 'organizer', status: 'active' },
  { id: 'u2', user_id: 'u2', role: 'adult', status: 'active' },
]
const diff: SettingChange[] = [
  { key: 'digest_mode', from: false, to: true },
  { key: 'min_urgency', from: 'low', to: 'medium' },
]

const setup = (extra: Record<string, Record<string, unknown>[]> = {}) => {
  const fake = createFakeDb({ family_groups: [{ tenant_id: T, members }], ...extra })
  const ctx = (user: string, tenant = T, roles = ['owner']) =>
    buildKeelContext(fake.db, { tenant_id: tenant, user_id: user, roles })
  return { fake, ctx }
}

describe('Tier 1 proposals', () => {
  it('only the organizer can create one, and an empty diff creates none', async () => {
    const { fake, ctx } = setup()
    expect(await createProposal(fake.db, await ctx('u2'), 'p', diff)).toBeNull()
    expect(await createProposal(fake.db, await ctx('u1'), 'p', [])).toBeNull()
    expect(await createProposal(fake.db, await ctx('u1'), 'p', diff)).toMatchObject({
      status: 'pending',
      user_id: 'u1',
    })
  })

  it('confirm writes only the proposed keys, marks the preferences reviewed and records who approved', async () => {
    const { fake, ctx } = setup()
    const organizer = await ctx('u1')
    const p = (await createProposal(fake.db, organizer, 'p', diff))!
    expect(await confirmProposal(fake.db, organizer, p.id)).toEqual({ ok: true })
    const prefs = (fake.data['delivery_preferences'] ?? [])[0]!
    expect(prefs).toMatchObject({
      tenant_id: T,
      digest_mode: true,
      min_urgency: 'medium',
      enabled: true,
    })
    expect(prefs['reviewed_at']).toBeInstanceOf(Date)
    expect(prefs).not.toHaveProperty('heartbeat_cadence')
    expect(fake.data['keel_proposals']![0]).toMatchObject({ status: 'applied', approved_by: 'u1' })
  })

  it('confirming twice applies once', async () => {
    const { fake, ctx } = setup()
    const organizer = await ctx('u1')
    const p = (await createProposal(fake.db, organizer, 'p', diff))!
    expect((await confirmProposal(fake.db, organizer, p.id)).ok).toBe(true)
    expect(await confirmProposal(fake.db, organizer, p.id)).toEqual({
      ok: false,
      code: 'not_found',
    })
  })

  it("another user's or another tenant's proposal is not found", async () => {
    const { fake, ctx } = setup({
      family_groups: [
        { tenant_id: T, members },
        {
          tenant_id: 't2',
          members: [{ id: 'x1', user_id: 'x1', role: 'organizer', status: 'active' }],
        },
      ],
    })
    const p = (await createProposal(fake.db, await ctx('u1'), 'p', diff))!
    expect(await confirmProposal(fake.db, await ctx('u2'), p.id)).toEqual({
      ok: false,
      code: 'not_found',
    })
    expect(await confirmProposal(fake.db, await ctx('x1', 't2'), p.id)).toEqual({
      ok: false,
      code: 'not_found',
    })
    expect(await dismissProposal(fake.db, await ctx('u2'), p.id)).toBe(false)
    expect(fake.data['delivery_preferences'] ?? []).toHaveLength(0)
  })

  it('an expired proposal cannot be applied', async () => {
    const { fake, ctx } = setup()
    const organizer = await ctx('u1')
    const p = (await createProposal(fake.db, organizer, 'p', diff))!
    fake.data['keel_proposals']![0]!['expires_at'] = new Date(Date.now() - 1000)
    expect(await confirmProposal(fake.db, organizer, p.id)).toEqual({
      ok: false,
      code: 'not_found',
    })
    expect(fake.data['delivery_preferences'] ?? []).toHaveLength(0)
  })

  it('if settings changed since it was prepared, nothing is written (conflict)', async () => {
    const { fake, ctx } = setup({ delivery_preferences: [{ tenant_id: T, digest_mode: true }] })
    const organizer = await ctx('u1')
    const p = (await createProposal(fake.db, organizer, 'p', diff))!
    expect(await confirmProposal(fake.db, organizer, p.id)).toEqual({ ok: false, code: 'conflict' })
    expect(fake.data['delivery_preferences']![0]).not.toHaveProperty('reviewed_at')
    expect(fake.data['keel_proposals']![0]).toMatchObject({ status: 'conflict' })
  })

  it('a role change after preparing blocks the apply and leaves it pending', async () => {
    const { fake, ctx } = setup()
    const p = (await createProposal(fake.db, await ctx('u1'), 'p', diff))!
    // The same user is no longer the organizer when they confirm.
    fake.data['family_groups']![0]!['members'] = [
      { id: 'u1', user_id: 'u1', role: 'adult', status: 'active' },
    ]
    expect(await confirmProposal(fake.db, await ctx('u1'), p.id)).toEqual({
      ok: false,
      code: 'forbidden',
    })
    expect(fake.data['keel_proposals']![0]).toMatchObject({ status: 'pending' })
    expect(fake.data['delivery_preferences'] ?? []).toHaveLength(0)
  })
})

describe('presets', () => {
  it('only proposes real notification keys; never an automation setting', () => {
    expect([...PROPOSABLE_SETTINGS].sort()).toEqual([
      'digest_mode',
      'heartbeat_cadence',
      'min_urgency',
    ])
    for (const preset of PRESETS) {
      expect(Object.keys(preset.proposable).sort()).toEqual([...PROPOSABLE_SETTINGS].sort())
      expect(JSON.stringify(preset.proposable)).not.toMatch(
        /auto_execute|renewal_reminders|dry_run/,
      )
    }
  })

  it('diffs only values that differ from what is saved', () => {
    const target = PRESETS[0]!.proposable
    expect(diffSettings(NOTIFICATION_DEFAULTS, target).map((c) => c.key)).toEqual([
      'digest_mode',
      'min_urgency',
    ])
    expect(diffSettings(target, target)).toEqual([])
  })
})
