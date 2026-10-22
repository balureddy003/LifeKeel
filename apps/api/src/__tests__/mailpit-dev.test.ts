import { afterEach, describe, expect, it, vi } from 'vitest'
import sgMail from '@sendgrid/mail'
import { installMailpitTransport, resolveMailpitUrl, toMailpitMessage } from '../dev/mailpit.js'

const originalSend = sgMail.send

afterEach(() => {
  sgMail.send = originalSend
  vi.unstubAllGlobals()
})

describe('resolveMailpitUrl', () => {
  it('is off when MAILPIT_URL is unset or empty', () => {
    expect(resolveMailpitUrl({})).toBeNull()
    expect(resolveMailpitUrl({ MAILPIT_URL: '' })).toBeNull()
  })

  it('accepts loopback hosts', () => {
    expect(resolveMailpitUrl({ MAILPIT_URL: 'http://localhost:8025' })).toBe(
      'http://localhost:8025',
    )
    expect(resolveMailpitUrl({ MAILPIT_URL: 'http://127.0.0.1:8025/' })).toBe(
      'http://127.0.0.1:8025',
    )
    expect(resolveMailpitUrl({ MAILPIT_URL: 'http://[::1]:8025' })).toBe('http://[::1]:8025')
  })

  it('refuses production', () => {
    expect(() =>
      resolveMailpitUrl({ MAILPIT_URL: 'http://localhost:8025', NODE_ENV: 'production' }),
    ).toThrow(/production/)
  })

  it('refuses non-loopback hosts', () => {
    expect(() => resolveMailpitUrl({ MAILPIT_URL: 'http://mailpit.example.com:8025' })).toThrow(
      /localhost/,
    )
    expect(() => resolveMailpitUrl({ MAILPIT_URL: 'http://10.0.0.5:8025' })).toThrow(/localhost/)
  })
})

describe('toMailpitMessage', () => {
  it('maps SendGrid string and object addresses, subject, bodies and headers', () => {
    expect(
      toMailpitMessage({
        to: ['a@lifekeel.test', { email: 'b@lifekeel.test', name: 'B' }],
        from: { email: 'accounts@lifekeel.test', name: 'LifeKeel' },
        subject: 'Verify your email',
        text: 'hi',
        html: '<p>hi</p>',
        headers: { 'List-Unsubscribe': '<http://localhost/u>' },
      }),
    ).toEqual({
      From: { Email: 'accounts@lifekeel.test', Name: 'LifeKeel' },
      To: [{ Email: 'a@lifekeel.test' }, { Email: 'b@lifekeel.test', Name: 'B' }],
      Cc: undefined,
      Bcc: undefined,
      ReplyTo: undefined,
      Subject: 'Verify your email',
      Text: 'hi',
      HTML: '<p>hi</p>',
      Headers: { 'List-Unsubscribe': '<http://localhost/u>' },
    })
  })
})

describe('installMailpitTransport', () => {
  it('leaves SendGrid untouched when MAILPIT_URL is unset', () => {
    expect(installMailpitTransport({})).toBe(false)
    expect(sgMail.send).toBe(originalSend)
  })

  it('routes sgMail.send to the Mailpit send API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ID":"x"}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(installMailpitTransport({ MAILPIT_URL: 'http://localhost:8025' })).toBe(true)
    await sgMail.send({
      to: 'a@lifekeel.test',
      from: 'accounts@lifekeel.test',
      subject: 's',
      text: 't',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8025/api/v1/send')
    expect(JSON.parse(String(init.body))).toMatchObject({
      To: [{ Email: 'a@lifekeel.test' }],
      Subject: 's',
    })
  })

  it('surfaces a Mailpit error so senders log it like a SendGrid failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })))
    installMailpitTransport({ MAILPIT_URL: 'http://localhost:8025' })

    await expect(
      sgMail.send({
        to: 'a@lifekeel.test',
        from: 'accounts@lifekeel.test',
        subject: 's',
        text: 't',
      }),
    ).rejects.toThrow(/400/)
  })
})
