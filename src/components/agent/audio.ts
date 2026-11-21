/**
 * Audio plumbing for the voice agent (Gemini Live):
 * - mic → 16-bit PCM chunks (~100 ms) at the device rate (Gemini resamples; the rate goes in the MIME type)
 * - 24 kHz PCM from Gemini → gapless playback, stoppable instantly when the user interrupts
 * Both share one AudioContext, created from a tap so iOS lets it play.
 */

// Runs on the audio thread: Float32 frames → Int16 chunks.
const WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(Math.round(sampleRate / 10)); this.n = 0 }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff
      if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0)); this.n = 0 }
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCapture)
`

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const rms = (x: ArrayLike<number>, scale: number) => {
  let sum = 0
  for (let i = 0; i < x.length; i += 4) sum += (x[i] / scale) ** 2
  return Math.min(1, Math.sqrt(sum / Math.ceil(x.length / 4)) * 4)
}

export interface AudioIO {
  ctx: AudioContext
  /** Start sending mic audio; `onChunk` gets base64 PCM16 + its MIME type. */
  startMic(onChunk: (b64: string, mimeType: string) => void): Promise<void>
  /** Queue a 24 kHz PCM16 chunk from Gemini. */
  play(b64: string): void
  /** Stop speaking right now (user barged in). */
  flush(): void
  /** 0-1 loudness of the mic and of the agent, for the orb. */
  levels(): { mic: number; out: number }
  speaking(): boolean
  close(): void
}

/** Must be called from a tap (iOS needs a user gesture to start audio and ask for the mic). */
export async function createAudio(): Promise<AudioIO> {
  const ctx = new AudioContext()
  await ctx.resume()
  // iOS 16.4+: keep playback on the loudspeaker while the mic is open.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (session) session.type = 'play-and-record'

  let stream: MediaStream | null = null
  let node: AudioWorkletNode | null = null
  let micLevel = 0
  let outLevel = 0
  let nextTime = 0
  const sources = new Set<AudioBufferSourceNode>()
  const gain = ctx.createGain()
  gain.connect(ctx.destination)

  return {
    ctx,
    async startMic(onChunk) {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      })
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
      await ctx.audioWorklet.addModule(url)
      URL.revokeObjectURL(url)
      const src = ctx.createMediaStreamSource(stream)
      node = new AudioWorkletNode(ctx, 'pcm-capture')
      const mime = `audio/pcm;rate=${ctx.sampleRate}`
      node.port.onmessage = (e: MessageEvent<Int16Array>) => {
        micLevel = rms(e.data, 0x8000)
        onChunk(toBase64(new Uint8Array(e.data.buffer)), mime)
      }
      src.connect(node)
      // Keep the worklet pulled by the graph without making the mic audible.
      const sink = ctx.createGain()
      sink.gain.value = 0
      node.connect(sink).connect(ctx.destination)
    },
    play(b64) {
      const bin = atob(b64)
      const pcm = new Int16Array(bin.length / 2)
      for (let i = 0; i < pcm.length; i++) {
        const v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)
        pcm[i] = v >= 0x8000 ? v - 0x10000 : v
      }
      const buf = ctx.createBuffer(1, pcm.length, 24_000)
      const ch = buf.getChannelData(0)
      for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 0x8000
      outLevel = rms(pcm, 0x8000)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(gain)
      const at = Math.max(ctx.currentTime + 0.02, nextTime)
      src.start(at)
      nextTime = at + buf.duration
      sources.add(src)
      src.onended = () => {
        sources.delete(src)
        if (!sources.size) outLevel = 0
      }
    },
    flush() {
      for (const s of sources) s.stop()
      sources.clear()
      nextTime = 0
      outLevel = 0
    },
    levels: () => ({ mic: micLevel, out: sources.size ? outLevel : 0 }),
    speaking: () => sources.size > 0,
    close() {
      for (const s of sources) s.stop()
      stream?.getTracks().forEach((t) => t.stop())
      node?.disconnect()
      void ctx.close()
    },
  }
}
