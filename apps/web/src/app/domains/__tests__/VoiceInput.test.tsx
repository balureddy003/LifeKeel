/**
 * Say it: off by default, asks once before downloading a model, keeps the voice
 * on the phone, puts the words in the box for the person to check, and can
 * always be skipped or undone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import { VoiceInput, type VoiceDeps } from '../VoiceInput'

function deps(
  over: Partial<VoiceDeps> = {},
): VoiceDeps & { recording: { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } } {
  const recording = { stop: vi.fn(async () => new Float32Array(16000)), cancel: vi.fn() }
  return {
    isSupported: () => true,
    startRecording: vi.fn(async () => ({ ok: true as const, recording })),
    transcribe: vi.fn(async () => ({ ok: true as const, text: 'MOT due 9 May' })),
    clearModel: vi.fn(async () => undefined),
    ...over,
    recording,
  }
}

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('the tester preview switch', () => {
  afterEach(() => window.history.pushState({}, '', '/'))

  it('is off by default, turns on with ?voice=on, is remembered on that device, and turns off with ?voice=off', () => {
    const { container, unmount } = render(<VoiceInput onText={() => {}} deps={deps()} />)
    expect(container.textContent).toBe('')
    unmount()

    window.history.pushState({}, '', '/domains?d=car&voice=on')
    const on = render(<VoiceInput onText={() => {}} deps={deps()} />)
    expect(screen.getByRole('button', { name: 'Say it' })).toBeTruthy()
    on.unmount()

    window.history.pushState({}, '', '/domains?d=car') // no param: still remembered
    const again = render(<VoiceInput onText={() => {}} deps={deps()} />)
    expect(screen.getByRole('button', { name: 'Say it' })).toBeTruthy()
    again.unmount()

    window.history.pushState({}, '', '/domains?d=car&voice=off')
    const off = render(<VoiceInput onText={() => {}} deps={deps()} />)
    expect(off.container.textContent).toBe('')
  })

  it('never skips consent: the preview only shows the button', () => {
    window.history.pushState({}, '', '/domains?voice=on')
    const d = deps()
    render(<VoiceInput onText={() => {}} deps={d} />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    expect(screen.getByRole('group', { name: /Turn your voice into words/ })).toBeTruthy()
    expect(d.startRecording).not.toHaveBeenCalled()
  })

  it('still needs a browser that can record', () => {
    window.history.pushState({}, '', '/domains?voice=on')
    const { container } = render(
      <VoiceInput onText={() => {}} deps={deps({ isSupported: () => false })} />,
    )
    expect(container.textContent).toBe('')
  })
})

describe('VoiceInput', () => {
  it('is not shown when voice is off or the browser cannot record', () => {
    const { container, rerender } = render(
      <VoiceInput onText={() => {}} deps={deps()} enabled={false} />,
    )
    expect(container.textContent).toBe('')
    rerender(<VoiceInput onText={() => {}} deps={deps({ isSupported: () => false })} enabled />)
    expect(container.textContent).toBe('')
  })

  it('asks first, says where the voice goes and what downloads, and "Not now" starts nothing', () => {
    const d = deps()
    render(<VoiceInput onText={() => {}} deps={d} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    const group = screen.getByRole('group', { name: /Turn your voice into words on this phone/ })
    expect(group.textContent).toMatch(/never leaves it/)
    expect(group.textContent).toMatch(/40 MB/)
    expect(group.textContent).toMatch(/huggingface\.co/)
    expect(group.textContent).toMatch(/carries nothing you say/)
    expect(d.startRecording).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(d.startRecording).not.toHaveBeenCalled()
    expect(localStorage.getItem('lk_voice_consent_v1')).toBeNull()
  })

  it('records after consent, turns it into words in the box, and does not ask again', async () => {
    const d = deps()
    const onText = vi.fn()
    const { unmount } = render(<VoiceInput onText={onText} deps={d} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download and start' }))
    expect(await screen.findByText(/Listening/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(onText).toHaveBeenCalledWith('MOT due 9 May'))
    expect(d.recording.stop).toHaveBeenCalled()
    expect(await screen.findByText(/Check the words below/)).toBeTruthy()
    unmount()
    // A second visit goes straight to listening.
    const d2 = deps()
    render(<VoiceInput onText={() => {}} deps={d2} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    await waitFor(() => expect(d2.startRecording).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: /Turn your voice/ })).toBeNull()
  })

  it('Cancel throws the recording away and does not make words', async () => {
    const d = deps()
    const onText = vi.fn()
    localStorage.setItem('lk_voice_consent_v1', 'yes')
    render(<VoiceInput onText={onText} deps={d} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(d.recording.cancel).toHaveBeenCalled()
    expect(d.transcribe).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
  })

  it('says what to do when the microphone is blocked, busy, or nothing was heard', async () => {
    localStorage.setItem('lk_voice_consent_v1', 'yes')
    const denied = deps({
      startRecording: vi.fn(async () => ({ ok: false as const, error: 'denied' as const })),
    })
    const { unmount } = render(<VoiceInput onText={() => {}} deps={denied} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    expect(await screen.findByText(/microphone is turned off for this site/)).toBeTruthy()
    unmount()

    const quiet = deps({
      transcribe: vi.fn(async () => ({ ok: false as const, reason: 'empty' as const })),
    })
    render(<VoiceInput onText={() => {}} deps={quiet} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(await screen.findByText(/We did not catch any words/)).toBeTruthy()
  })

  it('says so, and offers typing, when the speech model cannot run', async () => {
    localStorage.setItem('lk_voice_consent_v1', 'yes')
    const broken = deps({
      transcribe: vi.fn(async () => ({ ok: false as const, reason: 'model' as const })),
    })
    render(<VoiceInput onText={() => {}} deps={broken} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(
      await screen.findByText(/speech model could not run on this phone. You can type instead/),
    ).toBeTruthy()
  })

  it('lets the person remove the downloaded model and withdraws consent', async () => {
    const d = deps()
    localStorage.setItem('lk_voice_consent_v1', 'yes')
    render(<VoiceInput onText={() => {}} deps={d} enabled />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove the speech model from this phone' }))
    await waitFor(() => expect(d.clearModel).toHaveBeenCalled())
    expect(localStorage.getItem('lk_voice_consent_v1')).toBeNull()
    expect(await screen.findByText(/model was removed from this phone/)).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Remove the speech model from this phone' }),
    ).toBeNull()
  })

  it('makes no network call of its own, and every control is at least 48px', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const d = deps()
    localStorage.setItem('lk_voice_consent_v1', 'yes')
    render(<VoiceInput onText={() => {}} deps={d} enabled />)
    for (const b of screen.getAllByRole('button')) expect(b.className).toContain('min-h-[48px]')
    fireEvent.click(screen.getByRole('button', { name: 'Say it' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(d.transcribe).toHaveBeenCalled())
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
