// Transform raw "stunden" API response into Kunden/Projekte aggregation
// Mirrors the logic from the provided Postman test script but in a functional way

export function aggregateKundenFromStunden(raw) {
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : []

  const mitarbeiter = {}
  const kundenMap = new Map()

  function ensureKunde(name) {
    if (!kundenMap.has(name)) {
      kundenMap.set(name, {
        kunde: name,
        projekte: new Map(),
        stunden_fakt: 0,
        stunden_gel: 0,
      })
    }
    return kundenMap.get(name)
  }

  function ensureProjekt(kundeObj, projektcode) {
    if (!kundeObj.projekte.has(projektcode)) {
      kundeObj.projekte.set(projektcode, {
        projektcode,
        mitarbeiter: new Map(),
        stunden_fakt: 0,
        stunden_gel: 0,
      })
    }
    return kundeObj.projekte.get(projektcode)
  }

  for (const x of items) {
    const hasStunden = ['stunden_gel', 'stunden_fakt'].some((k) => x?.[k] !== undefined && x?.[k] !== null)
    if (!hasStunden) continue

    const maKey = x.mitarbeiter
    mitarbeiter[maKey] = mitarbeiter[maKey] || { mitarbeiter: maKey, projekte: {} }
    mitarbeiter[maKey].projekte[x.projektcode] = mitarbeiter[maKey].projekte[x.projektcode] || { stunden: [] }
    mitarbeiter[maKey].projekte[x.projektcode].stunden.push(x)

    const kundeObj = ensureKunde(x.kunde)
    const projektObj = ensureProjekt(kundeObj, x.projektcode)

    // add mitarbeiter node if missing
    if (!projektObj.mitarbeiter.has(maKey)) {
      projektObj.mitarbeiter.set(maKey, mitarbeiter[maKey])
    }

    const sf = parseFloat(x.stunden_fakt)
    const sg = parseFloat(x.stunden_gel)
    projektObj.stunden_fakt += Number.isNaN(sf) ? 0 : sf
    projektObj.stunden_gel += Number.isNaN(sg) ? 0 : sg
  }

  // Recalculate per Kunde by summing projects
  const kunden = []
  let totals = { stunden_fakt: 0, stunden_gel: 0 }
  for (const kundeObj of kundenMap.values()) {
    let k_sf = 0
    let k_sg = 0
    for (const p of kundeObj.projekte.values()) {
      k_sf += p.stunden_fakt
      k_sg += p.stunden_gel
    }
    kundeObj.stunden_fakt = k_sf
    kundeObj.stunden_gel = k_sg
    totals.stunden_fakt += k_sf
    totals.stunden_gel += k_sg

    kunden.push({
      kunde: kundeObj.kunde,
      stunden_fakt: k_sf,
      stunden_gel: k_sg,
      projekte: Array.from(kundeObj.projekte.values()).map((p) => ({
        projektcode: p.projektcode,
        stunden_fakt: p.stunden_fakt,
        stunden_gel: p.stunden_gel,
      })),
    })
  }

  // sort customers by stunden_fakt desc
  kunden.sort((a, b) => (b.stunden_fakt || 0) - (a.stunden_fakt || 0))

  return { kunden, totals }
}

// Aggregate projects across all customers for analytics
export function projectTotalsFromKunden(kunden) {
  const map = new Map()
  for (const k of kunden || []) {
    for (const p of k.projekte || []) {
      const key = p.projektcode
      const cur = map.get(key) || { projektcode: key, stunden_fakt: 0, stunden_gel: 0 }
      cur.stunden_fakt += Number(p.stunden_fakt || 0)
      cur.stunden_gel += Number(p.stunden_gel || 0)
      map.set(key, cur)
    }
  }
  const arr = Array.from(map.values())
  arr.sort((a, b) => (b.stunden_fakt || 0) - (a.stunden_fakt || 0))
  return arr
}

// ----- Time series helpers (monthly) -----
export function extractMonths(items) {
  const set = new Set()
  for (const x of items || []) {
    const d = x?.datum || x?.datum_bis || x?.datum_von || x?.date
    if (!d) continue
    const dt = new Date(d)
    if (isNaN(dt)) continue
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`
    set.add(ym)
  }
  const arr = Array.from(set)
  arr.sort()
  return arr
}

export function groupByCustomerMonthly(items, metricKey='stunden_fakt', projectFilter=null) {
  const months = extractMonths(items)
  const perCustomer = new Map()
  for (const x of items || []) {
    if (projectFilter && x?.projektcode !== projectFilter) continue
    const d = x?.datum || x?.datum_bis || x?.datum_von || x?.date
    if (!d) continue
    const dt = new Date(d)
    if (isNaN(dt)) continue
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`
    const cust = x?.kunde || 'Unbekannt'
    const map = perCustomer.get(cust) || new Map(months.map((m)=>[m,0]))
    const v = parseFloat(x?.[metricKey])
    map.set(ym, (map.get(ym) || 0) + (Number.isNaN(v)?0:v))
    perCustomer.set(cust, map)
  }
  return { months, perCustomer }
}

export function topCustomersByTotal(perCustomer, topN=10) {
  const totals = []
  for (const [cust, m] of perCustomer || []) {
    let sum = 0
    for (const v of m.values()) sum += Number(v||0)
    totals.push({ cust, sum })
  }
  totals.sort((a,b)=>b.sum-a.sum)
  return totals.slice(0, topN).map(x=>x.cust)
}

export function listProjectsFromKunden(kunden) {
  const set = new Set()
  for (const k of kunden || []) {
    for (const p of k.projekte || []) set.add(p.projektcode)
  }
  return Array.from(set).sort()
}

// Group by project monthly
export function groupByProjectMonthly(items, metricKey='stunden_fakt', customerFilter=null) {
  const months = extractMonths(items)
  const perProject = new Map()
  for (const x of items || []) {
    if (customerFilter && x?.kunde !== customerFilter) continue
    const d = x?.datum || x?.datum_bis || x?.datum_von || x?.date
    if (!d) continue
    const dt = new Date(d)
    if (isNaN(dt)) continue
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`
    const proj = x?.projektcode || 'Unbekannt'
    const map = perProject.get(proj) || new Map(months.map((m)=>[m,0]))
    const v = parseFloat(x?.[metricKey])
    map.set(ym, (map.get(ym) || 0) + (Number.isNaN(v)?0:v))
    perProject.set(proj, map)
  }
  return { months, perProject }
}

export function topProjectsByTotal(perProject, topN=10) {
  const totals = []
  for (const [proj, m] of perProject || []) {
    let sum = 0
    for (const v of m.values()) sum += Number(v||0)
    totals.push({ proj, sum })
  }
  totals.sort((a,b)=>b.sum-a.sum)
  return totals.slice(0, topN).map(x=>x.proj)
}

// Group by employee monthly
export function groupByEmployeeMonthly(items, metricKey='stunden_fakt', customerFilter=null, projectFilter=null) {
  const months = extractMonths(items)
  const perEmployee = new Map()
  for (const x of items || []) {
    if (customerFilter && x?.kunde !== customerFilter) continue
    if (projectFilter && x?.projektcode !== projectFilter) continue
    const d = x?.datum || x?.datum_bis || x?.datum_von || x?.date
    if (!d) continue
    const dt = new Date(d)
    if (isNaN(dt)) continue
    const ym = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`
    const emp = x?.mitarbeiter || 'Unbekannt'
    const map = perEmployee.get(emp) || new Map(months.map((m)=>[m,0]))
    const v = parseFloat(x?.[metricKey])
    map.set(ym, (map.get(ym) || 0) + (Number.isNaN(v)?0:v))
    perEmployee.set(emp, map)
  }
  return { months, perEmployee }
}

export function topEmployeesByTotal(perEmployee, topN=10) {
  const totals = []
  for (const [emp, m] of perEmployee || []) {
    let sum = 0
    for (const v of m.values()) sum += Number(v||0)
    totals.push({ emp, sum })
  }
  totals.sort((a,b)=>b.sum-a.sum)
  return totals.slice(0, topN).map(x=>x.emp)
}

export function listCustomersFromItems(items) {
  const set = new Set()
  for (const x of items || []) set.add(x?.kunde || 'Unbekannt')
  return Array.from(set).sort()
}

export function listEmployeesFromItems(items) {
  const set = new Set()
  for (const x of items || []) set.add(x?.mitarbeiter || 'Unbekannt')
  return Array.from(set).sort()
}

export function employeeTotalsFromItems(items, metricKey='stunden_fakt') {
  const map = new Map()
  for (const x of items || []) {
    const emp = x?.mitarbeiter || 'Unbekannt'
    const v = parseFloat(x?.[metricKey])
    map.set(emp, (map.get(emp) || 0) + (Number.isNaN(v)?0:v))
  }
  const arr = Array.from(map.entries()).map(([mitarbeiter, sum]) => ({ mitarbeiter, sum }))
  arr.sort((a,b)=>b.sum-a.sum)
  return arr
}
