import { MAX_TRANSLATION_PERCENTAGE, MIN_TRANSLATION_PERCENTAGE } from '../../constants'

export function createSlider(value: number, onChange: (v: number) => void): HTMLElement {
  const wrapper = document.createElement('div')

  const header = document.createElement('div')
  header.className = 'osmo-slider__header'

  const labelEl = document.createElement('span')
  labelEl.className = 'field-label'
  labelEl.style.margin = '0'
  labelEl.textContent = 'Words to translate'

  const clampedValue = Math.max(MIN_TRANSLATION_PERCENTAGE, Math.min(MAX_TRANSLATION_PERCENTAGE, value))

  const valueEl = document.createElement('span')
  valueEl.className = 'osmo-slider__value'
  valueEl.textContent = `${clampedValue}%`

  header.append(labelEl, valueEl)

  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(MIN_TRANSLATION_PERCENTAGE)
  input.max = String(MAX_TRANSLATION_PERCENTAGE)
  input.step = '1'
  input.value = String(clampedValue)
  input.className = 'osmo-range'
  input.addEventListener('input', () => { valueEl.textContent = `${Number(input.value)}%` })
  input.addEventListener('change', () => { onChange(Number(input.value)) })

  const rangeLabels = document.createElement('div')
  rangeLabels.className = 'osmo-slider__labels'
  const minL = document.createElement('span')
  minL.textContent = `${MIN_TRANSLATION_PERCENTAGE}%`
  const maxL = document.createElement('span')
  maxL.textContent = `${MAX_TRANSLATION_PERCENTAGE}%`
  rangeLabels.append(minL, maxL)

  wrapper.append(header, input, rangeLabels)
  return wrapper
}
