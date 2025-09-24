import React, { useEffect, useState } from 'react'
import { getInternalMapping, saveInternalMapping } from '../lib/mapping'

export default function InternalMappingDialog({ onClose }){
  const [projects, setProjects] = useState([])
  const [tokens, setTokens] = useState([])
  const [msg, setMsg] = useState('')

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
