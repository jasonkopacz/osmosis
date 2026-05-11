export function createUsageMeter(used: number, limit: number, resetsAt: string): HTMLElement {
  const wrapper = document.createElement('div')

  const label = document.createElement('div')
  label.className = 'field-label'
  label.textContent = 'Monthly usage'

  const safeLimit = Math.max(limit, 1)
  const pct = Math.min((used / safeLimit) * 100, 100)
  const fillMod = pct >= 85 ? 'osmo-usage__fill--error' : pct >= 60 ? 'osmo-usage__fill--warn' : ''

  const track = document.createElement('div')
  track.className = 'osmo-usage__track'

  const fill = document.createElement('div')
  fill.className = `osmo-usage__fill${fillMod ? ` ${fillMod}` : ''}`
  fill.style.width = `${pct}%`
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
