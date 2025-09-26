// Shared internal-project detection and helpers (pure functions, safe for client/server)

export function normalizeMapping(mapping){
  const projects = Array.isArray(mapping?.projects) ? mapping.projects.map(s=>String(s||'').trim().toUpperCase()).filter(Boolean) : []
  const tokens = Array.isArray(mapping?.tokens) ? mapping.tokens.map(s=>String(s||'').trim().toUpperCase()).filter(Boolean) : []
  return { projects, tokens }
}

export function extractMeta(row){
  const code = String(row?.PROJEKT || row?.projekt || row?.projektcode || '').toUpperCase().trim()
  const kunde = String(row?.KUNDE || row?.kunde || '').toString()
  const la = String(row?.LEISTUNGSART || row?.leistungsart || row?.LEISTART || '').toUpperCase().trim()
  return { code, kunde, leistungsart: la }
}

export function isExcludedByLeistungsart(row){
  try{
    const la = String(row?.LEISTUNGSART || row?.leistungsart || row?.LEISTART || '').toUpperCase().trim()
    return la.startsWith('J')
  }catch(_){ return false }
}

// Core detection (server logic parity)
export function detectInternalDetail(rowOrMeta, mapping){
  const m = normalizeMapping(mapping)
  const code = String(rowOrMeta?.code || rowOrMeta?.PROJEKT || rowOrMeta?.projekt || rowOrMeta?.projektcode || '').toUpperCase().trim()
  const name = String(rowOrMeta?.name || rowOrMeta?.projektname || rowOrMeta?.PROJEKTNAME || rowOrMeta?.projekt || '').toUpperCase().trim()
  const la = String(rowOrMeta?.leistungsart || rowOrMeta?.LEISTUNGSART || rowOrMeta?.leistungsart || rowOrMeta?.LEISTART || '').toUpperCase().trim()
  const hay = `${code} ${name}`
  if (la.startsWith('N')) return { matched: true, by: 'leistungsart', value: la.charAt(0) || 'N' }
  if (m.projects.length && m.projects.includes(code)) return { matched: true, by: 'code', value: code }
  if (m.tokens.length){
    const tok = m.tokens.find(t => hay.includes(t))
    if (tok) return { matched: true, by: 'token', value: tok }
  }
  if (code.startsWith('INT') || name.startsWith('INT')) return { matched: true, by: 'legacy_prefix', value: 'INT' }
  const tokens = hay.split(/[^A-Z0-9]+/).filter(Boolean)
  if (tokens.includes('INT')) return { matched: true, by: 'legacy_token', value: 'INT' }
  return { matched: false }
}

export function isInternalProject(row, mapping){
  const meta = extractMeta(row)
  const det = detectInternalDetail({ code: meta.code, name: String(row?.projektname || row?.PROJEKTNAME || row?.projekt || meta.code), leistungsart: meta.leistungsart }, mapping)
  return !!det.matched
}

// Client-friendly quick test
export function quickDetectInternal(code, name, la, mapping){
  const det = detectInternalDetail({ code, name, leistungsart: la }, mapping)
  return det
}
