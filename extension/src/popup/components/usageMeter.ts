export function createUsageMeter(used: number, limit: number, resetsAt: string): HTMLElement {
  const wrapper = document.createElement('div')

  const label = document.createElement('div')
  label.className = 'field-label'
  label.textContent = 'Monthly usage'

  const safeLimit = Math.max(limit, 1)
  const pct = Math.min((used / safeLimit) * 100, 100)
  const fillGlow = pct >= 100
    ? '0 0 12px rgba(248,113,113,0.6)'
    : pct >= 85
      ? '0 0 12px rgba(245,158,11,0.5)'
      : '0 0 12px rgba(34,211,238,0.5)'

  const track = document.createElement('div')
  track.className = 'osmo-usage__track'

  const fill = document.createElement('div')
  fill.className = 'osmo-usage__fill'
  fill.style.width = `${pct}%`
  fill.style.boxShadow = fillGlow
  track.appendChild(fill)

  const row = document.createElement('div')
  row.className = 'osmo-usage__row'

  const usedEl = document.createElement('span')
  const usedStrong = document.createElement('b')
  usedStrong.textContent = used.toLocaleString()
  usedEl.append(usedStrong, ` / ${limit.toLocaleString()} chars`)

  const resetEl = document.createElement('span')
  const d = new Date(resetsAt)
  resetEl.textContent = `Resets ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  row.append(usedEl, resetEl)
  wrapper.append(label, track, row)
  return wrapper
}
