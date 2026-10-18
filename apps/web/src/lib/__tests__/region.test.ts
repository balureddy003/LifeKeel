import { describe, it, expect } from 'vitest'
import { decideRegion, redirectTarget, regionForHost, regionFromLocale } from '../region'

const loc = (host: string, pathname = '/', search = '', hash = '') => ({
  host,
  pathname,
  search,
  hash,
})

describe('regionFromLocale', () => {
  it('maps a Slovenian device to si and everything else to uk', () => {
    expect(regionFromLocale('sl-SI')).toBe('si')
    expect(regionFromLocale('en_si')).toBe('si')
    expect(regionFromLocale('en-GB')).toBe('uk')
    expect(regionFromLocale('en')).toBe('uk')
    expect(regionFromLocale(undefined)).toBe('uk')
  })
})

describe('regionForHost / redirectTarget', () => {
  it('knows only the two app hosts', () => {
    expect(regionForHost('app.lifekeel.co.uk')).toBe('uk')
    expect(regionForHost('app.lifekeel.si')).toBe('si')
    expect(regionForHost('localhost:3002')).toBeNull()
    expect(regionForHost('lifekeel.si')).toBeNull()
  })

  it('keeps path, query and hash when switching host', () => {
    expect(redirectTarget('si', loc('app.lifekeel.co.uk', '/events/car', '?a=1', '#x'))).toBe(
      'https://app.lifekeel.si/events/car?a=1#x',
    )
  })

  it('does nothing when already on the right host or on a non-app host', () => {
    expect(redirectTarget('uk', loc('app.lifekeel.co.uk'))).toBeNull()
    expect(redirectTarget('si', loc('localhost:3002'))).toBeNull()
    expect(redirectTarget('si', loc('preview-123.web.app'))).toBeNull()
  })
})

describe('decideRegion', () => {
  const uk = loc('app.lifekeel.co.uk', '/login')

  it('follows a saved region without re-saving it', () => {
    expect(decideRegion({ saved: 'si', language: 'en-GB', hasSession: false, loc: uk })).toEqual({
      region: 'si',
      persist: false,
      redirectTo: 'https://app.lifekeel.si/login',
    })
  })

  it('guesses from the device language on first launch, without a prompt', () => {
    expect(decideRegion({ saved: null, language: 'sl-SI', hasSession: false, loc: uk })).toEqual({
      region: 'si',
      persist: true,
      redirectTo: 'https://app.lifekeel.si/login',
    })
    expect(decideRegion({ saved: null, language: 'en-GB', hasSession: false, loc: uk })).toEqual({
      region: 'uk',
      persist: true,
      redirectTo: null,
    })
  })

  it('never moves an existing signed-in install, whatever the device language', () => {
    expect(decideRegion({ saved: null, language: 'sl-SI', hasSession: true, loc: uk })).toEqual({
      region: 'uk',
      persist: true,
      redirectTo: null,
    })
  })

  it('does nothing off the app hosts', () => {
    expect(
      decideRegion({
        saved: 'si',
        language: 'sl-SI',
        hasSession: false,
        loc: loc('localhost:3002'),
      }),
    ).toBeNull()
  })
})
