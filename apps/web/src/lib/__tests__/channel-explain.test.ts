import { describe, expect, it } from 'vitest'
import { explainChannels, type ClientFacts } from '../channel-explain'
import type { ChannelState } from '../api'

const state = (over: Partial<ChannelState> = {}): ChannelState => ({
  email: { available: true },
  web_push: { devices: 0, enabled: false },
  mobile_push: { devices: 0, enabled: false, platforms: [] },
  recent_failures: { web_push: 0, mobile_push: 0, last_at: null },
  first_channel: 'email',
  ...over,
})
const web: ClientFacts = { nativeShell: false, ios: false, standalone: false, pushSupported: true }
const text = (s: ChannelState, c: ClientFacts) =>
  explainChannels(s, c)
    .map((l) => l.text)
    .join(' | ')

describe('explainChannels (PRD-140)', () => {
  it('always names email as the safety net, or asks for an address when there is none', () => {
    expect(text(state(), web)).toMatch(/Email is the safety net/)
    expect(text(state({ email: { available: false } }), web)).toMatch(/No email address is on file/)
  })

  it('tells an iPhone browser user to add LifeKeel to the Home Screen', () => {
    const t = text(state(), { ...web, ios: true, standalone: false })
    expect(t).toMatch(/Add LifeKeel to your Home Screen/)
    expect(t).not.toMatch(/Browser alerts/)
  })

  it('an installed iOS app is treated like any push-capable browser', () => {
    expect(
      text(state({ web_push: { devices: 1, enabled: true } }), {
        ...web,
        ios: true,
        standalone: true,
      }),
    ).toMatch(/Browser alerts are on for 1 device\./)
  })

  it('says so when the browser cannot receive push', () => {
    expect(text(state(), { ...web, pushSupported: false })).toMatch(/cannot receive push alerts/)
  })

  it('counts devices, singular and plural', () => {
    expect(text(state({ web_push: { devices: 2, enabled: true } }), web)).toMatch(/for 2 devices\./)
    expect(text(state(), web)).toMatch(/Browser alerts are off/)
  })

  it('in the native shell, offers to turn alerts on only when none are registered', () => {
    const shell: ClientFacts = { ...web, nativeShell: true }
    const off = explainChannels(state(), shell).find((l) => l.key === 'device')!
    expect(off).toMatchObject({ text: 'Alerts are off in this app.', action: 'enable_native' })
    const on = explainChannels(
      state({ mobile_push: { devices: 1, enabled: true, platforms: ['ios'] } }),
      shell,
    ).find((l) => l.key === 'device')!
    expect(on.text).toBe('Alerts are on in this app.')
    expect(on.action).toBeUndefined()
  })

  it('explains a removed device and where alerts go instead', () => {
    const t = text(
      state({ recent_failures: { web_push: 1, mobile_push: 0, last_at: '2026-10-20T00:00:00Z' } }),
      web,
    )
    expect(t).toMatch(/stopped receiving alerts and was removed/)
    expect(t).toMatch(/Alerts go to email/)
    expect(text(state(), web)).not.toMatch(/was removed/)
  })

  it('never mentions amounts, products or tokens', () => {
    const t = text(state({ recent_failures: { web_push: 1, mobile_push: 1, last_at: 'x' } }), {
      ...web,
      nativeShell: true,
    })
    expect(t).not.toMatch(/£|\d{3,}|token|endpoint|policy|insurer/i)
  })
})
