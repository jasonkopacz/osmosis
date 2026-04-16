export function createSlider(value: number, onChange: (v: number) => void): HTMLElement {
  const wrapper = document.createElement('div')

  const header = document.createElement('div')
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;'

  const labelEl = document.createElement('span')
  labelEl.className = 'field-label'
  labelEl.style.margin = '0'
  labelEl.textContent = 'Word replacement'

  const valueEl = document.createElement('span')
  valueEl.style.cssText = 'font-size:15px;font-weight:700;color:#e2e8f0;'
  valueEl.textContent = `${value}%`

  header.append(labelEl, valueEl)

  const input = document.createElement('input')
  input.type = 'range'
  input.min = '1'
  input.max = '90'
  input.step = '1'
  input.value = String(value)
  input.style.cssText = 'width:100%;accent-color:#3b82f6;cursor:pointer;'
  input.addEventListener('input', () => {
    const v = Number(input.value)
    valueEl.textContent = `${v}%`
    onChange(v)
  })

  const rangeLabels = document.createElement('div')
  rangeLabels.style.cssText = 'display:flex;justify-content:space-between;font-size:11px;color:#718096;margin-top:4px;'
  const minL = document.createElement('span')
  minL.textContent = '1%'
  const maxL = document.createElement('span')
  maxL.textContent = '90%'
  rangeLabels.append(minL, maxL)

  wrapper.append(header, input, rangeLabels)
  return wrapper
}
