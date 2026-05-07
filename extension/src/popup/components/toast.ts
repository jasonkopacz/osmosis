export function showToast(message: string, type: 'success' | 'info' = 'success'): void {
  document.getElementById('osmosis-toast')?.remove()

  const toast = document.createElement('div')
  toast.id = 'osmosis-toast'
  toast.textContent = message
  const borderColor = type === 'success' ? 'rgba(34,211,238,0.35)' : 'rgba(251,191,36,0.35)'
  toast.style.cssText = [
    'position:fixed', 'bottom:14px', 'left:50%', 'transform:translateX(-50%)',
    'background:rgba(15,23,42,0.96)',
    `border:1px solid ${borderColor}`,
    'border-radius:8px', 'padding:7px 14px',
    'color:#ecfeff', 'font-size:12px', 'font-weight:500',
    'white-space:nowrap', 'z-index:9999',
    'opacity:1', 'transition:opacity 0.3s ease', 'pointer-events:none',
  ].join(';')

  document.body.appendChild(toast)
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300) }, 2200)
}
