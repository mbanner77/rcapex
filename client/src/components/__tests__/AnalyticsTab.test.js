import { describe, expect, it } from 'vitest'
import { buildTrendBullets, computeMonthlyTotals, formatMonthLabel } from '../AnalyticsTab.jsx'

describe('AnalyticsTab helper utilities', () => {
  describe('computeMonthlyTotals', () => {
    it('groups values by month and sums metric', () => {
      const items = [
        { datum: '2025-01-02', stunden_fakt: 4 },
        { datum: '2025-01-15', stunden_fakt: 6 },
        { datum: '2025-02-01', stunden_fakt: 3 },
        { datum: 'invalid', stunden_fakt: 100 },
      ]
      expect(computeMonthlyTotals(items, 'stunden_fakt')).toEqual([
        { month: '2025-01', total: 10 },
        { month: '2025-02', total: 3 },
      ])
    })

    it('ignores non-numeric metric values', () => {
      const items = [
        { datum: '2025-03-05', stunden_gel: '12' },
        { datum: '2025-03-06', stunden_gel: 'abc' },
      ]
      expect(computeMonthlyTotals(items, 'stunden_gel')).toEqual([
        { month: '2025-03', total: 12 },
      ])
    })
  })

  describe('formatMonthLabel', () => {
    it('formats YYYY-MM to german month label', () => {
      expect(formatMonthLabel('2025-04')).toContain('April 2025')
    })

    it('returns input when parsing fails', () => {
      expect(formatMonthLabel('bad-value')).toBe('bad-value')
    })
  })

  describe('buildTrendBullets', () => {
    it('handles empty input', () => {
      expect(buildTrendBullets([], 'fakturierten Stunden')).toEqual([
        {
          id: 'trend-none',
          type: 'Info',
          title: 'Keine Zeitreihen',
          detail: 'Für den aktuellen Zeitraum liegen keine Monatsdaten vor.',
        },
      ])
    })

    it('describes single month', () => {
      const bullets = buildTrendBullets([{ month: '2025-07', total: 12.5 }], 'geleisteten Stunden')
      expect(bullets[0].type).toBe('Trend')
      expect(bullets[0].detail).toContain('Nur ein Monat verfügbar')
      expect(bullets[0].detail).toContain('geleisteten Stunden')
    })

    it('captures last month change and strongest delta', () => {
      const totals = [
        { month: '2025-04', total: 10 },
        { month: '2025-05', total: 30 },
        { month: '2025-06', total: 20 },
      ]
      const bullets = buildTrendBullets(totals, 'geleisteten Stunden')
      expect(bullets[0].type).toBe('Trend')
      expect(bullets[0].detail).toContain('Rückgang')
      expect(bullets[0].detail).toContain('Mai 2025')
      expect(bullets[1].title).toContain('Größte Steigerung')
    })
  })
})
