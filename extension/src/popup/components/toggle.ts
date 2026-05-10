export function createToggle(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const track = document.createElement('div')
  track.className = checked ? 'osmo-toggle osmo-toggle--on' : 'osmo-toggle'
  track.setAttribute('role', 'switch')
  track.setAttribute('aria-checked', String(checked))
  track.setAttribute('tabindex', '0')

  const thumb = document.createElement('div')
  thumb.className = 'osmo-toggle__thumb'
  track.appendChild(thumb)

  function toggle() {
    checked = !checked
    track.classList.toggle('osmo-toggle--on', checked)
    track.setAttribute('aria-checked', String(checked))
    onChange(checked)
  }

  track.addEventListener('click', toggle)
  track.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle() }
  })

  return track
}
