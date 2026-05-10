export function showToast(message: string, type: 'success' | 'info' = 'success'): void {
  document.getElementById('osmosis-toast')?.remove()

  const toast = document.createElement('div')
  toast.id = 'osmosis-toast'
  toast.className = `osmo-toast${type === 'success' ? ' osmo-toast--success' : ''}`
  toast.textContent = message

  document.body.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 220)
  }, 2200)
}
