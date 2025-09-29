// Shared internal-project detection and helpers (pure functions, safe for client/server)

// Normalize to a flexible rule-based mapping, preserving backward compatibility
// Schema:
// {
//   rules: [
//     { id, enabled, type: 'leistungsart_prefix', op: 'include'|'exclude', value: 'N'|'J'|... },
//     { id, enabled, type: 'code_exact', value: 'PROJ123' },
//     { id, enabled, type: 'token_substring', value: 'FOO' },
//     { id, enabled, type: 'legacy_int_prefix' },
//     { id, enabled, type: 'legacy_int_token' }
//   ],
//   projects: [...], // legacy
//   tokens: [...],   // legacy
// }
export function normalizeMapping(mapping){
  const m = mapping || {}
  const upProjects = Array.isArray(m?.projects) ? m.projects.map(s=>String(s||'').trim().toUpperCase()).filter(Boolean) : []
  const upTokens = Array.isArray(m?.tokens) ? m.tokens.map(s=>String(s||'').trim().toUpperCase()).filter(Boolean) : []
  let rules = Array.isArray(m?.rules) ? m.rules : []
  // migrate legacy fields into rules if rules not present
  if (!Array.isArray(m?.rules) || m.rules.length === 0) {
    rules = []
    for (const p of upProjects) rules.push({ id: `code:${p}`, enabled: true, type: 'code_exact', value: p })
    for (const t of upTokens) rules.push({ id: `tok:${t}`, enabled: true, type: 'token_substring', value: t })
  }
  // ensure defaults present: include N, legacy INT prefix + token, exclude J
  const hasIncN = rules.some(r => r.type==='leistungsart_prefix' && r.op==='include' && String(r.value||'').toUpperCase()==='N')
  if (!hasIncN) rules.unshift({ id: 'la:include:N', enabled: true, type: 'leistungsart_prefix', op: 'include', value: 'N' })
  const hasLegacyPrefix = rules.some(r => r.type==='legacy_int_prefix')
  if (!hasLegacyPrefix) rules.push({ id: 'legacy:int_prefix', enabled: true, type: 'legacy_int_prefix' })
  const hasLegacyToken = rules.some(r => r.type==='legacy_int_token')
  if (!hasLegacyToken) rules.push({ id: 'legacy:int_token', enabled: true, type: 'legacy_int_token' })
  const hasExcJ = rules.some(r => r.type==='leistungsart_prefix' && r.op==='exclude' && String(r.value||'').toUpperCase()==='J')
  if (!hasExcJ) rules.unshift({ id: 'la:exclude:J', enabled: true, type: 'leistungsart_prefix', op: 'exclude', value: 'J' })
  return { rules, projects: upProjects, tokens: upTokens }
}

export function extractMeta(row){
  const code = String(row?.PROJEKT || row?.projekt || row?.projektcode || '').toUpperCase().trim()
  const kunde = String(row?.KUNDE || row?.kunde || '').toString()
  const la = String(row?.LEISTUNGSART || row?.leistungsart || row?.LEISTART || '').toUpperCase().trim()
  return { code, kunde, leistungsart: la }
}

export function isExcludedByLeistungsart(row, mapping){
  try{
    const la = String(row?.LEISTUNGSART || row?.leistungsart || row?.LEISTART || '').toUpperCase().trim()
    const m = normalizeMapping(mapping)
    // If any exclusion rule matches, exclude
    const hasMatch = (m.rules||[]).some(r => r.enabled && r.type==='leistungsart_prefix' && r.op==='exclude' && la.startsWith(String(r.value||'').toUpperCase()))
    if (hasMatch) return true
    // default safety: exclude J if no rules matched (should be present by normalizeMapping)
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
  // Evaluate rules in order; first include-match wins; exclusions handled by isExcluded...
  for (const r of (m.rules||[])){
    if (!r?.enabled) continue
    if (r.type === 'leistungsart_prefix' && r.op === 'include' && String(r.value||'').trim()){
      if (la.startsWith(String(r.value).toUpperCase())) return { matched: true, by: 'leistungsart', value: String(r.value).toUpperCase() }
    } else if (r.type === 'code_exact' && String(r.value||'').trim()){
      if (code === String(r.value).toUpperCase()) return { matched: true, by: 'code', value: code }
    } else if (r.type === 'token_substring' && String(r.value||'').trim()){
      if (hay.includes(String(r.value).toUpperCase())) return { matched: true, by: 'token', value: String(r.value).toUpperCase() }
    } else if (r.type === 'legacy_int_prefix'){
      if (code.startsWith('INT') || name.startsWith('INT')) return { matched: true, by: 'legacy_prefix', value: 'INT' }
    } else if (r.type === 'legacy_int_token'){
      const tokens = hay.split(/[^A-Z0-9]+/).filter(Boolean)
      if (tokens.includes('INT')) return { matched: true, by: 'legacy_token', value: 'INT' }
    }
  }
  return { matched: false }
}

export function isInternalProject(row, mapping){
  if (isExcludedByLeistungsart(row, mapping)) return false
  const meta = extractMeta(row)
  const det = detectInternalDetail({ code: meta.code, name: String(row?.projektname || row?.PROJEKTNAME || row?.projekt || meta.code), leistungsart: meta.leistungsart }, mapping)
  return !!det.matched
}

// Client-friendly quick test
export function quickDetectInternal(code, name, la, mapping){
  if (isExcludedByLeistungsart({ LEISTUNGSART: la }, mapping)) return { matched:false, by:'excluded', value:String(la||'').charAt(0).toUpperCase() }
  const det = detectInternalDetail({ code, name, leistungsart: la }, mapping)
  return det
}
