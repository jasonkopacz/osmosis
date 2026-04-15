export function createUsageMeter(used: number, limit: number, resetsAt: string): HTMLElement {
  const wrapper = document.createElement('div')

  const label = document.createElement('div')
  label.className = 'field-label'
  label.textContent = 'Monthly usage'

  const safeLimit = Math.max(limit, 1)
  const pct = Math.min((used / safeLimit) * 100, 100)
  const color = pct < 60 ? '#10b981' : pct < 85 ? '#f59e0b' : '#ef4444'

  const track = document.createElement('div')
  track.style.cssText = 'height:6px;background:#2d3748;border-radius:999px;overflow:hidden;margin-top:8px;'
  const fill = document.createElement('div')
  fill.style.cssText = `height:100%;width:${pct}%;background:${color};border-radius:999px;`
  track.appendChild(fill)

  const row = document.createElement('div')
  row.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;color:#a0aec0;margin-top:5px;'

  const usedEl = document.createElement('span')
  usedEl.textContent = `${used.toLocaleString()} / ${limit.toLocaleString()} chars`

  const resetEl = document.createElement('span')
  const d = new Date(resetsAt)
  resetEl.textContent = `Resets ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  row.append(usedEl, resetEl)
  wrapper.append(label, track, row)
  return wrapper
}
