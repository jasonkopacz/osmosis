const LEVELS = [
  { label: 'Light',  pct: 15, desc: 'A word or two per sentence' },
  { label: 'Medium', pct: 30, desc: 'Noticeable — roughly every third word' },
  { label: 'Heavy',  pct: 55, desc: 'Immersive — most content translated' },
] as const

type Level = typeof LEVELS[number]

function nearestLevel(pct: number): Level {
  return LEVELS.reduce((best, l) =>
    Math.abs(l.pct - pct) < Math.abs(best.pct - pct) ? l : best
  )
}

export function createIntensityPicker(value: number, onChange: (v: number) => void): HTMLElement {
  const wrapper = document.createElement('div')

  const labelEl = document.createElement('div')
  labelEl.className = 'field-label'
  labelEl.textContent = 'Words to translate'

  const picker = document.createElement('div')
  picker.className = 'cefr-picker'

  const desc = document.createElement('div')
  desc.className = 'cefr-description'

  let active = nearestLevel(value)

  function updateUI(level: Level): void {
    desc.textContent = level.desc
    desc.classList.toggle('cefr-description--active', true)
    buttons.forEach((btn, l) => {
      btn.classList.toggle('cefr-btn--active', l === level)
    })
  }

  function select(level: Level): void {
    active = level
    updateUI(level)
    onChange(level.pct)
  }

  const buttons = new Map<Level, HTMLButtonElement>()
  for (const level of LEVELS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cefr-btn'
    btn.textContent = level.label
    btn.addEventListener('click', () => select(level))
    buttons.set(level, btn)
    picker.appendChild(btn)
  }

  updateUI(active)

  wrapper.append(labelEl, picker, desc)
  return wrapper
}
