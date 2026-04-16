import { LANGUAGES } from '../../languages'

export function createLanguagePicker(selected: string, onChange: (code: string) => void): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.position = 'relative'

  const input = document.createElement('input')
  input.type = 'text'
  input.style.cssText = 'width:100%;background:#2d3748;border:1px solid #4a5568;border-radius:8px;padding:7px 10px;color:#e2e8f0;font-size:13px;outline:none;'
  const cur = LANGUAGES.find(l => l.code === selected)
  input.value = cur ? `${cur.flag} ${cur.name}` : selected

  const dropdown = document.createElement('div')
  dropdown.style.cssText = 'display:none;position:absolute;background:#2d3748;border:1px solid #4a5568;border-radius:8px;max-height:160px;overflow-y:auto;z-index:999;width:100%;margin-top:2px;'

  function renderList(query: string) {
    dropdown.replaceChildren()
    const q = query.toLowerCase()
    const filtered = LANGUAGES.filter(
      l => l.name.toLowerCase().includes(q) || l.code.toLowerCase().startsWith(q)
    )
    filtered.forEach(lang => {
      const item = document.createElement('div')
      item.style.cssText = 'padding:7px 10px;cursor:pointer;font-size:13px;'
      item.textContent = `${lang.flag} ${lang.name}`
      item.addEventListener('mouseover', () => {
        item.style.background = '#374151'
      })
      item.addEventListener('mouseout', () => {
        item.style.background = ''
      })
      item.addEventListener('mousedown', () => {
        input.value = `${lang.flag} ${lang.name}`
        dropdown.style.display = 'none'
        onChange(lang.code)
      })
      dropdown.appendChild(item)
    })
    dropdown.style.display = filtered.length > 0 ? 'block' : 'none'
  }

  input.addEventListener('focus', () => renderList(''))
  input.addEventListener('input', () => renderList(input.value))
  input.addEventListener('blur', () => setTimeout(() => { dropdown.style.display = 'none' }, 150))

  wrapper.append(input, dropdown)
  return wrapper
}
