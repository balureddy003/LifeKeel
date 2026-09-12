/**
 * Known IMAP host/port presets — pure convenience for the connect form so a
 * user picking "Gmail" or "Outlook" doesn't have to know IMAP server
 * hostnames. The connector itself is fully generic: any host/port/username/
 * password the user types works exactly the same way, including a provider
 * not in this list (a custom domain, a self-hosted mail server, etc.).
 */
export interface EmailProviderPreset {
  id: string
  name: string
  host: string
  port: number
  useTls: boolean
  /** Shown in the UI — most providers need an app-specific password, not the account password. */
  passwordHint: string
}

export const EMAIL_PROVIDER_PRESETS: EmailProviderPreset[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    host: 'imap.gmail.com',
    port: 993,
    useTls: true,
    passwordHint: 'Use a Google App Password, not your regular password (Google Account -> Security -> App passwords).',
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    host: 'outlook.office365.com',
    port: 993,
    useTls: true,
    passwordHint: 'Use an app password if your account has multi-factor authentication enabled.',
  },
  {
    id: 'yahoo',
    name: 'Yahoo Mail',
    host: 'imap.mail.yahoo.com',
    port: 993,
    useTls: true,
    passwordHint: 'Generate an app password from Yahoo Account Security settings.',
  },
  {
    id: 'icloud',
    name: 'iCloud Mail',
    host: 'imap.mail.me.com',
    port: 993,
    useTls: true,
    passwordHint: 'Use an app-specific password from appleid.apple.com.',
  },
  {
    id: 'custom',
    name: 'Other / custom',
    host: '',
    port: 993,
    useTls: true,
    passwordHint: 'Check your email provider\'s IMAP settings page for the server host and port.',
  },
]

export function findProviderPreset(id: string | undefined): EmailProviderPreset | undefined {
  return EMAIL_PROVIDER_PRESETS.find((p) => p.id === id)
}
