export function createToggle(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.cssText = 'display:flex;align-items:center;gap:8px;'

  const label = document.createElement('span')
  label.style.cssText = 'font-size:12px;color:#718096;'
  label.textContent = checked ? 'ON' : 'OFF'

  const track = document.createElement('div')
  track.style.cssText = `width:40px;height:22px;border-radius:999px;position:relative;cursor:pointer;background:${checked ? '#3b82f6' : '#4a5568'};transition:background 0.2s;`

  const thumb = document.createElement('div')
  thumb.style.cssText = `width:16px;height:16px;background:white;border-radius:50%;position:absolute;top:3px;transition:left 0.2s;left:${checked ? '21px' : '3px'};box-shadow:0 1px 3px rgba(0,0,0,0.3);`
  track.appendChild(thumb)

  track.addEventListener('click', () => {
    checked = !checked
    track.style.background = checked ? '#3b82f6' : '#4a5568'
    thumb.style.left = checked ? '21px' : '3px'
    label.textContent = checked ? 'ON' : 'OFF'
    onChange(checked)
  })

  wrapper.append(label, track)
  return wrapper
}
