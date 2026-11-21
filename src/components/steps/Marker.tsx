/** Numbered part marker: the same number is pinned on the part in the 3D view. Tap to zoom to it. */
export default function Marker({ n, name, onClick }: { n: number; name: string; onClick?: () => void }) {
  return onClick ? (
    <button className="marker" onClick={onClick} aria-label={`${n}: ${name}`} title={name}>
      {n}
    </button>
  ) : (
    <span className="marker" aria-label={`${n}: ${name}`} title={name}>
      {n}
    </span>
  )
}
