import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type ThemeMode = 'system' | 'light' | 'dark'
type Theme = 'light' | 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  theme: Theme
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

const STORAGE_KEY = 'linexam-theme-mode'

function getSystemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'system'
  })

  // theme 是实际生效的主题（mode=system 时跟随系统）
  const [theme, setTheme] = useState<Theme>(() =>
    mode === 'system' ? getSystemTheme() : mode
  )

  // mode 变化时更新 theme
  useEffect(() => {
    if (mode !== 'system') {
      setTheme(mode)
      return
    }
    // system 模式：立即同步 + 监听变化
    setTheme(getSystemTheme())
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [mode])

  // 应用到 <html>
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  const setMode = (m: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, m)
    setModeState(m)
  }

  return (
    <ThemeContext.Provider value={{ mode, theme, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}
