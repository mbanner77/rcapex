import React, { useMemo, useState } from 'react'

export default function CustomerTable({ kunden, totals }) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState('stunden_fakt') // 'kunde' | 'stunden_fakt' | 'stunden_gel'
  const [sortDir, setSortDir] = useState('desc') // 'asc' | 'desc'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let arr = kunden
    if (q) {
      arr = arr.filter((k) => k.kunde?.toLowerCase().includes(q))
    }
    arr = [...arr].sort((a, b) => {
      let va = a[sortKey]
      let vb = b[sortKey]
      if (sortKey === 'kunde') {
        va = String(va || '')
        vb = String(vb || '')
        return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va)
      }
      va = Number(va || 0)
      vb = Number(vb || 0)
      return sortDir === 'asc' ? va - vb : vb - va
    })
    return arr
  }, [kunden, search, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input
          className="input"
          placeholder="Suche Kunde…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <div style={{ color: 'var(--muted)' }}>
          Summe fakt.: <b>{fmt(totals.stunden_fakt)}</b> h · Summe gel.: <b>{fmt(totals.stunden_gel)}</b> h
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <Th label="Kunde" active={sortKey==='kunde'} dir={sortDir} onClick={() => toggleSort('kunde')} />
              <Th label="Std. fakturiert" align="right" active={sortKey==='stunden_fakt'} dir={sortDir} onClick={() => toggleSort('stunden_fakt')} />
              <Th label="Std. geleistet" align="right" active={sortKey==='stunden_gel'} dir={sortDir} onClick={() => toggleSort('stunden_gel')} />
              <th className="th-left" style={{ fontSize: 12, color: 'var(--muted)' }}>Projekte</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((k) => (
              <tr key={k.kunde}>
                <td>{k.kunde}</td>
                <td className="right">{fmt(k.stunden_fakt)}</td>
                <td className="right">{fmt(k.stunden_gel)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {k.projekte?.map((p) => (
                      <span key={p.projektcode} className="badge">
                        {p.projektcode}: {fmt(p.stunden_fakt)}h
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Th({ label, align='left', active, dir, onClick }) {
  return (
    <th onClick={onClick} style={{ cursor: 'pointer', textAlign: align }} title="Sortieren">
      {label} {active ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

function fmt(n) {
  return (Number(n || 0)).toLocaleString('de-DE', { maximumFractionDigits: 2 })
}
