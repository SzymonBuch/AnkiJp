export type ThemeMode = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'ankijp-theme'

let currentMode: ThemeMode = 'system'
let mql: MediaQueryList | null = null

function onSystemChange(event: MediaQueryListEvent): void {
  if (currentMode === 'system') {
    document.documentElement.classList.toggle('dark', event.matches)
  }
}

export function getThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    // localStorage unavailable (private mode) — fall through to system.
  }
  return 'system'
}

export function applyTheme(mode: ThemeMode): void {
  currentMode = mode
  if (!mql) {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', onSystemChange)
  }
  const dark = mode === 'dark' || (mode === 'system' && mql.matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Ignore persistence failures; the class is still applied.
  }
  applyTheme(mode)
}
