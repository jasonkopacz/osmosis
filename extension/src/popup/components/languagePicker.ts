import { LANGUAGES } from '../../languages'

export function createLanguagePicker(selected: string, onChange: (code: string) => void): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.position = 'relative'

  const cur = LANGUAGES.find(l => l.code === selected)
  let selectedDisplay = cur ? `${cur.flag} ${cur.name}` : selected

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'osmo-lang-input'
  input.value = selectedDisplay

  const dropdown = document.createElement('div')
  dropdown.className = 'osmo-lang-dropdown'

  function renderList(query: string) {
    dropdown.replaceChildren()
    const q = query.toLowerCase()
    const filtered = LANGUAGES.filter(
      l => l.name.toLowerCase().includes(q) || l.code.toLowerCase().startsWith(q)
    )
    filtered.forEach(lang => {
      const item = document.createElement('div')
      item.className = 'osmo-lang-item'
      item.textContent = `${lang.flag} ${lang.name}`
      item.addEventListener('mousedown', () => {
        selectedDisplay = `${lang.flag} ${lang.name}`
        input.value = selectedDisplay
        dropdown.classList.remove('osmo-lang-dropdown--open')
        onChange(lang.code)
      })
      dropdown.appendChild(item)
    })
    dropdown.classList.toggle('osmo-lang-dropdown--open', filtered.length > 0)
  }

  input.addEventListener('focus', () => {
    input.value = ''
    input.placeholder = selectedDisplay
    renderList('')
  })
  input.addEventListener('input', () => renderList(input.value))
  input.addEventListener('blur', () => setTimeout(() => {
    dropdown.classList.remove('osmo-lang-dropdown--open')
    input.value = selectedDisplay
    input.placeholder = ''
  }, 150))

  wrapper.append(input, dropdown)
  return wrapper
}
