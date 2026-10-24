import { beforeEach, describe, expect, it } from 'vitest'
import { captureAttribution, getAttribution, getLastTouch } from '../attribution'

function visit(search: string, referrer = '') {
  window.history.pushState({}, '', `/blog/post${search}`)
  Object.defineProperty(document, 'referrer', { value: referrer, configurable: true })
  captureAttribution()
}

beforeEach(() => {
  localStorage.clear()
})

describe('attribution capture', () => {
  it('keeps the first attributed visit as first touch', () => {
    visit('?utm_source=bluesky&utm_campaign=pillar_chart')
    visit('?utm_source=x&utm_campaign=pillar_guides')
    expect(getAttribution()).toMatchObject({ utm_source: 'bluesky', utm_campaign: 'pillar_chart' })
  })

  it('replaces the last touch on each attributed visit', () => {
    visit('?utm_source=bluesky')
    expect(getLastTouch()).toMatchObject({ utm_source: 'bluesky' })
    visit('?utm_source=x&utm_content=post_9')
    expect(getLastTouch()).toMatchObject({ utm_source: 'x', utm_content: 'post_9' })
    expect(getAttribution()).toMatchObject({ utm_source: 'bluesky' })
  })

  it('a direct visit with nothing to say claims neither slot', () => {
    visit('')
    expect(getAttribution()).toBeUndefined()
    expect(getLastTouch()).toBeUndefined()
    visit('?utm_source=bluesky')
    visit('')
    expect(getLastTouch()).toMatchObject({ utm_source: 'bluesky' })
  })

  it('treats an external referrer as a touch but ignores same-site navigation', () => {
    visit('', `${window.location.origin}/guides`)
    expect(getAttribution()).toBeUndefined()
    visit('', 'https://www.google.com/')
    expect(getAttribution()).toMatchObject({ referrer: 'https://www.google.com/' })
    expect(getLastTouch()).toMatchObject({ referrer: 'https://www.google.com/' })
  })

  it('survives a locked-down browser without throwing', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new Error('blocked')
    }
    try {
      expect(() => visit('?utm_source=bluesky')).not.toThrow()
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
