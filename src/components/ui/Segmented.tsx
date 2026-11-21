/** Two-or-more option switch (e.g. Take apart / Put together). */
export default function Segmented<T extends string>({
  value,
  options,
  onChange,
  small,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  small?: boolean
}) {
  return (
    <div className={`segmented${small ? ' small' : ''}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
