import { useEffect, useState, useRef, type ReactNode } from 'react'
import CustomScroll from './CustomScroll'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function Modal({ open, onClose, title, children }: ModalProps) {
  // mounted: DOM 是否存在（延迟卸载）
  // show: 是否处于进场状态（false = 播放退场动画）
  const [mounted, setMounted] = useState(open)
  const [show, setShow] = useState(open)

  // 记录 mousedown 是否发生在遮罩上
  // 只有 mousedown 和 mouseup 都在遮罩上才关闭，避免拖拽时误关
  const mouseDownOnBackdrop = useRef(false)

  useEffect(() => {
    if (open) {
      // 打开：同时设置 mounted 和 show，CSS animation 会在元素挂载时自动播放
      setMounted(true)
      setShow(true)
    } else if (mounted) {
      // 关闭：先播退场动画，结束后再卸载
      setShow(false)
      const timer = setTimeout(() => setMounted(false), 250)
      return () => clearTimeout(timer)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  const panelRef = useRef<HTMLDivElement>(null)

  if (!mounted) return null

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center"
      onMouseDown={(e) => {
        // 记录 mousedown 是否发生在遮罩区域（而非弹窗内容内）
        mouseDownOnBackdrop.current = !panelRef.current?.contains(e.target as Node)
      }}
      onClick={(e) => {
        // 只有 mousedown 和 mouseup(click) 都在遮罩上才关闭
        // 这样拖拽滚动条时鼠标移出弹窗松开也不会误关
        if (mouseDownOnBackdrop.current && !panelRef.current?.contains(e.target as Node)) {
          onClose()
        }
      }}
    >
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm ${
          show ? 'modal-overlay-enter' : 'modal-overlay-leave'
        }`}
      />

      {/* 弹窗主体 */}
      <div
        ref={panelRef}
        className={`relative w-[520px] max-w-[90vw] max-h-[80vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl shadow-slate-900/20 flex flex-col overflow-hidden ${
          show ? 'modal-panel-enter' : 'modal-panel-leave'
        }`}
      >
        {/* 顶栏 */}
        <div className="shrink-0 h-[56px] flex items-center justify-between px-6 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-[17px] font-bold text-slate-800 dark:text-slate-100">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <CustomScroll className="flex-grow min-h-0">
          <div className="px-6 py-5">
            {children}
          </div>
        </CustomScroll>
      </div>
    </div>
  )
}
