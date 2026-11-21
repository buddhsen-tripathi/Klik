import './SizeCheckChip.css'

/** The 3D scan didn't load and the view fell back to boxes: say so, and offer a retry. */
export default function ScanFailedChip({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="size-check warn" role="alert">
      ⚠️ The 3D scan didn’t load, so you’re seeing the simple box model.{' '}
      <button className="link-btn" onClick={onRetry} style={{ color: 'inherit', textDecoration: 'underline', padding: 0 }}>
        Try again
      </button>
    </div>
  )
}
