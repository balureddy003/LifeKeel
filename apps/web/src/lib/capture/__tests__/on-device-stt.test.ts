/**
 * On-device speech to text: the words come from a model that runs on the phone.
 * These tests use a fake model (the real one is a ~40 MB download) and check
 * everything around it: cleaning, timeouts, memoizing, unloading, and that a
 * failure always becomes a reason the caller can fall back from.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STT_MAX_SECONDS,
  STT_SAMPLE_RATE,
  __setSttLoaderForTests,
  normalizeSttOutput,
  transcribe,
  unloadSttModel,
} from '../on-device-stt'

const secs = (n: number) => new Float32Array(Math.round(n * STT_SAMPLE_RATE))

afterEach(() => {
  __setSttLoaderForTests(null)
  vi.useRealTimers()
})

describe('normalizeSttOutput', () => {
  it('reads an object, a list of chunks, and nothing', () => {
    expect(normalizeSttOutput({ text: ' MOT due 9 May ' })).toBe('MOT due 9 May')
    expect(normalizeSttOutput([{ text: 'MOT due' }, { text: '9 May' }])).toBe('MOT due 9 May')
    expect(normalizeSttOutput(undefined)).toBe('')
    expect(normalizeSttOutput({})).toBe('')
  })
  it('removes silence and noise markers', () => {
    expect(normalizeSttOutput({ text: '[BLANK_AUDIO]' })).toBe('')
    expect(normalizeSttOutput({ text: ' (music) MOT due 9 May [silence] ' })).toBe('MOT due 9 May')
  })
})

describe('transcribe', () => {
  it('returns the words from the model', async () => {
    __setSttLoaderForTests(async () => async () => ({ text: ' MOT due 9 May.' }))
    expect(await transcribe(secs(3))).toEqual({ ok: true, text: 'MOT due 9 May.' })
  })

  it('treats a very short clip as empty without loading anything', async () => {
    const loader = vi.fn(async () => async () => ({ text: 'x' }))
    __setSttLoaderForTests(loader)
    expect(await transcribe(secs(0.1))).toEqual({ ok: false, reason: 'empty' })
    expect(loader).not.toHaveBeenCalled()
  })

  it('treats silence as empty', async () => {
    __setSttLoaderForTests(async () => async () => ({ text: '[BLANK_AUDIO]' }))
    expect(await transcribe(secs(3))).toEqual({ ok: false, reason: 'empty' })
  })

  it('gives a reason, never an exception, when the model cannot load or throws', async () => {
    __setSttLoaderForTests(async () => null)
    expect(await transcribe(secs(3))).toEqual({ ok: false, reason: 'model' })
    __setSttLoaderForTests(async () => async () => {
      throw new Error('wasm failed')
    })
    expect(await transcribe(secs(3))).toEqual({ ok: false, reason: 'model' })
  })

  it('cuts a long clip to 30 seconds before it reaches the model', async () => {
    const seen: number[] = []
    __setSttLoaderForTests(async () => async (audio) => {
      seen.push(audio.length)
      return { text: 'ok' }
    })
    await transcribe(secs(45))
    expect(seen).toEqual([STT_MAX_SECONDS * STT_SAMPLE_RATE])
  })

  it('shares one load between concurrent calls, and retries after a failed load', async () => {
    let calls = 0
    __setSttLoaderForTests(async () => {
      calls++
      return calls === 1 ? null : async () => ({ text: 'second try' })
    })
    expect((await transcribe(secs(3))).ok).toBe(false)
    const [a, b] = await Promise.all([transcribe(secs(3)), transcribe(secs(3))])
    expect(a).toEqual({ ok: true, text: 'second try' })
    expect(b).toEqual({ ok: true, text: 'second try' })
    expect(calls).toBe(2) // one failed, one shared by both concurrent calls
  })

  it('does not bring a removed model back when it finishes downloading late', async () => {
    let release!: () => void
    __setSttLoaderForTests(
      () =>
        new Promise((resolve) => {
          release = () => resolve(async () => ({ text: 'late' }))
        }),
    )
    const pending = transcribe(secs(3))
    await Promise.resolve()
    unloadSttModel()
    release()
    expect(await pending).toEqual({ ok: false, reason: 'model' })
  })

  it('gives up on a model that hangs instead of freezing the page', async () => {
    vi.useFakeTimers()
    __setSttLoaderForTests(async () => () => new Promise(() => {}))
    const pending = transcribe(secs(3))
    await vi.advanceTimersByTimeAsync(61_000)
    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
  })
})
