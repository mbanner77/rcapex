// Helpers to manage internal projects mapping (persisted in localStorage)
// Shape: { projects: string[], tokens: string[] }

const KEY = 'internal_mapping'

export function getInternalMapping() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj && Array.isArray(obj.projects) && Array.isArray(obj.tokens)) return obj
    }
  } catch (_) {}
  return { projects: [], tokens: [] }
}

export function saveInternalMapping(mapping) {
  const safe = {
    projects: Array.isArray(mapping?.projects) ? mapping.projects.map(String) : [],
    tokens: Array.isArray(mapping?.tokens) ? mapping.tokens.map(String) : [],
  }
  localStorage.setItem(KEY, JSON.stringify(safe))
  try { window.dispatchEvent(new Event('internal_mapping_changed')) } catch (_) {}
}

// Utility: decide if a given record is internal based on mapping
// Accepts objects from different sources; checks common fields
export function isInternalProject(rec, mapping = getInternalMapping()) {
  const code = String(rec?.PROJEKT ?? rec?.projekt ?? rec?.projektcode ?? rec?.code ?? '').toLowerCase()
  const name = String(rec?.NAME ?? rec?.name ?? '').toLowerCase()
  const hay = `${code} ${name}`.trim()
  if (!hay) return false
  // exact code match
  if (mapping.projects.some(p => String(p).trim().toLowerCase() === code)) return true
  // token/substring match
  return mapping.tokens.some(t => hay.includes(String(t).trim().toLowerCase()))
}
