/**
 * Plain-language explanation of how alerts reach a family (PRD-140): pure, so
 * the wording and the platform rules are testable. Names no amounts, products
 * or devices; counts only.
 */
import type { ChannelState } from './api'

export interface ClientFacts {
  nativeShell: boolean
  ios: boolean
  standalone: boolean
  pushSupported: boolean
}

export interface ChannelLine {
  key: 'email' | 'device' | 'failure'
  text: string
  /** Offer the "turn on alerts in this app" button. */
  action?: 'enable_native'
}

export function explainChannels(state: ChannelState, c: ClientFacts): ChannelLine[] {
  const lines: ChannelLine[] = [
    {
      key: 'email',
      text: state.email.available
        ? 'Email is the safety net: if a device cannot be reached, the alert comes to your email.'
        : 'No email address is on file. Add one in settings so alerts always reach you.',
    },
  ]

  if (c.nativeShell) {
    lines.push(
      state.mobile_push.devices > 0
        ? { key: 'device', text: 'Alerts are on in this app.' }
        : { key: 'device', text: 'Alerts are off in this app.', action: 'enable_native' },
    )
  } else if (c.ios && !c.standalone) {
    lines.push({
      key: 'device',
      text: 'On iPhone and iPad, alerts only work from the installed app. Add LifeKeel to your Home Screen to get them.',
    })
  } else if (!c.pushSupported) {
    lines.push({
      key: 'device',
      text: 'This browser cannot receive push alerts, so alerts will come to your email.',
    })
  } else {
    const n = state.web_push.devices
    lines.push({
      key: 'device',
      text:
        n > 0
          ? `Browser alerts are on for ${n} ${n === 1 ? 'device' : 'devices'}.`
          : 'Browser alerts are off. Turn them on above to get alerts here.',
    })
  }

  const failed = state.recent_failures.web_push + state.recent_failures.mobile_push
  if (failed > 0) {
    lines.push({
      key: 'failure',
      text: 'A device stopped receiving alerts and was removed. Alerts go to email until you turn them on again.',
    })
  }
  return lines
}
