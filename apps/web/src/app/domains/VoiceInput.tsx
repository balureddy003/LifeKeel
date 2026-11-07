'use client'

import { useRef, useState } from 'react'
import {
  clearSttModelCache,
  transcribe as realTranscribe,
  type SttResult,
} from '@/lib/capture/on-device-stt'
import {
  isRecordingSupported,
  startRecording as realStart,
  type CaptureError,
  type Recording,
} from '@/lib/capture/audio-capture'

const CONSENT_KEY = 'lk_voice_consent_v1'
const primaryBtn =
  'inline-flex min-h-[48px] items-center justify-center rounded-full bg-family-500 px-5 text-base font-semibold text-white disabled:opacity-50'
const ghostBtn =
  'inline-flex min-h-[48px] items-center rounded-full border border-haze px-4 text-base font-medium text-ink-primary'

export interface VoiceDeps {
  isSupported: () => boolean
  startRecording: (
    onAutoStop?: () => void,
  ) => Promise<{ ok: true; recording: Recording } | { ok: false; error: CaptureError }>
  transcribe: (audio: Float32Array) => Promise<SttResult>
  clearModel: () => Promise<void>
}

const realDeps: VoiceDeps = {
  isSupported: isRecordingSupported,
  startRecording: realStart,
  transcribe: realTranscribe,
  clearModel: clearSttModelCache,
}

/** Voice is off until the owner turns it on for a deployment (NEXT_PUBLIC_ON_DEVICE_VOICE=on). */
export function voiceEnabled(): boolean {
  return process.env['NEXT_PUBLIC_ON_DEVICE_VOICE'] === 'on'
}

function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === 'yes'
  } catch {
    return false
  }
}
function setConsent(on: boolean): void {
  try {
    if (on) localStorage.setItem(CONSENT_KEY, 'yes')
    else localStorage.removeItem(CONSENT_KEY)
  } catch {
    // Storage can be blocked; consent is then asked again next time.
  }
}

const ERRORS: Record<CaptureError, string> = {
  denied:
    'The microphone is turned off for this site. You can turn it on in your browser settings, or type instead.',
  busy: 'The microphone is being used by something else. Close that and try again, or type instead.',
  unsupported: 'This browser cannot record your voice. You can type instead.',
  failed: 'We could not start the microphone. You can type instead.',
}

type Phase = 'idle' | 'consent' | 'listening' | 'working'

/**
 * Say it instead of typing it. The voice becomes words on this phone and goes
 * nowhere else; the words land in the box for the person to check and edit.
 */
export function VoiceInput({
  onText,
  deps = realDeps,
  enabled = voiceEnabled(),
}: {
  onText: (text: string) => void
  deps?: VoiceDeps
  enabled?: boolean
}) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [consented, setConsented] = useState(hasConsent)
  const rec = useRef<Recording | null>(null)
  if (!enabled || !deps.isSupported()) return null

  async function begin() {
    setMessage(null)
    const r = await deps.startRecording(() => void finish())
    if (!r.ok) {
      setMessage(ERRORS[r.error])
      setPhase('idle')
      return
    }
    rec.current = r.recording
    setPhase('listening')
  }

  async function finish() {
    const r = rec.current
    if (!r) return
    rec.current = null
    setPhase('working')
    const audio = await r.stop().catch(() => null)
    if (!audio) {
      setMessage('We could not read the recording. You can type instead.')
      setPhase('idle')
      return
    }
    const out = await deps.transcribe(audio)
    setPhase('idle')
    if (out.ok) {
      onText(out.text)
      setMessage('Check the words below, then tap "Show me what you understood".')
    } else if (out.reason === 'empty') {
      setMessage('We did not catch any words. Try again, or type instead.')
    } else {
      setMessage('The speech model could not run on this phone. You can type instead.')
    }
  }

  function cancel() {
    rec.current?.cancel()
    rec.current = null
    setPhase('idle')
  }

  return (
    <div className="space-y-2">
      {phase === 'idle' && (
        <button
          type="button"
          className={ghostBtn}
          onClick={() => (consented ? void begin() : setPhase('consent'))}
        >
          Say it
        </button>
      )}

      {phase === 'consent' && (
        <div
          role="group"
          aria-label="Turn your voice into words on this phone"
          className="space-y-2"
        >
          <p className="text-base text-ink-primary">
            Your voice is turned into words on this phone and never leaves it. The first time, a
            small speech model (about 40 MB) downloads from huggingface.co. That download carries
            nothing you say.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryBtn}
              onClick={() => {
                setConsent(true)
                setConsented(true)
                void begin()
              }}
            >
              Download and start
            </button>
            <button type="button" className={ghostBtn} onClick={() => setPhase('idle')}>
              Not now
            </button>
          </div>
        </div>
      )}

      {phase === 'listening' && (
        <div className="space-y-2">
          <p role="status" className="text-base text-ink-primary">
            Listening. Tap Stop when you have finished.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} onClick={() => void finish()}>
              Stop
            </button>
            <button type="button" className={ghostBtn} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'working' && (
        <p role="status" className="text-base text-ink-primary">
          Turning your voice into words on this phone. The first time can take a minute.
        </p>
      )}

      {message && phase === 'idle' && (
        <p role="status" className="text-base text-ink-secondary">
          {message}
        </p>
      )}

      {consented && phase === 'idle' && (
        <button
          type="button"
          className="inline-flex min-h-[48px] items-center text-base text-ink-secondary underline"
          onClick={async () => {
            await deps.clearModel()
            setConsent(false)
            setConsented(false)
            setMessage('The speech model was removed from this phone.')
          }}
        >
          Remove the speech model from this phone
        </button>
      )}
    </div>
  )
}
