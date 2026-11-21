import { Mic, Video } from 'lucide-react'
import type { VoiceAgent } from '../agent/useVoiceAgent'

/** Round helper buttons for the dock: talk to the helper, and the live coach (camera + voice). */
export default function AssistButtons({ agent, coach, canCoach, onCoach, onAsk }: { agent: VoiceAgent; coach: boolean; canCoach: boolean; onCoach: () => void; onAsk: () => void }) {
  const talking = agent.active && !coach
  return (
    <>
      <button className={`btn round ${talking ? 'primary live-pulse' : 'ghost'}`} onClick={onAsk} aria-pressed={talking} aria-label={talking ? 'End voice helper' : 'Ask the voice helper'} title="Ask (voice)">
        <Mic aria-hidden />
      </button>
      {canCoach && (
        <button className={`btn round ${coach ? 'primary live-pulse' : 'ghost'}`} onClick={onCoach} aria-pressed={coach} aria-label={coach ? 'End live coach' : 'Live coach'} title="Live coach: watches through the camera and talks you through it">
          <Video aria-hidden />
        </button>
      )}
    </>
  )
}
