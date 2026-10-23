import { afterEach, describe, expect, it, vi } from 'vitest'
import sgMail from '@sendgrid/mail'
import {
  activeEmailProvider,
  emailConfigured,
  emailFromAddress,
  installResendTransport,
  toResendMessage,
} from '../email/transport.js'

const originalSend = sgMail.send

afterEach(() => {
  sgMail.send = originalSend
  vi.unstubAllGlobals()
})

describe('activeEmailProvider', () => {
  it('is null with no keys, sendgrid with only SendGrid, resend with only Resend', () => {
    expect(activeEmailProvider({})).toBeNull()
    expect(activeEmailProvider({ SENDGRID_API_KEY: 'SG.x' })).toBe('sendgrid')
    expect(activeEmailProvider({ RESEND_API_KEY: 're_x' })).toBe('resend')
  })

  it('resend wins when both keys are set', () => {
    expect(activeEmailProvider({ SENDGRID_API_KEY: 'SG.x', RESEND_API_KEY: 're_x' })).toBe('resend')
  })

  it('emailConfigured is true when either key is set', () => {
    expect(emailConfigured({})).toBe(false)
    expect(emailConfigured({ SENDGRID_API_KEY: 'SG.x' })).toBe(true)
    expect(emailConfigured({ RESEND_API_KEY: 're_x' })).toBe(true)
  })
})

describe('emailFromAddress', () => {
  it('prefers EMAIL_FROM, falls back to SENDGRID_FROM_EMAIL', () => {
    expect(emailFromAddress({})).toBeUndefined()
    expect(emailFromAddress({ SENDGRID_FROM_EMAIL: 'a@b.co' })).toBe('a@b.co')
    expect(emailFromAddress({ SENDGRID_FROM_EMAIL: 'a@b.co', EMAIL_FROM: 'c@d.co' })).toBe('c@d.co')
  })
})

describe('toResendMessage', () => {
  it('maps addresses, bodies, headers, replyTo and customArgs→tags', () => {
    expect(
      toResendMessage({
        to: ['a@lifekeel.test', { email: 'b@lifekeel.test', name: 'B' }],
        from: { email: 'accounts@lifekeel.test', name: 'LifeKeel' },
        cc: 'c@lifekeel.test',
        replyTo: { email: 'reply@lifekeel.test', name: 'Replies' },
        subject: 'Verify your email',
        text: 'hi',
        html: '<p>hi</p>',
        headers: { 'List-Unsubscribe': '<http://localhost/u>' },
        customArgs: { lk: 'campaign:c1:lead-1' },
      }),
    ).toEqual({
      from: 'LifeKeel <accounts@lifekeel.test>',
      to: ['a@lifekeel.test', 'B <b@lifekeel.test>'],
      cc: ['c@lifekeel.test'],
      bcc: undefined,
      reply_to: ['Replies <reply@lifekeel.test>'],
      subject: 'Verify your email',
      text: 'hi',
      html: '<p>hi</p>',
      headers: { 'List-Unsubscribe': '<http://localhost/u>' },
      tags: [{ name: 'lk', value: 'campaign:c1:lead-1' }],
    })
  })

  it('omits tags when there are no customArgs', () => {
    const msg = toResendMessage({
      to: 'a@lifekeel.test',
      from: 'accounts@lifekeel.test',
      subject: 's',
      text: 't',
    })
    expect(msg.tags).toBeUndefined()
  })
})

describe('installResendTransport', () => {
  it('leaves SendGrid untouched when RESEND_API_KEY is unset', () => {
    expect(installResendTransport({})).toBe(false)
    expect(sgMail.send).toBe(originalSend)
  })

  it('routes sgMail.send to the Resend API with the Bearer key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(installResendTransport({ RESEND_API_KEY: 're_test' })).toBe(true)
    await sgMail.send({
      to: 'a@lifekeel.test',
      from: 'accounts@lifekeel.test',
      subject: 's',
      text: 't',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.resend.com/emails')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer re_test')
    expect(JSON.parse(String(init.body))).toMatchObject({
      to: ['a@lifekeel.test'],
      from: 'accounts@lifekeel.test',
      subject: 's',
    })
  })

  it('honours RESEND_API_BASE for non-default origins', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    installResendTransport({ RESEND_API_KEY: 're_test', RESEND_API_BASE: 'http://localhost:9999' })
    await sgMail.send({ to: 'a@b.co', from: 'c@d.co', subject: 's', text: 't' })
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe(
      'http://localhost:9999/emails',
    )
  })

  it('surfaces a Resend error so senders log it like a SendGrid failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 422 })))
    installResendTransport({ RESEND_API_KEY: 're_test' })

    await expect(
      sgMail.send({
        to: 'a@lifekeel.test',
        from: 'accounts@lifekeel.test',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/422/)
  })
})
