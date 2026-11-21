/** Centered spinner with a label, for whole-page waits. */
export default function Progress({ label }: { label: string }) {
  return (
    <div className="progress">
      <div className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
