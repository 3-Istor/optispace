// "− value +" control. label names the value for screen readers ("Durée minimum").
export function Stepper({ label, value, text, step, min, max, onChange }) {
  return (
    <span role="group" aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" className="step" aria-label={`Diminuer : ${label}`} disabled={value - step < min} onClick={() => onChange(value - step)}>−</button>
      <span className="num" aria-live="polite" style={{ minWidth: 74, textAlign: 'center', fontWeight: 500 }}>{text}</span>
      <button type="button" className="step" aria-label={`Augmenter : ${label}`} disabled={value + step > max} onClick={() => onChange(value + step)}>+</button>
    </span>
  )
}
