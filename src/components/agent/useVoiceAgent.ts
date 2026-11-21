import { useCallback, useEffect, useRef, useState } from 'react'
import { liveToken } from '../../api'
import { buildInstructions, runTool, TOOLS, vocabulary, type AgentActions, type AgentSnapshot } from './agentTools'
import { createAudio, type AudioIO } from './audio'
import { LiveSession } from './liveSession'
import { createSessionLog, type SessionLog } from './telemetry'

export type AgentStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'
export interface Line {
  who: 'you' | 'agent'
  text: string
}

const VOICE = 'Puck'
const HISTORY = 6
/** Live coach: how often it takes an unprompted look, and how long to stay out of a conversation. */
const COACH_CHECK_MS = 9000
const COACH_QUIET_MS = 5000

const COACH_CHECK =
  '[App] Coach check (not the user speaking): look at the latest camera frames. If they are doing something wrong for the current step or something is unsafe, warn them in one short sentence with the fix. If they look stuck, give one tip. Otherwise call stay_quiet and say nothing.'

const cleanCaption = (t: string) =>
  t
    .replace(/<no speech>|\{pause\}/gi, '')
    .replace(/<[a-z ]*$/i, '')
    .trim()

const blobToBase64 = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(b)
  })

const TOOL_LABEL: Record<string, string> = {
  go_to_step: 'Changing step',
  next_step: 'Next step',
  previous_step: 'Previous step',
  set_mode: 'Switching mode',
  show_part: 'Showing the part',
  set_view: 'Changing the view',
  live_coach: 'Live coach',
  check_progress: 'Checking your build…',
  fix_plan: 'Fix plan',
  search_web: 'Searching the web…',
  new_scan: 'New scan',
  report_step_problem: 'Saving that for this step',
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
  /** Last time anyone spoke or the agent was busy, so coach checks never cut into a conversation. */
  const lastTalk = useRef(0)
  /** Last camera frame sent; coach checks only run while frames are actually arriving. */
  const lastFrameAt = useRef(0)
  /** Clonvo Traces: this session's turns and tool calls (see telemetry.ts). */
  const log = useRef<{ session: SessionLog | null; turnStart: number; heard: string; said: string; model: string; frames: number; checks: number }>({
    session: null,
    turnStart: 0,
    heard: '',
    said: '',
    model: '',
    frames: 0,
    checks: 0,
  })
  const flushLog = useCallback((reason: string) => {
    const l = log.current
    l.session?.flush({ 'gen_ai.request.model': l.model, coach: latest.current.snapshot().coach, frames_sent: l.frames, coach_checks: l.checks, end_reason: reason })
    l.session = null
  }, [])
  const logTurn = useCallback(() => {
    const l = log.current
    if (!l.session || (!l.heard && !l.said)) return
    l.session.event({
      name: l.heard.startsWith('[App] Coach check') ? 'coach check' : l.heard.startsWith('[App]') ? 'app event' : 'voice turn',
      start: l.turnStart || Date.now(),
      end: Date.now(),
      attributes: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.system': 'gemini',
        'gen_ai.request.model': l.model,
        'input.value': l.heard.slice(0, 2000),
        'output.value': cleanCaption(l.said).slice(0, 2000),
      },
    })
    l.turnStart = 0
    l.heard = ''
    l.said = ''
  }, [])
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
    // Hide the model's silence markers ("<no speech>{pause}") when the coach decides to stay quiet.
    setLines(linesRef.current.map((l) => ({ ...l, text: cleanCaption(l.text) })).filter((l) => l.text))
  }, [])

  const stop = useCallback(() => {
    flushLog('ended by user')
    io.current.session?.close()
    io.current.audio?.close()
    io.current = { audio: null, session: null, turn: null }
    setStatus('idle')
    setActivity(null)
  }, [flushLog])

  /** Call from a tap: iOS only allows audio + mic from a user gesture. */
  const start = useCallback(async (greeting = 'The user just opened the voice helper. Greet them in a few words and say where they are in the guide.') => {
    if (io.current.session) return
    setError(null)
    setStatus('connecting')
    try {
      const audio = await createAudio()
      io.current.audio = audio
      const { token, model } = await liveToken()
      const snap = latest.current.snapshot()
      log.current = { session: createSessionLog(snap.scanId, snap.coach ? 'live coach session' : 'voice session'), turnStart: 0, heard: '', said: '', model, frames: 0, checks: 0 }
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
            log.current.heard = `[App] ${greeting}`
            log.current.turnStart = Date.now()
            session.sendContext(`[App] ${greeting}`, true)
          },
          onAudio: (b64) => {
            lastTalk.current = Date.now()
            log.current.turnStart ||= Date.now()
            audio.play(b64)
            setStatus('speaking')
          },
          onUserText: (t) => {
            lastTalk.current = Date.now()
            if (log.current.heard.startsWith('[App]')) logTurn()
            log.current.turnStart ||= Date.now()
            log.current.heard += t
            caption('you', t)
            setStatus((s) => (s === 'speaking' ? s : 'thinking'))
          },
          onAgentText: (t) => {
            log.current.said += t
            caption('agent', t)
          },
          onInterrupted: () => {
            audio.flush()
            setStatus('listening')
          },
          onTurnComplete: () => {
            logTurn()
            setActivity(null)
            io.current.turn = null // next words start a new caption bubble
            // Let queued audio finish before showing "listening".
            const settle = () => (audio.speaking() ? setTimeout(settle, 200) : setStatus((s) => (s === 'error' || s === 'idle' ? s : 'listening')))
            settle()
          },
          onToolCall: async (calls) => {
            const responses = []
            for (const call of calls) {
              if (call.name !== 'stay_quiet') setActivity(TOOL_LABEL[call.name] ?? call.name)
              let response: object
              const t0 = Date.now()
              try {
                response = await runTool(call.name, call.args ?? {}, latest.current.snapshot(), latest.current.actions)
              } catch (err) {
                response = { ok: false, error: String((err as Error)?.message ?? err) }
              }
              log.current.session?.event({
                name: `tool ${call.name}`,
                start: t0,
                end: Date.now(),
                ok: (response as { ok?: boolean }).ok !== false,
                attributes: {
                  'gen_ai.operation.name': 'execute_tool',
                  'gen_ai.tool.name': call.name,
                  'input.value': JSON.stringify(call.args ?? {}).slice(0, 2000),
                  'output.value': JSON.stringify(response).slice(0, 2000),
                },
              })
              responses.push({ id: call.id, name: call.name, response })
            }
            session.sendToolResponses(responses)
          },
          onClose: (reason, unexpected) => {
            if (io.current.session !== session) return
            logTurn()
            flushLog(unexpected ? `closed: ${reason}` : 'closed')
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
  }, [caption, flushLog, logTurn])

  useEffect(() => stop, [stop])
  // Closing the tab mid-session still reports it.
  useEffect(() => {
    const bye = () => flushLog('page closed')
    window.addEventListener('pagehide', bye)
    return () => window.removeEventListener('pagehide', bye)
  }, [flushLog])

  // Live coach: every few seconds, if nobody is talking, ask it to look at the camera and speak up only if needed.
  const live = status === 'listening' || status === 'speaking' || status === 'thinking'
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => {
      const session = io.current.session
      if (!session || !latest.current.snapshot().coach || document.hidden) return
      if (io.current.audio?.speaking() || Date.now() - lastTalk.current < COACH_QUIET_MS) return
      if (Date.now() - lastFrameAt.current > 4000) return // camera not live: nothing to look at
      lastTalk.current = Date.now()
      logTurn()
      log.current.checks++
      log.current.heard = COACH_CHECK
      log.current.turnStart = Date.now()
      session.sendContext(COACH_CHECK, true)
    }, COACH_CHECK_MS)
    return () => clearInterval(timer)
  }, [live, logTurn])

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
      logTurn()
      log.current.heard = text
      log.current.turnStart = Date.now()
      io.current.session?.sendText(text)
      setStatus('thinking')
    },
    /** App events: silent context, or `respond` to have the agent speak about it. */
    notify: (text: string, respond = false) => {
      if (respond) {
        io.current.turn = null
        logTurn()
        log.current.heard = text
        log.current.turnStart = Date.now()
      }
      io.current.session?.sendContext(text, respond)
    },
    levels: () => io.current.audio?.levels() ?? { mic: 0, out: 0 },
    /** Live coach: one camera frame (JPEG). */
    sendFrame: async (jpeg: Blob) => {
      if (!io.current.session) return
      lastFrameAt.current = Date.now()
      log.current.frames++
      io.current.session.sendImage(await blobToBase64(jpeg), jpeg.type || 'image/jpeg')
    },
  }
}

export type VoiceAgent = ReturnType<typeof useVoiceAgent>
