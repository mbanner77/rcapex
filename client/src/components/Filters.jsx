import React, { useMemo, useState, useEffect } from 'react'
import { getUnits } from '../lib/constants'
import { Sparkles, Calendar, TrendingUp } from 'lucide-react'

export default function Filters({ params, onParamsChange }) {
  function update(key, value) {
    onParamsChange((p) => ({ ...p, [key]: value }))
  }

  const [useCustomUnit, setUseCustomUnit] = useState(false)
  const [showAiSuggestions, setShowAiSuggestions] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState(null)
  const [units, setUnits] = useState(() => getUnits())
  useEffect(() => {
    const onUnits = () => setUnits(getUnits())
    window.addEventListener('units_changed', onUnits)
    return () => window.removeEventListener('units_changed', onUnits)
  }, [])
  const unitOptions = useMemo(() => units, [units])
  const selectedUnit = useMemo(() => {
    if (params.unit === 'ALL') return 'ALL'
    return unitOptions.find(u => u.ext_id === params.unit)?.ext_id || ''
  }, [unitOptions, params.unit])

  // AI-gestützte Vorschläge generieren
  function generateAiSuggestions() {
    const now = new Date()
    const suggestions = []
    
    // Vorschlag 1: Aktueller Monat
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    suggestions.push({
      icon: 'calendar',
      title: 'Aktueller Monat',
      description: `${monthStart.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} - Zeigt alle Daten des laufenden Monats`,
      params: {
        datum_von: monthStart.toISOString(),
        datum_bis: monthEnd.toISOString()
      }
    })
    
    // Vorschlag 2: Letzte 7 Tage
    const last7Days = new Date(now)
    last7Days.setDate(last7Days.getDate() - 7)
    suggestions.push({
      icon: 'trending',
      title: 'Letzte 7 Tage',
      description: 'Schneller Überblick über die aktuelle Woche',
      params: {
        datum_von: last7Days.toISOString(),
        datum_bis: now.toISOString()
      }
    })
    
    // Vorschlag 3: Letzter Monat
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    suggestions.push({
      icon: 'calendar',
      title: 'Letzter Monat',
      description: `${lastMonthStart.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })} - Vollständige Monatsauswertung`,
      params: {
        datum_von: lastMonthStart.toISOString(),
        datum_bis: lastMonthEnd.toISOString()
      }
    })
    
    // Vorschlag 4: Quartal
    const quarter = Math.floor(now.getMonth() / 3)
    const quarterStart = new Date(now.getFullYear(), quarter * 3, 1)
    const quarterEnd = new Date(now.getFullYear(), (quarter + 1) * 3, 0, 23, 59, 59)
    suggestions.push({
      icon: 'trending',
      title: `Q${quarter + 1} ${now.getFullYear()}`,
      description: 'Aktuelles Quartal für Trend-Analysen',
      params: {
        datum_von: quarterStart.toISOString(),
        datum_bis: quarterEnd.toISOString()
      }
    })
    
    setAiSuggestions({
      reasoning: 'Basierend auf typischen Analyse-Mustern habe ich folgende Zeiträume für Sie vorbereitet:',
      suggestions
    })
    setShowAiSuggestions(true)
  }
  
  function applySuggestion(suggestion) {
    Object.entries(suggestion.params).forEach(([key, value]) => {
      update(key, value)
    })
    setShowAiSuggestions(false)
  }

  return (
    <div className="toolbar" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Datum von</label>
        <input
          type="datetime-local"
          value={toLocal(params.datum_von)}
          onChange={(e) => update('datum_von', fromLocal(e.target.value))}
          className="input"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Datum bis</label>
        <input
          type="datetime-local"
          value={toLocal(params.datum_bis)}
          onChange={(e) => update('datum_bis', fromLocal(e.target.value))}
          className="input"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280 }}>
        <label style={{ fontSize: 12, color: 'var(--muted)' }}>Unit</label>
        {!useCustomUnit ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="input"
              value={selectedUnit}
              onChange={(e) => update('unit', e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="ALL">Alle</option>
              {unitOptions.map((u) => (
                <option key={u.ext_id} value={u.ext_id}>{u.name}</option>
              ))}
            </select>
            <button type="button" className="input" style={{ padding: '10px 12px' }} onClick={() => setUseCustomUnit(true)}>Andere…</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={params.unit}
              onChange={(e) => update('unit', e.target.value)}
              className="input"
              style={{ flex: 1 }}
              placeholder="ext_id manuell eingeben"
            />
            <button type="button" className="input" style={{ padding: '10px 12px' }} onClick={() => setUseCustomUnit(false)}>Liste</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* AI-Assistent Button */}
      <button 
        type="button" 
        className="btn"
        onClick={() => generateAiSuggestions()}
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        title="AI-Vorschläge für optimale Filtereinstellungen"
      >
        <Sparkles size={16} />
        AI-Vorschläge
      </button>

      <small style={{ color: 'var(--muted)' }}>API-Filter werden als Header an den Proxy gesendet.</small>
      
      {/* AI Suggestions Panel */}
      {showAiSuggestions && aiSuggestions && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          maxWidth: 500,
          width: '90%',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          zIndex: 1000
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={20} />
              AI-Vorschläge
            </h3>
            <button onClick={() => setShowAiSuggestions(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20 }}>×</button>
          </div>
          
          <div style={{ marginBottom: 16 }}>
            <p style={{ color: 'var(--muted)', marginBottom: 12 }}>{aiSuggestions.reasoning}</p>
            
            {aiSuggestions.suggestions.map((suggestion, idx) => (
              <div key={idx} style={{
                padding: 12,
                background: 'var(--bg-secondary)',
                borderRadius: 6,
                marginBottom: 8,
                cursor: 'pointer',
                border: '1px solid transparent',
                transition: 'border-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--primary)'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'transparent'}
              onClick={() => applySuggestion(suggestion)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {suggestion.icon === 'calendar' && <Calendar size={16} />}
                  {suggestion.icon === 'trending' && <TrendingUp size={16} />}
                  <strong>{suggestion.title}</strong>
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>{suggestion.description}</div>
              </div>
            ))}
          </div>
          
          <button className="btn" onClick={() => setShowAiSuggestions(false)} style={{ width: '100%' }}>Schließen</button>
        </div>
      )}
      
      {/* Backdrop */}
      {showAiSuggestions && (
        <div 
          onClick={() => setShowAiSuggestions(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 999
          }}
        />
      )}
    </div>
  )
}

function toLocal(zIso) {
  if (!zIso) return ''
  const d = new Date(zIso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocal(local) {
  if (!local) return ''
  // treat as local and convert to Z
  const d = new Date(local)
  return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,19) + 'Z'
}
