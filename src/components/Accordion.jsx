import { useState } from 'react'
import { Plus, Minus } from 'lucide-react'

export default function Accordion({ items }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="acc">
      {items.map((it, i) => (
        <div className={`acc-item ${open === i ? 'open' : ''}`} key={i}>
          <button type="button" className="acc-head" onClick={() => setOpen(open === i ? null : i)}>
            <span>{it.q}</span>
            <span className="acc-ic">{open === i ? <Minus size={16} /> : <Plus size={16} />}</span>
          </button>
          {open === i && <div className="acc-body">{it.a}</div>}
        </div>
      ))}
    </div>
  )
}
