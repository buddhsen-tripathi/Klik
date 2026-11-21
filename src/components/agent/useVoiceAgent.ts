import { useCallback, useEffect, useRef, useState } from 'react'
import { liveToken } from '../../api'
import { buildInstructions, runTool, TOOLS, vocabulary, type AgentActions, type AgentSnapshot } from './agentTools'
import { createAudio, type AudioIO } from './audio'
import { LiveSession } from './liveSession'

export type AgentStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'
export interface Line {
  who: 'you' | 'agent'
  text: string
}

const VOICE = 'Puck'
const HISTORY = 6

const TOOL_LABEL: Record<string, string> = {
  go_to_step: '→ Changing step',
  next_step: '→ Next step',
  previous_step: '← Previous step',
  set_mode: '⇄ Switching mode',
  show_part: '🔎 Showing the part',
  set_view: '🧊 Changing the view',
  hands_free: '📷 Hands-free',
  check_progress: '📸 Opening the progress check',
  fix_plan: '🛠 Fix plan',
  search_web: '🌐 Searching the web…',
  new_scan: '📷 New scan',
}

/**
 * Voice agent on Gemini Live: you talk, it talks back and drives the app through tools.
 * `snapshot()` is read fresh for every tool call, so the agent always acts on what's on screen.
 */
export function useVoiceAgent(snapshot: () => AgentSnapshot, actions: AgentActions) {
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [lines, setLines] = useState<Line[]>([])
  const [activity, setActivity] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const io = useRef<{ audio: AudioIO | null; session: LiveSession | null; turn: 'you' | 'agent' | null }>({ audio: null, session: null, turn: null })
  const latest = useRef({ snapshot, actions })
  useEffect(() => {
    latest.current = { snapshot, actions }
  })

  /** Live captions: append streaming text to the current speaker's line (a new speaker starts a new line). */
  const linesRef = useRef<Line[]>([])
  const caption = useCallback((who: Line['who'], text: string) => {
    const ls = linesRef.current
    const continuing = io.current.turn === who && ls.length > 0 && ls[ls.length - 1].who === who
    io.current.turn = who
    const next = continuing ? [...ls.slice(0, -1), { who, text: ls[ls.length - 1].text + text }] : [...ls, { who, text: text.trimStart() }]
    linesRef.current = next.slice(-HISTORY)
    setLines(linesRef.current)
  }, [])

  const stop = useCallback(() => {
    io.current.session?.close()
    io.current.audio?.close()
    io.current = { audio: null, session: null, turn: null }
    setStatus('idle')
    setActivity(null)
  }, [])

  /** Call from a tap: iOS only allows audio + mic from a user gesture. */
  const start = useCallback(async () => {
    if (io.current.session) return
    setError(null)
    setStatus('connecting')
    try {
      const audio = await createAudio()
      io.current.audio = audio
      const { token, model } = await liveToken()
      const snap = latest.current.snapshot()
      const session = new LiveSession(
        token,
        { model, systemInstruction: buildInstructions(snap), tools: TOOLS, voice: VOICE, vocabulary: vocabulary(snap.analysis) },
        {
          onReady: () => {
            if (io.current.session !== session) return
            setStatus('listening')
            if (!audio.ctx.state.startsWith('run')) void audio.ctx.resume()
            audio.startMic((b64, mime) => session.sendAudio(b64, mime)).catch((err) => {
              setError(err?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it for this site, or type below.' : 'Microphone unavailable. You can type below.')
            })
            // Greet so the user knows it's listening.
            session.sendContext('[App] The user just opened the voice helper. Greet them in a few words and say where they are in the guide.', true)
          },
          onAudio: (b64) => {
            audio.play(b64)
            setStatus('speaking')
          },
          onUserText: (t) => {
            caption('you', t)
            setStatus((s) => (s === 'speaking' ? s : 'thinking'))
          },
          onAgentText: (t) => caption('agent', t),
          onInterrupted: () => {
            audio.flush()
            setStatus('listening')
          },
          onTurnComplete: () => {
            setActivity(null)
            io.current.turn = null // next words start a new caption bubble
            // Let queued audio finish before showing "listening".
            const settle = () => (audio.speaking() ? setTimeout(settle, 200) : setStatus((s) => (s === 'error' || s === 'idle' ? s : 'listening')))
            settle()
          },
          onToolCall: async (calls) => {
            const responses = []
            for (const call of calls) {
              setActivity(TOOL_LABEL[call.name] ?? call.name)
              let response: object
              try {
                response = await runTool(call.name, call.args ?? {}, latest.current.snapshot(), latest.current.actions)
              } catch (err) {
                response = { ok: false, error: String((err as Error)?.message ?? err) }
              }
              responses.push({ id: call.id, name: call.name, response })
            }
            session.sendToolResponses(responses)
          },
          onClose: (reason, unexpected) => {
            if (io.current.session !== session) return
            audio.close()
            io.current = { audio: null, session: null, turn: null }
            setStatus(unexpected ? 'error' : 'idle')
            if (unexpected) setError(`Voice session ended: ${reason}`)
          },
        },
      )
      io.current.session = session
      session.connect()
    } catch (err) {
      io.current.audio?.close()
      io.current = { audio: null, session: null, turn: null }
      setStatus('error')
      setError((err as Error).message || 'Could not start the voice helper')
    }
  }, [caption])

  useEffect(() => stop, [stop])

  return {
    status,
    lines,
    activity,
    error,
    active: status !== 'idle' && status !== 'error',
    start,
    stop,
    /** Typed instead of spoken. */
    sendText: (text: string) => {
      caption('you', text)
      io.current.turn = null
      io.current.session?.sendText(text)
      setStatus('thinking')
    },
    /** App events: silent context, or `respond` to have the agent speak about it. */
    notify: (text: string, respond = false) => {
      if (respond) io.current.turn = null
      io.current.session?.sendContext(text, respond)
    },
    levels: () => io.current.audio?.levels() ?? { mic: 0, out: 0 },
  }
}

export type VoiceAgent = ReturnType<typeof useVoiceAgent>
