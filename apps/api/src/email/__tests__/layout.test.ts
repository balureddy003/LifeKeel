import { afterEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_COLORS, button, escapeHtml, renderEmail, type EmailContent } from '../layout.js'
import { sendFamilyInviteEmail } from '../../auth-email.js'
import { buildEmailHtml } from '../../delivery/channels.js'
import {
  activationBody,
  leadEducationBody,
  leadLastCallBody,
  leadWelcomeBody,
  trialEndingBody,
  trialExpiredBody,
  upgradeBody,
  winbackBody,
} from '../../marketing/lifecycle-emails.js'
import { sendLowCreditEmail } from '../../billing/low-credit-alerts.js'
import { sendChecklistReminderEmail } from '../../life-events/checklist-reminder.js'
import { sendVaultReminderEmail } from '../../life-events/vault-reminder.js'
import sgMail from '@sendgrid/mail'

const base: EmailContent = {
  preheader: 'Preview line',
  eyebrow: 'Your account',
  title: 'Verify your email',
  bodyHtml: '<p>Body</p>',
  cta: { url: 'https://app.example/verify?t=1&u=2', label: 'Verify email' },
  footer: { reason: 'You got this because of a test.' },
}

const originalUrl = process.env['LIFEKEEL_URL']
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (originalUrl === undefined) delete process.env['LIFEKEEL_URL']
  else process.env['LIFEKEEL_URL'] = originalUrl
})

describe('renderEmail', () => {
  it('renders the hero, body, brass button, and preheader', () => {
    const html = renderEmail(base)
    expect(html).toContain('<meta name="color-scheme" content="light">')
    expect(html).toContain('Preview line')
    expect(html).toContain('>Verify your email</h1>')
    expect(html).toContain('Your account')
    expect(html).toContain('<p>Body</p>')
    expect(html).toContain(`bgcolor="${EMAIL_COLORS.cta}"`)
    expect(html).toContain('href="https://app.example/verify?t=1&amp;u=2"')
  })

  it('links the logo and footer to the configured app URL', () => {
    process.env['LIFEKEEL_URL'] = 'https://app.example/'
    const html = renderEmail(base)
    expect(html).toContain('src="https://app.example/icon-192.png"')
    for (const path of ['/support', '/privacy', '/terms']) {
      expect(html).toContain(`href="https://app.example${path}"`)
    }
    expect(html).toContain('Information only, not regulated advice.')
    expect(html).toContain('You got this because of a test.')
  })

  it('shows Unsubscribe and Manage notifications only when given', () => {
    const plain = renderEmail(base)
    expect(plain).not.toContain('Unsubscribe')
    expect(plain).not.toContain('Manage notifications')

    const full = renderEmail({
      ...base,
      footer: {
        reason: 'r',
        unsubscribeUrl: 'https://u.example/x',
        manageUrl: 'https://m.example/y',
      },
    })
    expect(full).toContain('href="https://u.example/x"')
    expect(full).toContain('>Unsubscribe</a>')
    expect(full).toContain('href="https://m.example/y"')
  })

  it('escapes title, eyebrow, preheader, labels and note', () => {
    const html = renderEmail({
      ...base,
      title: '<b>t</b>',
      eyebrow: '<i>e</i>',
      preheader: '<s>p</s>',
      note: '<u>n</u>',
      secondaryLinks: [{ url: 'https://x.example', label: '<em>l</em>' }],
    })
    for (const raw of ['<b>t</b>', '<i>e</i>', '<s>p</s>', '<u>n</u>', '<em>l</em>']) {
      expect(html).not.toContain(raw)
    }
    expect(html).toContain('&lt;b&gt;t&lt;/b&gt;')
  })

  it.each(['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@app.example'])(
    'rejects unsafe link %s in buttons and secondary links',
    (url) => {
      expect(() => button({ url, label: 'Open' })).toThrow()
      expect(() => renderEmail({ ...base, secondaryLinks: [{ url, label: 'Open' }] })).toThrow()
    },
  )

  it('escapes the configured correspondence address', () => {
    vi.stubEnv('EMAIL_POSTAL_ADDRESS', '<b>Milton Keynes</b>')
    const html = renderEmail(base)
    expect(html).toContain('LifeKeel · &lt;b&gt;Milton Keynes&lt;/b&gt;')
    expect(html).not.toContain('<b>Milton Keynes</b>')
  })

  it('button escapes its URL and label', () => {
    expect(button({ url: 'https://x.example/?a="b"', label: '<x>' })).toContain(
      'href="https://x.example/?a=&quot;b&quot;"',
    )
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
  })
})

describe('senders escape user-supplied values', () => {
  it('family invite escapes an organizer-chosen family name', async () => {
    const sgMail = (await import('@sendgrid/mail')).default
    const original = sgMail.send
    let html = ''
    sgMail.send = async (data) => {
      html = String((Array.isArray(data) ? data[0] : data)?.html)
      return [{ statusCode: 202, body: {}, headers: {} }, {}]
    }
    process.env['SENDGRID_API_KEY'] = 'SG.test'
    try {
      await sendFamilyInviteEmail(
        'a@x.test',
        'Ann',
        '<img src=x onerror=alert(1)>',
        'https://app.example/invite',
      )
    } finally {
      sgMail.send = original
      delete process.env['SENDGRID_API_KEY']
    }
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('insight email uses the brand layout, not the old Studio look', () => {
    const { html } = buildEmailHtml({
      insight_id: 'i',
      tenant_id: 't',
      hypothesis: 'Gap <script>',
      recommended_actions: ['Check the figures on file'],
      urgency: 'high',
      or_score: 0.8,
      action_url: 'https://app.example/insights/i',
      approve_url: 'https://app.example/a',
      dismiss_url: 'https://app.example/d',
    })
    expect(html).toContain('Possible next steps')
    expect(html).not.toContain('Recommended Actions')
    expect(html).not.toContain('LifeKeel Studio')
    expect(html).not.toContain('<script>')
    expect(html).toContain(`bgcolor="${EMAIL_COLORS.cta}"`)
  })
})

describe('email review regressions', () => {
  it('escapes recipient names in every lifecycle template', () => {
    const name = '<img/src=x>'
    const app = 'https://app.example'
    const unsub = `${app}/unsubscribe`
    const bodies = [
      leadWelcomeBody(name, app, unsub),
      leadEducationBody(name, app, unsub),
      leadLastCallBody(name, app, unsub),
      activationBody(name, app),
      upgradeBody(name, app),
      trialEndingBody(name, new Date('2026-11-01'), app),
      trialExpiredBody(name, app),
      winbackBody(name, app),
    ]
    for (const html of bodies) {
      expect(html).not.toContain(name)
      expect(html).toContain('&lt;img/src=x&gt;')
    }
  })

  it('includes reminder destinations in both MIME alternatives', async () => {
    vi.stubEnv('SENDGRID_API_KEY', 'SG.test')
    vi.stubEnv('LIFEKEEL_URL', 'https://app.example')
    const send = vi
      .spyOn(sgMail, 'send')
      .mockResolvedValue([{ statusCode: 202, body: {}, headers: {} }, {}])
    await sendChecklistReminderEmail('a@x.test', 'Sam', 'Job loss', 3)
    await sendVaultReminderEmail('a@x.test', 'Sam', 'Alex', 'A bereavement', 2)
    for (const [index, path] of ['/life-events', '/vault'].entries()) {
      const data = send.mock.calls[index]![0]
      const message = Array.isArray(data) ? data[0]! : data
      expect(message.text).toContain(`https://app.example${path}`)
      expect(message.html).toContain(`href="https://app.example${path}"`)
      expect(message.text).not.toContain('Oak')
    }
  })

  it('routes credit alerts to the existing family billing page', async () => {
    vi.stubEnv('SENDGRID_API_KEY', 'SG.test')
    vi.stubEnv('LIFEKEEL_URL', 'https://app.example')
    vi.stubEnv('STUDIO_URL', 'https://retired.example')
    const send = vi
      .spyOn(sgMail, 'send')
      .mockResolvedValue([{ statusCode: 202, body: {}, headers: {} }, {}])
    for (const type of ['low', 'zero'] as const) {
      await sendLowCreditEmail('a@x.test', type, {
        tenant_id: 't',
        plan: 'free',
        billing: { credits_balance: 0, credits_included: 5, currency: 'GBP' },
      })
    }
    for (const [data] of send.mock.calls) {
      const message = Array.isArray(data) ? data[0]! : data
      expect(message.text).toContain('https://app.example/upgrade')
      expect(message.html).toContain('href="https://app.example/upgrade"')
      expect(message.html).not.toContain('retired.example')
      expect(message.html).not.toContain('Buy a credit pack')
      expect(message.subject).not.toContain('keep getting insights')
    }
  })
})
