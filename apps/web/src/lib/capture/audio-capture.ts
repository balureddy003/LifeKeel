/**
 * Records a short clip from the microphone as 16 kHz mono samples for the
 * on-device speech model. The audio exists only in memory: nothing is uploaded
 * or stored, the microphone is released as soon as recording stops, and the
 * buffers are dropped once the text has been made.
 */
import { STT_MAX_SECONDS, STT_SAMPLE_RATE } from './on-device-stt'

export interface Recording {
  /** Stop and return the audio. Releases the microphone. */
  stop(): Promise<Float32Array>
  /** Stop and throw the audio away. */
  cancel(): void
}

export type CaptureError = 'unsupported' | 'denied' | 'busy' | 'failed'

export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined'
  )
}

/** Resample decoded audio to 16 kHz mono, which is what the model reads. */
export async function toModelAudio(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(buffer.duration * STT_SAMPLE_RATE))
  const ctx = new OfflineAudioContext(1, length, STT_SAMPLE_RATE)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start()
  const rendered = await ctx.startRendering()
  return rendered.getChannelData(0).slice()
}

export async function startRecording(
  onAutoStop?: () => void,
): Promise<{ ok: true; recording: Recording } | { ok: false; error: CaptureError }> {
  if (!isRecordingSupported()) return { ok: false, error: 'unsupported' }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
  } catch (e) {
    const name = (e as { name?: string }).name
    return {
      ok: false,
      error:
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotReadableError'
            ? 'busy'
            : 'failed',
    }
  }

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream)
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }
  const release = () => stream.getTracks().forEach((t) => t.stop())
  const done = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })
  recorder.start()
  const timer = setTimeout(() => {
    if (recorder.state === 'recording') {
      recorder.stop()
      onAutoStop?.()
    }
  }, STT_MAX_SECONDS * 1000)

  return {
    ok: true,
    recording: {
      async stop() {
        clearTimeout(timer)
        if (recorder.state === 'recording') recorder.stop()
        await done
        release()
        const blob = new Blob(chunks, { type: recorder.mimeType })
        chunks.length = 0
        const ctx = new AudioContext()
        try {
          const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
          return await toModelAudio(decoded)
        } finally {
          void ctx.close()
        }
      },
      cancel() {
        clearTimeout(timer)
        recorder.ondataavailable = null
        if (recorder.state === 'recording') recorder.stop()
        chunks.length = 0
        release()
      },
    },
  }
}
