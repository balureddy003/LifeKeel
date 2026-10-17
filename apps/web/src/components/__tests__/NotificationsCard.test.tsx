/**
 * PRD-136 §5 — the settings Notifications card: organizer-editable,
 * read-only for other adults, exempt criticals always listed.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { NotificationsCard } from '../NotificationsCard'
import type { NotificationPrefs } from '@/lib/api'

const prefs: NotificationPrefs = {
  channels: ['web_push', 'email'],
  whatsapp_to: null,
  sms_to: null,
  email_to: 'a@x.test',
  web_push_enabled: true,
  mobile_push_enabled: false,
  min_urgency: 'low',
  business_name: 'LifeKeel',
  quiet_hours_start: null,
  quiet_hours_end: null,
  digest_mode: false,
  enabled: true,
  heartbeat_cadence: 'weekly',
  heartbeat_quiet_weeks: false,
  domains_muted: [],
  member_scope: 'all',
}

const exempt = ['renewal_within_7_days', 'continuity_check_in', 'emergency_vault_awareness']

describe('NotificationsCard', () => {
  it('renders read-only for a non-organizer: controls disabled, no reorder buttons', () => {
    render(
      <NotificationsCard prefs={prefs} exemptCriticals={exempt} isOrganizer={false} busy={false} onPatch={() => {}} />,
    )
    expect(screen.getByText('Only the organizer can change these')).toBeTruthy()
    // No up/down reorder affordances.
    expect(screen.queryByLabelText(/Move .* (up|down)/)).toBeNull()
    // Every control disabled.
    for (const el of screen.getAllByRole('button')) expect((el as HTMLButtonElement).disabled).toBe(true)
    for (const el of screen.getAllByRole('checkbox')) expect((el as HTMLInputElement).disabled).toBe(true)
    // Exempt criticals always visible.
    expect(screen.getByText('renewal within 7 days')).toBeTruthy()
  })

  it('organizer can change cadence and reorder channels', () => {
    const onPatch = vi.fn()
    render(
      <NotificationsCard prefs={prefs} exemptCriticals={exempt} isOrganizer busy={false} onPatch={onPatch} />,
    )
    fireEvent.click(screen.getByText('Monthly'))
    expect(onPatch).toHaveBeenCalledWith({ heartbeat_cadence: 'monthly' })
    fireEvent.click(screen.getByLabelText('Move email up'))
    expect(onPatch).toHaveBeenCalledWith({ channels: ['email', 'web_push'] })
    fireEvent.click(screen.getByText('estate'))
    expect(onPatch).toHaveBeenCalledWith({ domains_muted: ['estate'] })
  })
})
