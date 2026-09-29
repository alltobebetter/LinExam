import { useState, useEffect } from 'react'
import { useTheme } from './ThemeProvider'

const modes = [
  {
    key: 'system' as const,
    label: '跟随系统',
    icon: (
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    key: 'light' as const,
    label: '亮色',
    icon: (
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    ),
  },
  {
    key: 'dark' as const,
    label: '暗色',
    icon: (
      <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    ),
  },
]

export default function TitleBar() {
  const [maximized, setMaximized] = useState(false)
  const { mode, setMode } = useTheme()

  useEffect(() => {
    // 初始状态
    window.exampower?.isMaximized().then(setMaximized)
    // 窗口状态变化事件（替代 300ms 轮询）
    const onChange = (isMax: boolean) => setMaximized(isMax)
    const off = window.exampower?.onWindowMaximizedChange?.(onChange)
    return () => off?.()
  }, [])

  const handleMinimize = () => window.exampower?.minimize()
  const handleToggleMaximize = () => window.exampower?.toggleMaximize()
  const handleClose = () => window.exampower?.close()

  return (
    <div
      className="h-[36px] shrink-0 flex items-center justify-between bg-slate-50 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 select-none transition-colors"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧：应用名称 */}
      <div className="flex items-center gap-2 pl-4">
        <div className="flex items-center gap-1.5">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">LinExam</span>
        </div>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* 三态主题切换 */}
        <div className="flex items-center mr-2 rounded-md bg-slate-200/60 dark:bg-slate-800/80 p-0.5">
          {modes.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              title={m.label}
              className={`flex items-center justify-center w-[24px] h-[22px] rounded transition-colors ${
                mode === m.key
                  ? 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 shadow-sm'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              {m.icon}
            </button>
          ))}
        </div>

        {/* 最小化 */}
        <button
          onClick={handleMinimize}
          className="w-[44px] h-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
          title="最小化"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        </button>

        {/* 最大化/还原 */}
        <button
          onClick={handleToggleMaximize}
          className="w-[44px] h-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
          title={maximized ? '还原' : '最大化'}
        >
          {maximized ? (
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="8" width="12" height="12" rx="1.5" />
              <path d="M4 16V6a2 2 0 0 1 2-2h10" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="1.5" />
            </svg>
          )}
        </button>

        {/* 关闭 */}
        <button
          onClick={handleClose}
          className="w-[44px] h-full flex items-center justify-center text-slate-500 dark:text-slate-400 hover:bg-red-500 hover:text-white transition-colors"
          title="关闭"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
