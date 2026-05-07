import { MAX_TRANSLATION_PERCENTAGE, MIN_TRANSLATION_PERCENTAGE } from '../../constants'

export function createSlider(value: number, onChange: (v: number) => void): HTMLElement {
  const wrapper = document.createElement('div')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'

  const labelEl = document.createElement('span')
  labelEl.className = 'field-label'
  labelEl.style.margin = '0'
  labelEl.textContent = 'Words to translate'

  const valueEl = document.createElement('span')
  valueEl.style.cssText = 'font-size:15px;font-weight:700;color:#e2e8f0;'
  const clampedValue = Math.max(MIN_TRANSLATION_PERCENTAGE, Math.min(MAX_TRANSLATION_PERCENTAGE, value))
  valueEl.textContent = `${clampedValue}%`

  header.append(labelEl, valueEl)

  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(MIN_TRANSLATION_PERCENTAGE)
  input.max = String(MAX_TRANSLATION_PERCENTAGE)
  input.step = '1'
  input.value = String(clampedValue)
  input.style.cssText = 'width:100%;accent-color:#3b82f6;cursor:pointer;'
  input.addEventListener('input', () => {
    valueEl.textContent = `${Number(input.value)}%`
  })
  input.addEventListener('change', () => {
    onChange(Number(input.value))
  })

  const rangeLabels = document.createElement('div')
  rangeLabels.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#718096;margin-top:4px;'
  const minL = document.createElement('span')
  minL.textContent = `${MIN_TRANSLATION_PERCENTAGE}%`
  const maxL = document.createElement('span')
  maxL.textContent = `${MAX_TRANSLATION_PERCENTAGE}%`
  rangeLabels.append(minL, maxL)

  wrapper.append(header, input, rangeLabels)
  return wrapper
}
