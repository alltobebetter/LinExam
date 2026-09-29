import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { useTheme } from './ThemeProvider'

interface CustomScrollProps {
  children: ReactNode
  className?: string
  /** thumb 颜色，默认 slate-300 */
  thumbColor?: string
  /** thumb hover 颜色，默认 slate-400 */
  thumbHoverColor?: string
  /** thumb 宽度 px，默认 6 */
  thumbWidth?: number
  /** 自动隐藏：hover/scroll 时显示，空闲后淡出 */
  autoHide?: boolean
  /** 隐藏延迟 ms */
  hideDelay?: number
}

/**
 * 自定义滚动条组件
 *
 * 可见性状态机（参考 OverlayScrollbars 的 `leave` 模式）：
 * - 可见条件：鼠标在容器内 (hovering) OR 正在滚动 OR 正在拖拽
 * - 隐藏条件：以上都不满足，经过 hideDelay 后淡出
 *
 * 所有可能被定时器读取的状态都用 ref，避免闭包捕获旧值。
 */
export default function CustomScroll({
  children,
  className = '',
  thumbColor = undefined,
  thumbHoverColor = undefined,
  thumbWidth = 6,
  autoHide = true,
  hideDelay = 800,
}: CustomScrollProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const { theme } = useTheme()
  const isDark = theme === 'dark'

  const [thumbHeight, setThumbHeight] = useState(0)
  const [thumbTop, setThumbTop] = useState(0)
  const [visible, setVisible] = useState(false)
  const [dragging, setDragging] = useState(false)

  // ── 用 ref 存所有定时器需要判断的状态 ──
  const hoveringRef = useRef(false)
  const draggingRef = useRef(false)
  const scrollingRef = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 根据主题动态计算颜色
  const resolvedThumbColor = thumbColor ?? (isDark ? 'rgb(71 85 105)' : 'rgb(203 213 225)')
  const resolvedThumbHoverColor = thumbHoverColor ?? (isDark ? 'rgb(100 116 139)' : 'rgb(148 163 184)')

  // 拖拽起始信息
  const dragStart = useRef({ startY: 0, startScrollTop: 0 })

  // ── 核心：调度隐藏 ──
  const scheduleHide = useCallback(() => {
    if (!autoHide) return
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      // 定时器触发时读 ref，不是 state
      if (!hoveringRef.current && !draggingRef.current && !scrollingRef.current) {
        setVisible(false)
      }
    }, hideDelay)
  }, [autoHide, hideDelay])

  // ── 计算 thumb 尺寸和位置 ──
  const updateThumb = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollHeight, clientHeight, scrollTop } = el
    if (scrollHeight <= clientHeight) {
      setThumbHeight(0)
      return
    }
    const ratio = clientHeight / scrollHeight
    const tH = Math.max(ratio * clientHeight, 28)
    const maxScroll = scrollHeight - clientHeight
    const maxThumbTop = clientHeight - tH
    setThumbHeight(tH)
    setThumbTop(maxScroll > 0 ? (scrollTop / maxScroll) * maxThumbTop : 0)
  }, [])

  // ── scroll 事件 ──
  const handleScroll = useCallback(() => {
    updateThumb()
    scrollingRef.current = true
    setVisible(true)
    // 滚动结束后标记 scrolling = false
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current)
    scrollEndTimer.current = setTimeout(() => {
      scrollingRef.current = false
      scheduleHide()
    }, 200)
  }, [updateThumb, scheduleHide])

  // ── thumb 拖拽 ──
  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = scrollRef.current
    if (!el) return
    dragStart.current = { startY: e.clientY, startScrollTop: el.scrollTop }
    draggingRef.current = true
    setDragging(true)
  }, [])

  // 全局 mousemove / mouseup（仅拖拽期间监听）
  useEffect(() => {
    if (!dragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const el = scrollRef.current
      const track = trackRef.current
      if (!el || !track) return
      const deltaY = e.clientY - dragStart.current.startY
      const trackH = track.clientHeight
      const tH = Math.max((el.clientHeight / el.scrollHeight) * trackH, 28)
      const maxThumbTop = trackH - tH
      if (maxThumbTop <= 0) return
      const scrollRatio = deltaY / maxThumbTop
      const maxScroll = el.scrollHeight - el.clientHeight
      el.scrollTop = dragStart.current.startScrollTop + scrollRatio * maxScroll
    }

    const handleMouseUp = () => {
      draggingRef.current = false
      setDragging(false)
      scheduleHide()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragging, scheduleHide])

  // 初始化 + ResizeObserver + MutationObserver
  useEffect(() => {
    updateThumb()
    const el = scrollRef.current
    if (!el) return

    // 观察容器自身尺寸变化
    const ro = new ResizeObserver(() => updateThumb())
    ro.observe(el)

    // 观察子元素尺寸变化（需要在子元素替换时重新 observe）
    let childRO: ResizeObserver | null = new ResizeObserver(() => updateThumb())
    const observeChild = () => {
      childRO?.disconnect()
      childRO = new ResizeObserver(() => updateThumb())
      if (el.firstElementChild) {
        childRO.observe(el.firstElementChild)
      }
      updateThumb()
    }
    observeChild()

    // MutationObserver: 子元素被替换时重新 observe
    const mo = new MutationObserver(() => {
      observeChild()
    })
    mo.observe(el, { childList: true, subtree: true })

    return () => {
      ro.disconnect()
      childRO?.disconnect()
      mo.disconnect()
    }
  }, [updateThumb])

  // cleanup
  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current)
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current)
    }
  }, [])

  // ── 容器 hover：mouseenter/leave（不用 mouseover/out 避免子元素冒泡干扰）──
  const handleMouseEnter = useCallback(() => {
    hoveringRef.current = true
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setVisible(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    hoveringRef.current = false
    scheduleHide()
  }, [scheduleHide])

  return (
    <div
      className={`relative overflow-hidden min-h-0 flex flex-col ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 可滚动内容区 —— 隐藏原生滚动条 */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-grow min-h-0 w-full overflow-y-auto linexam-hide-scroll"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {children}
      </div>

      {/* 自定义滚动条 thumb —— 贴右边缘，浮在内容上方 */}
      {thumbHeight > 0 && (
        <div
          ref={trackRef}
          className="absolute top-0 right-0 h-full"
          style={{ width: `${thumbWidth}px` }}
        >
          <div
            onMouseDown={handleThumbMouseDown}
            className="absolute right-0 rounded-full cursor-pointer"
            style={{
              width: `${thumbWidth}px`,
              height: `${thumbHeight}px`,
              top: `${thumbTop}px`,
              backgroundColor: dragging ? resolvedThumbHoverColor : resolvedThumbColor,
              opacity: visible ? 0.85 : 0,
              transition: dragging
                ? 'none'
                : 'opacity 0.2s ease, background-color 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.backgroundColor = resolvedThumbHoverColor
            }}
            onMouseLeave={(e) => {
              if (!draggingRef.current) {
                (e.currentTarget as HTMLDivElement).style.backgroundColor = resolvedThumbColor
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
