import { CEFR_LEVELS, CEFR_LABELS, CEFR_DESCRIPTIONS } from '../../content/cefr'
import type { CefrMinLevel } from '../../content/cefr'

export function createCefrPicker(
  value: CefrMinLevel,
  onChange: (level: CefrMinLevel) => void,
): HTMLElement {
  const wrapper = document.createElement('div')

  const pickerEl = document.createElement('div')
  pickerEl.className = 'cefr-picker'

  const descEl = document.createElement('div')
  descEl.className = 'cefr-description'
  descEl.textContent = CEFR_DESCRIPTIONS[value]

  const buttons = new Map<CefrMinLevel, HTMLButtonElement>()

  function select(level: CefrMinLevel): void {
    buttons.forEach((btn, l) => {
      btn.classList.toggle('cefr-btn--active', l === level)
    })
    descEl.textContent = CEFR_DESCRIPTIONS[level]
    descEl.classList.toggle('cefr-description--active', level !== 'all')
    onChange(level)
  }

  for (const level of CEFR_LEVELS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'cefr-btn'
    if (level === value) btn.classList.add('cefr-btn--active')
    btn.textContent = CEFR_LABELS[level]
    btn.setAttribute('aria-label', CEFR_DESCRIPTIONS[level])
    btn.addEventListener('click', () => select(level))
    buttons.set(level, btn)
    pickerEl.appendChild(btn)
  }

  descEl.classList.toggle('cefr-description--active', value !== 'all')
  wrapper.append(pickerEl, descEl)
  return wrapper
}
