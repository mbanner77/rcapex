import React, { useEffect, useState } from 'react'
import { getInternalMapping, saveInternalMapping } from '../lib/mapping'
import { getInternalMappingServer, updateInternalMappingServer } from '../lib/api'

export default function InternalMappingDialog({ onClose }){
  const [projects, setProjects] = useState([])
  const [tokens, setTokens] = useState([])
  const [msg, setMsg] = useState('')
  const [srvMsg, setSrvMsg] = useState('')

  useEffect(()=>{
    const m = getInternalMapping()
    setProjects(Array.isArray(m.projects) ? m.projects : [])
    setTokens(Array.isArray(m.tokens) ? m.tokens : [])
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
    }
    try{
      saveInternalMapping(cleaned)
      setMsg('Gespeichert')
      setTimeout(()=>{ onClose?.() }, 350)
    }catch(e){ setMsg('Fehler: '+(e?.message||e)) }
  }

  function reset(){ setProjects([]); setTokens([]); setMsg('Zurückgesetzt (nicht gespeichert)') }

  async function loadFromServer(){
    setSrvMsg('Lade vom Server…')
    try{
      const m = await getInternalMappingServer()
      setProjects(Array.isArray(m.projects)? m.projects : [])
      setTokens(Array.isArray(m.tokens)? m.tokens : [])
      setSrvMsg('Vom Server geladen')
    }catch(e){ setSrvMsg('Fehler: '+(e?.response?.data?.message || e.message)) }
  }

  async function saveToServer(){
    setSrvMsg('Speichere zum Server…')
    try{
      const cleaned = {
        projects: projects.map(s=> String(s||'').trim()).filter(Boolean),
        tokens: tokens.map(s=> String(s||'').trim()).filter(Boolean),
      }
      await updateInternalMappingServer(cleaned)
      setSrvMsg('Auf Server gespeichert')
    }catch(e){ setSrvMsg('Fehler: '+(e?.response?.data?.message || e.message)) }
  }

  function exportJson(){
    const cleaned = {
      projects: projects.map(s=> String(s||'').trim()).filter(Boolean),
      tokens: tokens.map(s=> String(s||'').trim()).filter(Boolean),
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
        setMsg('Importiert (lokal, noch nicht gespeichert)')
      }catch(err){ setMsg('Fehler beim Import: '+(err?.message||err)) }
    }
    inp.click()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <h3 style={{ margin:0 }}>Interne Projekte – Mapping</h3>
          <div style={{ flex:1 }} />
          <button className="btn" onClick={onClose}>Schließen</button>
        </div>
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
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <h4 style={{ margin:0 }}>Projektcodes (exakt)</h4>
                <div style={{ flex:1 }} />
                <button className="btn" onClick={addProject}>+ Code</button>
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
        </div>
      </div>
    </div>
  )
}
