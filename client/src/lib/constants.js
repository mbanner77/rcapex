export const DEFAULT_UNITS = [
  { id: 1, ext_id: 'zaE22GlNK6AZfBc', name: 'SAP CWS' },
  { id: 2, ext_id: 'YytRDIbdYtOVax8', name: 'SAP ABAP' },
  { id: 3, ext_id: 'VUmfO9SS3wXt2iB', name: 'SAP PI/PO' },
  { id: 4, ext_id: 'h0zDeGnQIgfY3px', name: 'SAP Basis' },
  { id: 5, ext_id: 'YtK84kUP26b7bMw', name: 'RCC Transformation' },
  { id: 6, ext_id: 'eQnsTZhPu8GPFUm', name: 'RCC Architecture' },
  { id: 7, ext_id: 'zZhkQJ460P62ZrB', name: 'Bremen' },
]

export function getUnits(){
  try{
    const raw = localStorage.getItem('units_override')
    if (raw){
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.every(u=>u && u.ext_id && u.name)) return arr
    }
  }catch(_){ /* ignore */ }
  return DEFAULT_UNITS
}

export const LOGO_URL = 'https://realcore.info/bilder/rc-logo.png'
