import React, { useEffect, useMemo, useState } from 'react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { fetchStunden } from '../lib/api'
import { aggregateKundenFromStunden } from '../lib/transform'
import { exportCompareCsv, exportGenericCsv } from '../lib/export'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

function makeMonthRange(year, month /* 0-11 */) {
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  const end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59))
  const iso = (d) => d.toISOString().slice(0,19) + 'Z'
  return { datum_von: iso(start), datum_bis: iso(end), ym: `${start.getUTCFullYear()}-${String(start.getUTCMonth()+1).padStart(2,'0')}` }
}

function lastNMonthsOptions(datum_von_iso, n=12) {
  const base = datum_von_iso ? new Date(datum_von_iso) : new Date()
  const y = base.getUTCFullYear()
  const m = base.getUTCMonth()
  const out = []
  for (let i = 1; i <= n; i++) { // previous n months only
    const mm = m - i
    const yy = y + Math.floor(mm / 12)
    const mon = (mm % 12 + 12) % 12
    out.push(makeMonthRange(yy, mon))
  }
  return out
}

export default function ComparisonTab({ currentRaw, params }) {
  const [refMonth, setRefMonth] = useState('')
  const [refRaw, setRefRaw] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [modal, setModal] = useState({ open:false, kunde:null })

  const refOptions = useMemo(() => lastNMonthsOptions(params?.datum_von, 12), [params?.datum_von])
  useEffect(() => {
    // default select last month
    if (refOptions.length && !refMonth) setRefMonth(refOptions[0].ym)
  }, [refOptions, refMonth])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const r = refOptions.find(o => o.ym === refMonth)
        if (!r) { if (!cancelled) setRefRaw(null); return }
        const data = await fetchStunden({ datum_von: r.datum_von, datum_bis: r.datum_bis, unit: params?.unit })
        if (!cancelled) setRefRaw(data)
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.message || e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [refMonth, refOptions.map(o=>o.ym).join(','), params?.unit])

  const currAgg = useMemo(() => currentRaw ? aggregateKundenFromStunden(currentRaw) : null, [currentRaw])
  const refAgg = useMemo(() => refRaw ? aggregateKundenFromStunden(refRaw) : null, [refRaw])

  const kpis = useMemo(() => {
    if (!currAgg || !refAgg) return null
    const curF = Number(currAgg.totals.stunden_fakt || 0)
    const curG = Number(currAgg.totals.stunden_gel || 0)
    const prevF = Number(refAgg.totals.stunden_fakt || 0)
    const prevG = Number(refAgg.totals.stunden_gel || 0)
    return {
      curF, curG, prevF, prevG,
      dF: curF - prevF,
      dG: curG - prevG,
      qCur: curG > 0 ? (curF / curG) : 0,
      qPrev: prevG > 0 ? (prevF / prevG) : 0,
    }
  }, [currAgg, refAgg])

  const deltas = useMemo(() => {
    if (!currAgg || !refAgg) return []
    const mapPrev = new Map(refAgg.kunden.map(k => [k.kunde, k]))
    const rows = currAgg.kunden.map(c => {
      const p = mapPrev.get(c.kunde)
      return {
        kunde: c.kunde,
        cur_f: Number(c.stunden_fakt || 0),
        prev_f: Number(p?.stunden_fakt || 0),
        delta_f: Number(c.stunden_fakt || 0) - Number(p?.stunden_fakt || 0),
        cur_g: Number(c.stunden_gel || 0),
        prev_g: Number(p?.stunden_gel || 0),
        delta_g: Number(c.stunden_gel || 0) - Number(p?.stunden_gel || 0),
      }
    })
    rows.sort((a,b)=> Math.abs(b.delta_f) - Math.abs(a.delta_f))
    return rows
  }, [currAgg, refAgg])

  const top = deltas.slice(0, 15)
  const deltaChart = useMemo(() => ({
    labels: top.map(r=>r.kunde),
    datasets: [
      { label: 'Δ Fakturiert', data: top.map(r=>r.delta_f), backgroundColor: 'rgba(34,197,94,0.7)', borderRadius: 6 },
      { label: 'Δ Geleistet', data: top.map(r=>r.delta_g), backgroundColor: 'rgba(99,102,241,0.6)', borderRadius: 6 },
    ]
  }), [deltas])

  const [filterKunde, setFilterKunde] = useState('')
  const filtered = useMemo(() => filterKunde ? deltas.filter(d => d.kunde === filterKunde) : top, [filterKunde, deltas, top])

  return (
    <div>
      {loading && <div>Loading…</div>}
      {error && <div style={{ color: 'crimson' }}>Fehler: {String(error)}</div>}

      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <label style={{ color: 'var(--muted)', fontSize: 12 }}>Vergleiche gegen Monat</label>
          <select className="input" value={refMonth} onChange={(e)=>setRefMonth(e.target.value)}>
            {refOptions.map((o) => (
              <option key={o.ym} value={o.ym}>{o.ym}</option>
            ))}
          </select>
        </div>

        {kpis && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <KPI title="Fakturiert (aktuell)" value={`${fmt(kpis.curF)} h`} />
            <KPI title="Fakturiert (Ref)" value={`${fmt(kpis.prevF)} h`} />
            <KPI title="Δ Fakturiert" value={`${fmt(kpis.dF)} h`} />
            <KPI title="Quote F/G aktuell" value={kpis.qCur>0? `${(kpis.qCur*100).toFixed(1)}%` : '—'} />
            <KPI title="Geleistet (aktuell)" value={`${fmt(kpis.curG)} h`} />
            <KPI title="Geleistet (Ref)" value={`${fmt(kpis.prevG)} h`} />
            <KPI title="Δ Geleistet" value={`${fmt(kpis.dG)} h`} />
            <KPI title="Quote F/G Ref" value={kpis.qPrev>0? `${(kpis.qPrev*100).toFixed(1)}%` : '—'} />
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h3 style={{ margin: '4px 0' }}>Top-Änderungen je Kunde (aktuell vs. Referenz)</h3>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => exportCompareCsv(deltas)}>Export (CSV)</button>
          <button className="btn" onClick={() => window.print()}>PDF Report</button>
        </div>
        <div style={{ height: 380 }}>
          <Bar
            data={deltaChart}
            options={{
              responsive:true,
              maintainAspectRatio:false,
              plugins:{ legend:{ position:'top' } },
              scales:{ y:{ beginAtZero:true } },
              onClick: (evt, elements) => {
                if (!elements?.length) { setFilterKunde(''); return }
                const idx = elements[0].index
                const kunde = deltaChart.labels[idx]
                setFilterKunde(prev => prev === kunde ? '' : kunde)
                setModal({ open:true, kunde })
              }
            }}
          />
        </div>
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Kunde</th>
                <th className="right">Fakt. aktuell</th>
                <th className="right">Fakt. Ref</th>
                <th className="right">Δ Fakt.</th>
                <th className="right">Gel. aktuell</th>
                <th className="right">Gel. Ref</th>
                <th className="right">Δ Gel.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r)=> (
                <tr key={r.kunde} onClick={()=> setModal({ open:true, kunde: r.kunde })} style={{ cursor:'pointer' }}>
                  <td>{r.kunde}</td>
                  <td className="right">{fmt(r.cur_f)}</td>
                  <td className="right">{fmt(r.prev_f)}</td>
                  <td className="right">{fmt(r.delta_f)}</td>
                  <td className="right">{fmt(r.cur_g)}</td>
                  <td className="right">{fmt(r.prev_g)}</td>
                  <td className="right">{fmt(r.delta_g)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {modal.open && (
          <CustomerDrilldownModal onClose={()=>setModal({ open:false, kunde:null })} kunde={modal.kunde} currentRaw={currentRaw} refRaw={refRaw} />
        )}
      </div>
    </div>
  )
}

function KPI({ title, value }) {
  return (
    <div className="panel" style={{ padding: 12 }}>
      <div style={{ color: 'var(--muted)', fontSize: 12 }}>{title}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

function fmt(n){ return (Number(n||0)).toLocaleString('de-DE', { maximumFractionDigits: 2 }) }
