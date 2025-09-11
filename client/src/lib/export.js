function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Generic CSV export: headers as array of { key, label }, rows as array of objects
export function exportGenericCsv(headers, rows, filenamePrefix='export') {
  const header = toCsvRow(headers.map(h=>h.label))
  const body = (rows||[]).map(r => toCsvRow(headers.map(h => r[h.key])))
  const csv = [header, ...body].join('\n')
  download(`${filenamePrefix}_${new Date().toISOString().slice(0,10)}.csv`, csv)
}

export function exportCompareCsv(rows) {
  const header = toCsvRow(['Kunde','Fakt_aktuell','Fakt_ref','Delta_Fakt','Gel_aktuell','Gel_ref','Delta_Gel'])
  const body = (rows||[]).map(r => toCsvRow([
    r.kunde,
    r.cur_f,
    r.prev_f,
    r.delta_f,
    r.cur_g,
    r.prev_g,
    r.delta_g,
  ]))
  const csv = [header, ...body].join('\n')
  download(`vergleich_${new Date().toISOString().slice(0,10)}.csv`, csv)
}

function toCsvRow(fields) {
  return fields.map((f) => {
    if (f === null || f === undefined) return ''
    const s = String(f)
    if (/[",\n;]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }).join(';')
}

export function exportCustomersCsv(kunden) {
  const header = toCsvRow(['Kunde', 'Stunden_fakt', 'Stunden_gel'])
  const rows = (kunden || []).map((k) => toCsvRow([k.kunde, k.stunden_fakt, k.stunden_gel]))
  const csv = [header, ...rows].join('\n')
  download(`kunden_${new Date().toISOString().slice(0,10)}.csv`, csv)
}

export function exportProjectsCsv(kunden) {
  const header = toCsvRow(['Projektcode', 'Stunden_fakt', 'Stunden_gel'])
  const map = new Map()
  for (const k of kunden || []) {
    for (const p of k.projekte || []) {
      const cur = map.get(p.projektcode) || { sf: 0, sg: 0 }
      cur.sf += Number(p.stunden_fakt || 0)
      cur.sg += Number(p.stunden_gel || 0)
      map.set(p.projektcode, cur)
    }
  }
  const rows = Array.from(map.entries()).map(([code, v]) => toCsvRow([code, v.sf, v.sg]))
  const csv = [header, ...rows].join('\n')
  download(`projekte_${new Date().toISOString().slice(0,10)}.csv`, csv)
}

export function exportTrendCsv(rows) {
  const header = toCsvRow(['Monat','Fakt','Δ Fakt','Gel','Δ Gel','Intern','Δ Intern'])
  const body = (rows||[]).map(r => toCsvRow([
    r.ym,
    r.fakt,
    r.dFakt,
    r.gel,
    r.dGel,
    r.internal,
    r.dInternal,
  ]))
  const csv = [header, ...body].join('\n')
  download(`trends_${new Date().toISOString().slice(0,10)}.csv`, csv)
}
