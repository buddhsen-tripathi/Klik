/** Small 3D cube that turns to show which side to photograph next. */
export default function GuideCube({ transform, got }: { transform: string; got: string[] }) {
  return (
    <div className="guide-cube" aria-hidden>
      <div className="cube" style={{ transform: `rotateX(-18deg) rotateY(-24deg) ${transform}` }}>
        {['front', 'right', 'back', 'left', 'top', 'bottom'].map((f) => (
          <span key={f} className={`face ${f} ${got.includes(f) ? 'got' : ''}`} />
        ))}
      </div>
    </div>
  )
}
