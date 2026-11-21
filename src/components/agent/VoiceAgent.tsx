import { useEffect, useRef, useState } from 'react'
import type { VoiceAgent as Agent } from './useVoiceAgent'
import './VoiceAgent.css'

const STATUS: Record<Agent['status'], string> = {
  idle: 'Ask me anything',
  connecting: 'Connecting…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  error: 'Voice helper stopped',
}

/**
 * Floating voice helper: tap the orb and talk ("next", "which screw is this?", "I think I
 * messed up the wheels"). Live captions show what it heard and what it says.
 */
export default function VoiceAgent({ agent, coach = false, onEnd }: { agent: Agent; coach?: boolean; onEnd?: () => void }) {
  const orb = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')
  const captions = useRef<HTMLDivElement>(null)

  // Orb pulses with whoever is talking. Written straight to a CSS variable: no re-renders per frame.
  useEffect(() => {
    if (!agent.active) return
    let raf = 0
    let smooth = 0
    const tick = () => {
      const { mic, out } = agent.levels()
      smooth += (Math.max(mic, out) - smooth) * 0.3
      orb.current?.style.setProperty('--level', smooth.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [agent.active, agent])

  useEffect(() => {
    captions.current?.scrollTo({ top: captions.current.scrollHeight })
  }, [agent.lines])

  const open = agent.active || agent.status === 'error'

  if (!open) {
    return (
      <button className="agent-fab" onClick={() => void agent.start()} aria-label="Talk to the helper">
        <span className="agent-fab-icon" aria-hidden>
          🎙️
        </span>
        <span>Ask</span>
      </button>
    )
  }

  return (
    <section className={`agent-panel ${agent.status}`} aria-label="Voice helper" aria-live="polite">
      <div className="agent-top">
        <button ref={orb} className="agent-orb" aria-label="Voice helper" onClick={agent.status === 'error' ? () => void agent.start() : undefined}>
          <span />
        </button>
        <div className="agent-status">
          <strong>
            {coach && <span className="agent-live">LIVE</span>}
            {coach && agent.status === 'listening' ? 'Watching' : STATUS[agent.status]}
          </strong>
          {agent.activity && <small>{agent.activity}</small>}
          {!agent.activity && agent.status === 'listening' && (
            <small>{coach ? 'Just work. I’ll speak up if something’s off. Ask me anything.' : 'Try “next”, “which screw?” or “I think I got step 3 wrong”'}</small>
          )}
        </div>
        <button className="btn ghost small" onClick={onEnd ?? agent.stop}>
          End
        </button>
      </div>

      {agent.lines.length > 0 && (
        <div className="agent-captions" ref={captions}>
          {agent.lines.map((l, i) => (
            <p key={i} className={l.who}>
              {l.text}
            </p>
          ))}
        </div>
      )}
      {agent.error && (
        <p className="agent-error">
          {agent.error}{' '}
          {agent.status === 'error' && (
            <button className="link-btn" onClick={() => void agent.start()}>
              Try again
            </button>
          )}
        </p>
      )}

      {agent.active && (
        <form
          className="agent-type"
          onSubmit={(e) => {
            e.preventDefault()
            if (!typed.trim()) return
            agent.sendText(typed.trim())
            setTyped('')
          }}
        >
          <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type…" enterKeyHint="send" />
        </form>
      )}
    </section>
  )
}
