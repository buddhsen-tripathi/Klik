import './CameraPermission.css'
import { isInAppBrowser, isIOS, type CameraStatus } from '../../camera'

/**
 * Shown instead of the viewfinder until the camera is live: asks from a tap (what iOS
 * needs), and when access is blocked explains exactly where to turn it back on.
 */
export default function CameraPermission({
  status,
  onAllow,
  onUseLibrary,
  compact,
}: {
  status: CameraStatus
  onAllow: () => void
  onUseLibrary?: () => void
  compact?: boolean
}) {
  const ios = isIOS()
  let title: string
  let body: React.ReactNode
  if (status === 'prompt' || status === 'starting') {
    title = 'Allow the camera'
    body = compact
      ? 'So I can watch you work and tick off each step.'
      : 'Point it at the object and I’ll identify it, grab a few angles and build the 3D model. Photos are only used for this scan.'
  } else if (status === 'denied') {
    title = 'Camera access is blocked'
    body = ios ? (
      <>
        Tap <b>aA</b> in the address bar › <b>Website Settings</b> › <b>Camera</b> › <b>Allow</b>, then try again. If that option isn’t there:{' '}
        <b>Settings</b> › <b>Safari</b> › <b>Camera</b> › <b>Allow</b>, and reload.
      </>
    ) : (
      'Tap the lock or camera icon in the address bar, allow the camera for this site, then try again.'
    )
  } else {
    title = 'Live camera isn’t available here'
    body = isInAppBrowser()
      ? `This in-app browser can’t use the camera. Open the link in ${ios ? 'Safari' : 'Chrome'} (⋯ › Open in browser).`
      : 'The live camera needs HTTPS and a browser that supports it.'
  }

  return (
    <div className={`card camera-permission${compact ? ' compact' : ''}`}>
      <span className="camera-permission-icon" aria-hidden>
        📷
      </span>
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      {status !== 'unsupported' && (
        <button className="btn primary" onClick={onAllow} disabled={status === 'starting'}>
          {status === 'starting' ? 'Waiting for permission…' : status === 'denied' ? 'Try again' : 'Allow camera'}
        </button>
      )}
      {onUseLibrary && (
        <button className="btn ghost" onClick={onUseLibrary}>
          Pick photos instead
        </button>
      )}
    </div>
  )
}
