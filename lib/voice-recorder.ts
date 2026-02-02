/**
 * Voice recording for desktop and mobile (Chrome, Safari, Firefox, iOS, Android).
 * Prefers lossless WAV via AudioContext; falls back to MediaRecorder (webm/opus)
 * when WAV path fails (e.g. iOS Safari, some Android).
 */

const SAMPLE_RATE = 44100
const NUM_CHANNELS = 1
const BUFFER_SIZE = 4096

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16
}

function createWavHeader(dataLength: number): ArrayBuffer {
  const header = new ArrayBuffer(44)
  const view = new DataView(header)
  const byteRate = SAMPLE_RATE * NUM_CHANNELS * 2
  const blockAlign = NUM_CHANNELS * 2

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, NUM_CHANNELS, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, dataLength, true)
  return header
}

/** Get best MediaRecorder mime type for the current browser */
function getMediaRecorderMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export interface VoiceRecorderCallbacks {
  onStart?: () => void
  onStop?: (blob: Blob) => void
  onError?: (err: Error) => void
}

export class VoiceRecorder {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private chunks: Int16Array[] = []
  private useMediaRecorder = false
  private mediaRecorder: MediaRecorder | null = null
  private mediaRecorderChunks: Blob[] = []
  private callbacks: VoiceRecorderCallbacks

  constructor(callbacks: VoiceRecorderCallbacks = {}) {
    this.callbacks = callbacks
  }

  /**
   * Request microphone with permissive constraints for desktop and mobile.
   * Avoids "Requested device not found" by not asking for specific devices.
   */
  private async getAudioStream(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      const msg =
        typeof navigator.mediaDevices === 'undefined'
          ? 'Microphone not supported in this browser.'
          : 'Microphone access requires a secure connection (HTTPS).'
      throw new Error(msg)
    }

    // Minimal constraints: use default mic, no deviceId (works on iOS, Android, desktop).
    // Avoid requesting echoCancellation/noiseSuppression so older devices don't fail.
    const constraints: MediaStreamConstraints = { audio: true }

    try {
      return await navigator.mediaDevices.getUserMedia(constraints)
    } catch (e) {
      const err = e as DOMException
      if (err.name === 'NotFoundError' || err.message?.includes('device not found')) {
        throw new Error(
          'No microphone found. Connect a mic or allow microphone access in your browser or device settings. On mobile, use HTTPS and allow the site to use the microphone.'
        )
      }
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Microphone access was denied. Please allow microphone permission and try again.')
      }
      if (err.name === 'NotReadableError') {
        throw new Error('Microphone is in use by another app. Close other apps using the mic and try again.')
      }
      throw e
    }
  }

  async start(): Promise<void> {
    try {
      this.stream = await this.getAudioStream()
      const stream = this.stream

      // Try WAV path first (AudioContext + ScriptProcessor)
      const AudioContextClass =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) {
        this.startMediaRecorderFallback(stream)
        this.callbacks.onStart?.()
        return
      }

      this.context = new AudioContextClass()

      // iOS: AudioContext starts suspended; must resume after user gesture
      if (this.context.state === 'suspended') {
        await this.context.resume()
      }

      // ScriptProcessorNode is deprecated but widely supported; use it for WAV
      if (typeof this.context.createScriptProcessor !== 'function') {
        this.context.close()
        this.context = null
        this.startMediaRecorderFallback(stream)
        this.callbacks.onStart?.()
        return
      }

      const source = this.context.createMediaStreamSource(stream)
      this.source = source
      const processor = this.context.createScriptProcessor(BUFFER_SIZE, 1, 1)
      this.processor = processor
      this.chunks = []

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!this.chunks) return
        const input = e.inputBuffer.getChannelData(0)
        this.chunks.push(float32ToInt16(input))
      }
      source.connect(processor)
      processor.connect(this.context.destination)
      this.callbacks.onStart?.()
    } catch (err) {
      // If we already have a stream but WAV path failed, try MediaRecorder
      if (this.stream && !this.useMediaRecorder) {
        try {
          this.startMediaRecorderFallback(this.stream)
          this.callbacks.onStart?.()
          return
        } catch {
          // fall through to rethrow original or new error
        }
      }
      this.callbacks.onError?.(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  private startMediaRecorderFallback(stream: MediaStream): void {
    this.useMediaRecorder = true
    this.mediaRecorderChunks = []
    const mimeType = getMediaRecorderMimeType()
    const options = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 }
    const recorder = new MediaRecorder(stream, options)
    this.mediaRecorder = recorder
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.mediaRecorderChunks.push(e.data)
    }
    recorder.start(100)
  }

  /** Returns a promise that resolves with the recorded audio blob (WAV or webm). */
  stop(): Promise<Blob> {
    if (this.useMediaRecorder && this.mediaRecorder) {
      return this.stopMediaRecorder()
    }
    return Promise.resolve(this.stopWav())
  }

  private stopMediaRecorder(): Promise<Blob> {
    const recorder = this.mediaRecorder
    if (!recorder || recorder.state === 'inactive') {
      throw new Error('Recorder not started')
    }
    return new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null
        this.mediaRecorder = null
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(this.mediaRecorderChunks, { type: mimeType })
        this.mediaRecorderChunks = []
        this.callbacks.onStop?.(blob)
        resolve(blob)
      }
      recorder.onerror = () => reject(new Error('MediaRecorder failed'))
      recorder.stop()
    })
  }

  private stopWav(): Blob {
    if (!this.processor || !this.source || !this.context) {
      throw new Error('Recorder not started')
    }
    this.processor.disconnect()
    this.source.disconnect()
    this.context.close()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.processor = null
    this.source = null
    this.context = null

    const totalLength = this.chunks.reduce((acc, c) => acc + c.length, 0)
    const pcm = new Int16Array(totalLength)
    let offset = 0
    for (const chunk of this.chunks) {
      pcm.set(chunk, offset)
      offset += chunk.length
    }
    this.chunks = []

    const dataLength = pcm.length * 2
    const header = createWavHeader(dataLength)
    const blob = new Blob([header, pcm.buffer], { type: 'audio/wav' })
    this.callbacks.onStop?.(blob)
    return blob
  }

  get isRecording(): boolean {
    return this.stream != null
  }
}
