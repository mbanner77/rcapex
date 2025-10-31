export const chartPalette = {
  text: 'var(--chart-text)',
  muted: 'var(--chart-muted)',
  grid: 'var(--chart-grid)',
  tooltipBg: 'var(--chart-tooltip-bg)',
  tooltipBorder: 'var(--chart-tooltip-border)',
}

export const chartTooltip = {
  backgroundColor: chartPalette.tooltipBg,
  borderColor: chartPalette.tooltipBorder,
  borderWidth: 1,
  titleColor: chartPalette.text,
  bodyColor: chartPalette.text,
  footerColor: chartPalette.text,
}

export function applyDarkScales(scales = {}) {
  const baseAxis = {
    ticks: { color: chartPalette.muted },
    grid: { color: chartPalette.grid },
  }
  const result = {}
  if (scales.x) {
    result.x = { ...baseAxis, ...scales.x, ticks: { ...baseAxis.ticks, ...(scales.x.ticks||{}) }, grid: { ...baseAxis.grid, ...(scales.x.grid||{}) } }
  }
  if (scales.y) {
    result.y = { ...baseAxis, ...scales.y, ticks: { ...baseAxis.ticks, ...(scales.y.ticks||{}) }, grid: { ...baseAxis.grid, ...(scales.y.grid||{}) } }
  }
  if (scales.xaxis) {
    result.xaxis = { ...baseAxis, ...scales.xaxis }
  }
  if (scales.yaxis) {
    result.yaxis = { ...baseAxis, ...scales.yaxis }
  }
  return { ...scales, ...result }
}

export function withChartTheme(options = {}) {
  const { plugins = {}, scales, ...rest } = options
  const themedPlugins = {
    ...plugins,
    legend: plugins.legend ? {
      ...plugins.legend,
      labels: { color: chartPalette.text, ...(plugins.legend.labels || {}) },
    } : undefined,
    title: plugins.title ? {
      ...plugins.title,
      color: chartPalette.text,
    } : undefined,
    tooltip: plugins.tooltip ? { ...chartTooltip, ...plugins.tooltip } : chartTooltip,
  }
  return {
    ...rest,
    plugins: themedPlugins,
    scales: scales ? applyDarkScales(scales) : undefined,
  }
}
