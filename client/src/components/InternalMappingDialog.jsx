import React, { useEffect, useMemo, useState } from 'react'
import { getInternalMapping, saveInternalMapping } from '../lib/mapping'
import { getInternalMappingServer, updateInternalMappingServer } from '../lib/api'
// Use centralized internal detection logic (shared across client/server)
import { quickDetectInternal, isExcludedByLeistungsart } from '../shared/internal.js'

export default function InternalMappingDialog({ onClose }){
  const [projects, setProjects] = useState([])
  const [tokens, setTokens] = useState([])
  const [rules, setRules] = useState([])
  const [msg, setMsg] = useState('')
  const [srvMsg, setSrvMsg] = useState('')
  const [test, setTest] = useState({ code:'', name:'', la:'' })
  const [toolsMsg, setToolsMsg] = useState('')

  useEffect(()=>{
    const m = getInternalMapping()
    setProjects(Array.isArray(m.projects) ? m.projects : [])
    setTokens(Array.isArray(m.tokens) ? m.tokens : [])
    setRules(Array.isArray(m.rules) ? m.rules : [])
  },[])

  function addProject(){ setProjects(arr => [...arr, '']) }
  function addToken(){ setTokens(arr => [...arr, '']) }
  function updateProject(idx, val){ setProjects(arr => arr.map((v,i)=> i===idx? val : v)) }
  function updateToken(idx, val){ setTokens(arr => arr.map((v,i)=> i===idx? val : v)) }
  function removeProject(idx){ setProjects(arr => arr.filter((_,i)=> i!==idx)) }
  function removeToken(idx){ setTokens(arr => arr.filter((_,i)=> i!==idx)) }

  function save(){
    const cleaned = {
      projects: projects.map(s=> String(s||'').trim()).filter(Boolean),
      tokens: tokens.map(s=> String(s||'').trim()).filter(Boolean),
      rules: sanitizeRules(rules),
    }
    try{
      saveInternalMapping(cleaned)
      setMsg('Gespeichert')
      setTimeout(()=>{ onClose?.() }, 350)
    }catch(e){ setMsg('Fehler: '+(e?.message||e)) }
  }

  function reset(){ setProjects([]); setTokens([]); setMsg('Zurückgesetzt (nicht gespeichert)') }

  // Tools
  function normalizeCodesUpper(){ setProjects(arr=> arr.map(s=> String(s||'').trim().toUpperCase())) ; setToolsMsg('Codes uppercased') }
  function normalizeTokensLower(){ setTokens(arr=> arr.map(s=> String(s||'').trim().toLowerCase())) ; setToolsMsg('Tokens lowercased') }
  function sortBoth(){ setProjects(arr=> arr.slice().sort((a,b)=> String(a).localeCompare(String(b)))) ; setTokens(arr=> arr.slice().sort((a,b)=> String(a).localeCompare(String(b)))) ; setToolsMsg('Sortiert A→Z') }
  function dedupeBoth(){ setProjects(arr=> Array.from(new Set(arr.map(s=> String(s||'').trim())).values())) ; setTokens(arr=> Array.from(new Set(arr.map(s=> String(s||'').trim())).values())) ; setToolsMsg('Duplikate entfernt') }
  function bulkAddProjects(){
    const txt = prompt('Mehrere Projektcodes (Zeilen/Komma/Leerzeichen getrennt) eingeben:')
    if (!txt) return
    const parts = txt.split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean)
    if (!parts.length) return
    setProjects(arr=> [...arr, ...parts])
  }
  function bulkAddTokens(){
    const txt = prompt('Mehrere Token (Zeilen/Komma/Leerzeichen getrennt) eingeben:')
    if (!txt) return
    const parts = txt.split(/[\s,;]+/).map(s=>s.trim()).filter(Boolean)
    if (!parts.length) return
    setTokens(arr=> [...arr, ...parts])
  }

  const counts = useMemo(()=> ({ codes: (projects||[]).filter(Boolean).length, tokens: (tokens||[]).filter(Boolean).length, rules: (rules||[]).length }), [projects, tokens, rules])

  // Quick test using shared logic; excludes Leistungsart starting with 'J'
  function quickTest(mapping){
    const code = String(test.code||'')
    const name = String(test.name||'')
    const la = String(test.la||'')
    // Exclusion applied first for parity with watchdog
    if (isExcludedByLeistungsart({ LEISTUNGSART: la }, mapping)) return { matched:false, by:'excluded', value: String(la||'').charAt(0).toUpperCase() }
    return quickDetectInternal(code, name, la, mapping)
  }
  const testRes = useMemo(()=> quickTest({ projects, tokens, rules: sanitizeRules(rules) }), [projects, tokens, rules, test.code, test.name, test.la])

  async function loadFromServer(){
    setSrvMsg('Lade vom Server…')
    try{
      const m = await getInternalMappingServer()
      setProjects(Array.isArray(m.projects)? m.projects : [])
      setTokens(Array.isArray(m.tokens)? m.tokens : [])
      setRules(Array.isArray(m.rules)? m.rules : [])
      setSrvMsg('Vom Server geladen')
    }catch(e){ setSrvMsg('Fehler: '+(e?.response?.data?.message || e.message)) }
  }

  async function saveToServer(){
    setSrvMsg('Speichere zum Server…')
    try{
      const cleaned = {
        projects: projects.map(s=> String(s||'').trim()).filter(Boolean),
        tokens: tokens.map(s=> String(s||'').trim()).filter(Boolean),
        rules: sanitizeRules(rules),
      }
      await updateInternalMappingServer(cleaned)
      setSrvMsg('Auf Server gespeichert')
    }catch(e){ setSrvMsg('Fehler: '+(e?.response?.data?.message || e.message)) }
  }

  function exportJson(){
    const cleaned = {
      projects: projects.map(s=> String(s||'').trim()).filter(Boolean),
      tokens: tokens.map(s=> String(s||'').trim()).filter(Boolean),
      rules: sanitizeRules(rules),
    }
    const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'internal_mapping.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  function importJson(){
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'application/json'
    inp.onchange = async (e)=>{
      const f = e.target.files && e.target.files[0]
      if (!f) return
      try{
        const txt = await f.text()
        const j = JSON.parse(txt)
        setProjects(Array.isArray(j?.projects)? j.projects : [])
        setTokens(Array.isArray(j?.tokens)? j.tokens : [])
        setRules(Array.isArray(j?.rules)? j.rules : [])
        setMsg('Importiert (lokal, noch nicht gespeichert)')
      }catch(err){ setMsg('Fehler beim Import: '+(err?.message||err)) }
    }
    inp.click()
  }

  // Rules helpers
  function sanitizeRules(arr){
    return (Array.isArray(arr)?arr:[])
      .filter(r=>r && typeof r==='object')
      .map((r, idx)=>({
        id: String(r.id || `r${idx}_${Math.random().toString(36).slice(2)}`),
        enabled: r.enabled !== false,
        type: String(r.type||'').trim(),
        op: r.op ? String(r.op).trim() : undefined,
        value: r.value!=null ? String(r.value) : undefined,
      }))
      .filter(r=> ['leistungsart_prefix','code_exact','token_substring','legacy_int_prefix','legacy_int_token'].includes(r.type))
  }
  function addRule(defaults={ type:'code_exact', enabled:true }){
    setRules(arr=> [...arr, { id:`r${Date.now()}`, enabled:true, ...defaults }])
  }
  function updateRule(idx, patch){ setRules(arr=> arr.map((r,i)=> i===idx? { ...r, ...patch } : r)) }
  function removeRule(idx){ setRules(arr=> arr.filter((_,i)=> i!==idx)) }
  function moveRule(idx, dir){ setRules(arr=>{ const a=arr.slice(); const j=idx+dir; if(j<0||j>=a.length) return a; const t=a[idx]; a[idx]=a[j]; a[j]=t; return a }) }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e)=>e.stopPropagation()} style={{ padding: 16 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h3 style={{ margin:0 }}>Interne Projekte – Mapping</h3>
          <div style={{ flex:1 }} />
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
        <div className="modal-scroll">
        <div className="panel" style={{ padding: 12, marginTop: 12 }}>
          <div style={{ color:'var(--muted)', marginBottom:8 }}>
            Definiere, welche Projekte als INTERN gelten. Zwei Mechanismen:
            <ul style={{ margin:'6px 0 0 18px' }}>
              <li><strong>Projektcodes</strong>: exakte Codes, z. B. "INT", "ADMIN", "RCCINT"</li>
              <li><strong>Kürzel/Token</strong>: Teilstrings, die in Code oder Name vorkommen, z. B. "intern", "admin"</li>
            </ul>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:8, flexWrap:'wrap' }}>
            <button className="btn" onClick={loadFromServer}>Vom Server laden</button>
            <button className="btn" onClick={saveToServer}>Auf Server speichern</button>
            {srvMsg && <span style={{ color:'var(--muted)' }}>{srvMsg}</span>}
            <div style={{ flex:1 }} />
            <button className="btn" onClick={exportJson}>Export</button>
            <button className="btn" onClick={importJson}>Import</button>
          </div>
          <div className="panel" style={{ padding:10, marginBottom:8 }}>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <strong>Werkzeuge</strong>
              <button className="btn" onClick={normalizeCodesUpper}>Codes UPPER</button>
              <button className="btn" onClick={normalizeTokensLower}>Tokens lower</button>
              <button className="btn" onClick={sortBoth}>Sortieren</button>
              <button className="btn" onClick={dedupeBoth}>Duplikate entfernen</button>
              <div style={{ flex:1 }} />
              <span className="badge">Codes: {counts.codes}</span>
              <span className="badge">Tokens: {counts.tokens}</span>
              {toolsMsg && <span style={{ color:'var(--muted)' }}>{toolsMsg}</span>}
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>Projektcodes (exakt)</h4>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={addProject}>+ Code</button>
                <button className="btn" onClick={bulkAddProjects}>Bulk…</button>
              </div>
              <div style={{ display:'grid', gap:8 }}>
                {projects.map((p, idx) => (
                  <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 80px', gap:8 }}>
                    <input className="input" placeholder="z. B. INT" value={p} onChange={(e)=>updateProject(idx, e.target.value)} />
                    <button className="btn" onClick={()=>removeProject(idx)}>Löschen</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>Kürzel/Token (enthält)</h4>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={addToken}>+ Token</button>
                <button className="btn" onClick={bulkAddTokens}>Bulk…</button>
              </div>
              <div style={{ display:'grid', gap:8 }}>
                {tokens.map((t, idx) => (
                  <div key={idx} style={{ display:'grid', gridTemplateColumns:'1fr 80px', gap:8 }}>
                    <input className="input" placeholder="z. B. intern" value={t} onChange={(e)=>updateToken(idx, e.target.value)} />
                    <button className="btn" onClick={()=>removeToken(idx)}>Löschen</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, marginTop:12, alignItems:'center' }}>
            <button className="btn" onClick={save}>Speichern</button>
            <button className="btn" onClick={reset}>Zurücksetzen</button>
            {msg && <div style={{ color:'var(--muted)' }}>{msg}</div>}
          </div>
          {/* Rules editor */}
          <div className="panel" style={{ padding:10, marginTop:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <strong>Regeln (flexibel)</strong>
              <div style={{ flex:1 }} />
              <button className="btn" onClick={()=>addRule({ type:'leistungsart_prefix', op:'include', value:'N' })}>+ LA include</button>
              <button className="btn" onClick={()=>addRule({ type:'leistungsart_prefix', op:'exclude', value:'J' })}>+ LA exclude</button>
              <button className="btn" onClick={()=>addRule({ type:'code_exact', value:'' })}>+ Code exakt</button>
              <button className="btn" onClick={()=>addRule({ type:'token_substring', value:'' })}>+ Token</button>
              <button className="btn" onClick={()=>addRule({ type:'legacy_int_prefix' })}>+ Legacy INT prefix</button>
              <button className="btn" onClick={()=>addRule({ type:'legacy_int_token' })}>+ Legacy INT token</button>
            </div>
            <div style={{ overflowX:'auto', paddingBottom: 8 }}>
              <table className="table sticky" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Aktiv</th>
                    <th>Typ</th>
                    <th>Op</th>
                    <th>Wert</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r, idx)=> (
                    <tr key={r.id||idx}>
                      <td><input type="checkbox" checked={r.enabled!==false} onChange={(e)=>updateRule(idx, { enabled: e.target.checked })} /></td>
                      <td>
                        <select className="input" value={r.type||''} onChange={(e)=>updateRule(idx, { type: e.target.value })}>
                          <option value="leistungsart_prefix">leistungsart_prefix</option>
                          <option value="code_exact">code_exact</option>
                          <option value="token_substring">token_substring</option>
                          <option value="legacy_int_prefix">legacy_int_prefix</option>
                          <option value="legacy_int_token">legacy_int_token</option>
                        </select>
                      </td>
                      <td>
                        {r.type==='leistungsart_prefix' ? (
                          <select className="input" value={r.op||'include'} onChange={(e)=>updateRule(idx, { op: e.target.value })}>
                            <option value="include">include</option>
                            <option value="exclude">exclude</option>
                          </select>
                        ) : <span className="muted">—</span>}
                      </td>
                      <td>
                        {(r.type==='leistungsart_prefix' || r.type==='code_exact' || r.type==='token_substring') ? (
                          <input className="input" value={r.value||''} onChange={(e)=>updateRule(idx, { value: e.target.value })} placeholder={r.type==='leistungsart_prefix'? 'z. B. N, J' : r.type==='code_exact'? 'z. B. INT' : 'z. B. intern'} />
                        ) : <span className="muted">—</span>}
                      </td>
                      <td style={{ whiteSpace:'nowrap' }}>
                        <button className="btn" onClick={()=>moveRule(idx,-1)} title="nach oben">↑</button>
                        <button className="btn" onClick={()=>moveRule(idx, 1)} title="nach unten">↓</button>
                        <button className="btn" onClick={()=>removeRule(idx)} title="löschen">Löschen</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop:8, color:'var(--muted)' }}>
              Standardmäßig sind folgende Regeln vorhanden: Leistungsart include=N, exclude=J, Legacy INT (Prefix/Token). Du kannst sie hier anpassen oder deaktivieren.
            </div>
          </div>
          <div className="panel" style={{ padding:10, marginTop:12 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
              <strong>Schnelltest</strong>
              <span className="muted">(Prüft Codes/Tokens sowie Leistungsart beginnend mit N)</span>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:8 }}>
              <input className="input" placeholder="Projektcode" value={test.code} onChange={(e)=>setTest(t=>({...t, code:e.target.value}))} />
              <input className="input" placeholder="Projektname" value={test.name} onChange={(e)=>setTest(t=>({...t, name:e.target.value}))} />
              <input className="input" placeholder="Leistungsart" value={test.la} onChange={(e)=>setTest(t=>({...t, la:e.target.value}))} />
            </div>
            <div style={{ marginTop:8 }}>
              {testRes.matched ? (
                <span className="badge">Treffer: {testRes.by} {testRes.value? `(${String(testRes.value)})`: ''}</span>
              ) : (
                <span className="badge">Kein Treffer</span>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
