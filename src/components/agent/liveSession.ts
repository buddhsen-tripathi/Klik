/**
 * Thin client for the Gemini Live API over a raw WebSocket (no SDK, keeps the bundle small).
 * The browser connects straight to Gemini with a single-use token from our Worker.
 * Docs: https://aistudio.google.com/docs/live-api/get-started-websocket
 */

const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained'

export interface FunctionCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface FunctionDeclaration {
  name: string
  description: string
  parameters?: object
  behavior?: 'BLOCKING' | 'NON_BLOCKING'
}

export interface LiveEvents {
  onReady(): void
  onAudio(b64: string): void
  /** Live captions: what the user is saying, and what the agent is saying. */
  onUserText(text: string): void
  onAgentText(text: string): void
  onToolCall(calls: FunctionCall[]): void
  /** The user talked over the agent: stop playback. */
  onInterrupted(): void
  onTurnComplete(): void
  onClose(reason: string, unexpected: boolean): void
}

export interface LiveSetup {
  model: string
  systemInstruction: string
  tools: FunctionDeclaration[]
  voice: string
  /** Part names etc., so dictation spells them right. */
  vocabulary: string[]
}

export class LiveSession {
  private ws: WebSocket | null = null
  private resumeHandle: string | null = null
  private closing = false

  private token: string
  private setup: LiveSetup
  private events: LiveEvents

  constructor(token: string, setup: LiveSetup, events: LiveEvents) {
    this.token = token
    this.setup = setup
    this.events = events
  }

  connect() {
    this.closing = false
    const ws = new WebSocket(`${WS_URL}?access_token=${encodeURIComponent(this.token)}`)
    this.ws = ws
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          setup: {
            model: `models/${this.setup.model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.setup.voice } } },
            },
            systemInstruction: { parts: [{ text: this.setup.systemInstruction }] },
            tools: [{ functionDeclarations: this.setup.tools }],
            inputAudioTranscription: this.setup.vocabulary.length ? { customVocabulary: this.setup.vocabulary.slice(0, 100) } : {},
            outputAudioTranscription: {},
            // Long sessions: drop the oldest turns instead of hitting the context limit, and let us
            // reconnect seamlessly when the server rotates the connection (GoAway).
            contextWindowCompression: { slidingWindow: {} },
            sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {},
          },
        }),
      )
    }
    ws.onmessage = async (e) => {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : await (e.data as Blob).text())
      if (msg.setupComplete) this.events.onReady()
      if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) this.resumeHandle = msg.sessionResumptionUpdate.newHandle
      if (msg.goAway) this.reconnect()
      if (msg.toolCall?.functionCalls?.length) this.events.onToolCall(msg.toolCall.functionCalls)
      const sc = msg.serverContent
      if (!sc) return
      if (sc.interrupted) this.events.onInterrupted()
      for (const part of sc.modelTurn?.parts ?? []) if (part.inlineData?.data) this.events.onAudio(part.inlineData.data)
      if (sc.inputTranscription?.text) this.events.onUserText(sc.inputTranscription.text)
      if (sc.outputTranscription?.text) this.events.onAgentText(sc.outputTranscription.text)
      if (sc.turnComplete) this.events.onTurnComplete()
    }
    ws.onclose = (e) => {
      if (this.ws !== ws) return // replaced by a reconnect
      this.events.onClose(e.reason || `closed (${e.code})`, !this.closing)
    }
  }

  /** Server is about to drop the connection: open a new one that resumes the same conversation. */
  private reconnect() {
    const old = this.ws
    this.ws = null
    old?.close()
    this.connect()
  }

  get open() {
    return this.ws?.readyState === WebSocket.OPEN
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  sendAudio(b64: string, mimeType: string) {
    this.send({ realtimeInput: { audio: { data: b64, mimeType } } })
  }

  /** Typed message from the user (same as speaking it). */
  sendText(text: string) {
    this.send({ realtimeInput: { text } })
  }

  /** A camera frame, so the agent can see what the user is pointing at. */
  sendImage(b64: string, mimeType = 'image/jpeg') {
    this.send({ realtimeInput: { video: { data: b64, mimeType } } })
  }

  /**
   * App events the agent should know about. `respond` = it should say something now
   * (e.g. a progress check finished); otherwise it's silent context (e.g. the user tapped Next).
   */
  sendContext(text: string, respond: boolean) {
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: respond } })
  }

  sendToolResponses(responses: { id: string; name: string; response: object }[]) {
    this.send({ toolResponse: { functionResponses: responses } })
  }

  close() {
    this.closing = true
    this.ws?.close()
    this.ws = null
  }
}
