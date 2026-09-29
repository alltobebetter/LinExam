import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

/* ── 类型 ── */
type ToastType = 'info' | 'success' | 'error' | 'warning'

interface ToastItem {
  id: number
  type: ToastType
  message: string
  leaving: boolean
}

interface ToastContextValue {
  show: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

/* ── 图标 ── */
const icons: Record<ToastType, ReactNode> = {
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </svg>
  ),
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  ),
}

/* ── 每种类型的样式 ── */
const config: Record<ToastType, {
  iconColor: string
  glow: string
  duration: number
}> = {
  info: {
    iconColor: 'text-slate-500',
    glow: 'shadow-[0_4px_20px_-4px_rgba(0,0,0,0.1)]',
    duration: 2500,
  },
  success: {
    iconColor: 'text-emerald-500',
    glow: 'shadow-[0_4px_20px_-4px_rgba(16,185,129,0.25)]',
    duration: 2500,
  },
  error: {
    iconColor: 'text-red-500',
    glow: 'shadow-[0_4px_20px_-4px_rgba(239,68,68,0.25)]',
    duration: 4000,
  },
  warning: {
    iconColor: 'text-amber-500',
    glow: 'shadow-[0_4px_20px_-4px_rgba(245,158,11,0.25)]',
    duration: 3000,
  },
}

/* ── 单条 Toast ── */
function ToastCard({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const c = config[item.type]
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (item.leaving) return
    timerRef.current = setTimeout(() => onRemove(item.id), c.duration)
    return () => clearTimeout(timerRef.current)
  }, [item.id, item.leaving, c.duration, onRemove])

  return (
    <div
      className={`pointer-events-auto flex items-center gap-2.5 pl-3.5 pr-4 py-2.5 rounded-xl bg-white/95 dark:bg-slate-800/95 backdrop-blur-xl border border-slate-100 dark:border-slate-700 ${c.glow} ${
        item.leaving ? 'toast-leave' : 'toast-enter'
      }`}
    >
      {/* 图标 */}
      <span className={`shrink-0 w-[16px] h-[16px] block ${c.iconColor}`}>
        {icons[item.type]}
      </span>
      {/* 文字 */}
      <span className="text-[13px] font-medium text-slate-700 dark:text-slate-200 leading-tight whitespace-nowrap">
        {item.message}
      </span>
    </div>
  )
}

/* ── Provider ── */
let nextId = 0
const MAX_TOASTS = 3

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 250)
  }, [])

  const show = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId++
    // 追加式：连续提示互不覆盖，超出上限时移除最早的一条
    setToasts((prev) => {
      const next = [...prev, { id, type, message, leaving: false }]
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next
    })
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="fixed top-5 right-5 z-[9999] flex flex-col items-end gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} item={toast} onRemove={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
