import React, { useMemo, useState } from 'react'
import { UNITS } from '../lib/constants'

export default function Filters({ params, onParamsChange }) {
  function update(key, value) {
    onParamsChange((p) => ({ ...p, [key]: value }))
  }

  const [useCustomUnit, setUseCustomUnit] = useState(false)
  const unitOptions = useMemo(() => UNITS, [])
  const selectedUnit = useMemo(() => {
    if (params.unit === 'ALL') return 'ALL'
    return unitOptions.find(u => u.ext_id === params.unit)?.ext_id || ''
  }, [unitOptions, params.unit])

  return (
    <div className="toolbar" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Datum von</label>
        <input
          type="datetime-local"
          value={toLocal(params.datum_von)}
          onChange={(e) => update('datum_von', fromLocal(e.target.value))}
          className="input"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Datum bis</label>
        <input
          type="datetime-local"
          value={toLocal(params.datum_bis)}
          onChange={(e) => update('datum_bis', fromLocal(e.target.value))}
          className="input"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Unit</label>
        {!useCustomUnit ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="input"
              value={selectedUnit}
              onChange={(e) => update('unit', e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="ALL">Alle</option>
              {unitOptions.map((u) => (
                <option key={u.ext_id} value={u.ext_id}>{u.name}</option>
              ))}
            </select>
            <button type="button" className="input" style={{ padding: '10px 12px' }} onClick={() => setUseCustomUnit(true)}>Andere…</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={params.unit}
              onChange={(e) => update('unit', e.target.value)}
              className="input"
              style={{ flex: 1 }}
              placeholder="ext_id manuell eingeben"
            />
            <button type="button" className="input" style={{ padding: '10px 12px' }} onClick={() => setUseCustomUnit(false)}>Liste</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      <small style={{ color: 'var(--muted)' }}>API-Filter werden als Header an den Proxy gesendet.</small>
    </div>
  )
}

function toLocal(zIso) {
  if (!zIso) return ''
  const d = new Date(zIso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocal(local) {
  if (!local) return ''
  // treat as local and convert to Z
  const d = new Date(local)
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,19) + 'Z'
}
