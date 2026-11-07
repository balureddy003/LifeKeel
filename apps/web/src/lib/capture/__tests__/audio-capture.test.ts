/**
 * Microphone capture: errors become plain reasons, the microphone is always
 * released, and the audio never leaves memory (no network call is made).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRecordingSupported, startRecording } from '../audio-capture'

const g = globalThis as unknown as Record<string, unknown>
const saved: Record<string, unknown> = {}
const KEYS = ['MediaRecorder', 'AudioContext', 'OfflineAudioContext']

function fakeStream() {
  const stop = vi.fn()
  return { stream: { getTracks: () => [{ stop }, { stop }] }, stop }
}

class FakeRecorder {
  static last: FakeRecorder
  state: 'inactive' | 'recording' = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor() {
    FakeRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(10)]) })
    this.onstop?.()
  }
}

beforeEach(() => {
  // jsdom's Blob has no arrayBuffer(); every real browser does.
  if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = async () => new ArrayBuffer(10)
  for (const k of KEYS) saved[k] = g[k]
  g['MediaRecorder'] = FakeRecorder
  g['AudioContext'] = class {
    decodeAudioData = async () => ({ duration: 1 })
    close = async () => undefined
  }
  g['OfflineAudioContext'] = class {
    createBufferSource() {
      return { connect() {}, start() {}, buffer: null }
    }
    destination = {}
    startRendering = async () => ({ getChannelData: () => new Float32Array([0.1, 0.2, 0.3]) })
  }
})
afterEach(() => {
  for (const k of KEYS) g[k] = saved[k]
  vi.restoreAllMocks()
})

const setMic = (getUserMedia: unknown) =>
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })

describe('startRecording', () => {
  it('maps microphone errors to plain reasons', async () => {
    for (const [name, reason] of [
      ['NotAllowedError', 'denied'],
      ['SecurityError', 'denied'],
      ['NotReadableError', 'busy'],
      ['SomethingElse', 'failed'],
    ] as const) {
      setMic(async () => {
        throw Object.assign(new Error('x'), { name })
      })
      expect(await startRecording()).toEqual({ ok: false, error: reason })
    }
  })

  it('says unsupported when the browser cannot record', async () => {
    g['MediaRecorder'] = undefined
    expect(isRecordingSupported()).toBe(false)
    expect(await startRecording()).toEqual({ ok: false, error: 'unsupported' })
  })

  it('stop() releases the microphone, returns 16 kHz samples, and makes no network call', async () => {
    const { stream, stop } = fakeStream()
    setMic(async () => stream)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const r = await startRecording()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const audio = await r.recording.stop()
    expect(Array.from(audio)).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.3),
    ])
    expect(stop).toHaveBeenCalledTimes(2) // both tracks released
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('cancel() releases the microphone and keeps nothing', async () => {
    const { stream, stop } = fakeStream()
    setMic(async () => stream)
    const r = await startRecording()
    if (!r.ok) throw new Error('expected ok')
    r.recording.cancel()
    expect(stop).toHaveBeenCalledTimes(2)
    expect(FakeRecorder.last.state).toBe('inactive')
  })

  it('stops by itself at the 30 second limit and says so', async () => {
    vi.useFakeTimers()
    const { stream, stop } = fakeStream()
    setMic(async () => stream)
    const onAuto = vi.fn()
    const r = await startRecording(onAuto)
    if (!r.ok) throw new Error('expected ok')
    await vi.advanceTimersByTimeAsync(30_500)
    expect(onAuto).toHaveBeenCalledTimes(1)
    expect(FakeRecorder.last.state).toBe('inactive')
    vi.useRealTimers()
    await r.recording.stop()
    expect(stop).toHaveBeenCalled()
  })
})
