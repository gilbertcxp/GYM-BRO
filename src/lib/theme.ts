export type Theme = 'dark' | 'light'
const KEY = 'gymbro.theme'

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('light', t === 'light')
  document.documentElement.classList.toggle('dark', t === 'dark')
  try { localStorage.setItem(KEY, t) } catch { /* ignorar */ }
}
