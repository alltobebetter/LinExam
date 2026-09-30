import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import Editor, { loader } from '@monaco-editor/react'
import type { BeforeMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import CustomScroll from '../components/CustomScroll'
import Modal from '../components/Modal'
import TitleBar from '../components/TitleBar'
import { useTheme } from '../components/ThemeProvider'
import { useToast } from '../components/Toast'

// 配置 Monaco 从本地加载，不走 CDN
loader.config({ monaco })

function formatElapsed(totalSeconds: number): string {
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0')
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

const languageLabels: Record<string, string> = { c: 'C', python: 'Python' }

const statusStyles = {
  done: { dot: 'bg-emerald-400', label: '已提交', text: 'text-emerald-600 dark:text-emerald-400' },
  doing: { dot: 'bg-blue-400', label: '进行中', text: 'text-blue-600 dark:text-blue-400' },
  todo: { dot: 'bg-slate-300 dark:bg-slate-600', label: '未开始', text: 'text-slate-400 dark:text-slate-500' },
}

const difficultyStyles = {
  简单: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50',
  中等: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50',
  困难: 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50',
}


export default function Exam() {
  const navigate = useNavigate()
  const SUBMIT_FAILED = '提交失败，请重试'
  // 考试语言由登录时后端绑定，不可切换
  const [language, setLanguage] = useState('c')
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [bottomTab, setBottomTab] = useState<'problems' | 'submissions'>('problems')
  const [showGuidelines, setShowGuidelines] = useState(false)
  const [collapsedTop, setCollapsedTop] = useState(false)
  const [collapsedBottom, setCollapsedBottom] = useState(false)
  const [collapsedRight, setCollapsedRight] = useState(false)
  const [problemList, setProblemList] = useState<(ProblemListItem & { status: 'todo' | 'doing' | 'done' })[]>([])
  const [problem, setProblem] = useState<ProblemDetail | null>(null)
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([])
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)
  const loadSeqRef = useRef(0)
  const codeRef = useRef('')
  const problemRef = useRef<ProblemDetail | null>(null)
  const monacoLang = language === 'c' ? 'cpp' : language
  const { theme } = useTheme()
  const toast = useToast()

  const busy = submitting || finishing
  function guardBusy(): boolean {
    if (busy) {
      toast.show('提交中请稍候', 'warning')
      return true
    }
    return false
  }
  function handleAuthExpired(message = '登录已过期，请重新登录'): void {
    toast.show(message, 'error')
    navigate('/')
  }

  // 已用时间计时器（不限制时长，仅统计参考）
  // 开始时间持久化到主进程，刷新不丢；用时间戳计算更准
  useEffect(() => {
    let startTime = 0
    let timer: ReturnType<typeof setInterval> | undefined
    window.exampower?.getExamStartTime().then(t => {
      startTime = t
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
      timer = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTime) / 1000))
      }, 1000)
    }).catch(() => {
      toast.show('获取考试开始时间失败', 'warning')
    })
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [])

  // 加载题目列表
  useEffect(() => {
    window.exampower?.getLanguage().then(l => {
      if (l === 'python' || l === 'c') setLanguage(l)
    }).catch(() => {
      toast.show('获取考试语言失败', 'warning')
    })
    window.exampower?.getProblemList().then(async list => {
      if (list && list.length > 0) {
        // 从提交记录推导已提交（done），从进度推导看过（doing）
        const subs = (await window.exampower?.getSubmissions()) || []
        const submittedIds = new Set(subs.map(s => Number(s.problemId)))
        const progress = (await window.exampower?.getProgress()) || {}
        const viewedIds = new Set(Object.keys(progress).filter(id => progress[String(id)]?.viewed).map(Number))
        const mapped = list.map(p => ({
          ...p,
          status: submittedIds.has(Number(p.id)) ? 'done' as const : viewedIds.has(Number(p.id)) ? 'doing' as const : 'todo' as const,
        }))
        setProblemList(mapped)
        // 恢复上次答题位置：_meta.lastProblemId 必须在本次题表内，否则回退第一题（防后端换题记脏）
        const lastId = Number(progress._meta?.lastProblemId)
        const initial = mapped.some(p => p.id === lastId) ? lastId : mapped[0].id
        if (mapped.length > 0) {
          loadProblem(initial)
        }
      } else {
        toast.show('题目列表为空', 'warning')
      }
    }).catch(() => {
      toast.show('加载题目列表失败', 'error')
    })
    setShowGuidelines(true)
  }, [])

  // 加载题目详情
  const loadProblem = async (id: number) => {
    const seq = ++loadSeqRef.current
    // 自动保存：先保存上一题的代码（用 ref 快照，避免闭包过期），再切题
    const prevProblem = problemRef.current
    const prevCode = codeRef.current
    if (prevProblem && prevCode) {
      try {
        await window.exampower?.saveProgress(prevProblem.id, prevCode, true)
      } catch { /* 忽略自动保存失败 */ }
      if (seq !== loadSeqRef.current) return
    }
    let p: ProblemDetail | null | undefined
    try {
      p = await window.exampower?.getProblem(id)
    } catch {
      toast.show('加载题目失败', 'error')
      return
    }
    if (seq !== loadSeqRef.current) return
    if (p) {
      // 看过这道题 = 进行中（已提交的题保持 done，不被覆盖）
      setProblemList(prev => prev.map(item =>
        item.id === id && item.status === 'todo' ? { ...item, status: 'doing' as const } : item
      ))
      // 恢复该题已保存的代码
      const progress = (await window.exampower?.getProgress()) || {}
      if (seq !== loadSeqRef.current) return
      const restored = progress[String(id)]
      const restoredCode = restored?.code || ''
      setCode(restoredCode)
      codeRef.current = restoredCode
      setProblem(p)
      problemRef.current = p
      setBottomTab('problems')
      // 记录上次位置（白名单校验在主进程内做，失败忽略）
      window.exampower?.setLastProblemId(id)?.catch(() => {})
      // 标记看过（进行中）
      try {
        await window.exampower?.saveProgress(id, restoredCode, true)
      } catch { /* 忽略标记失败 */ }
      if (seq !== loadSeqRef.current) return
      // 加载该题提交记录
      const subs = await window.exampower?.getSubmissions(id)
      if (seq !== loadSeqRef.current) return
      if (subs) setSubmissions(subs)
    }
  }
  // 自动保存：代码变化后防抖 1s 保存到主进程（持久化）
  useEffect(() => {
    if (!problem) return
    const timer = setTimeout(() => {
      window.exampower?.saveProgress(problem.id, code, true)
    }, 1000)
    return () => clearTimeout(timer)
  }, [code, problem])

  const handleBeforeMount: BeforeMount = (monacoInstance) => {
    // 自定义亮色主题：背景与白色卡片一致
    monacoInstance.editor.defineTheme('linexam-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
      },
    })
    // 自定义暗色主题：背景与 slate-900 卡片一致 (#0f172a)
    monacoInstance.editor.defineTheme('linexam-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#0f172a',
      },
    })
  }

  async function handleSubmit() {
    if (!problem) return
    const pid = problem.id
    const snapshotCode = codeRef.current
    if (!snapshotCode.trim()) {
      toast.show('请先编写代码', 'warning')
      return
    }
    if (guardBusy()) return
    setSubmitting(true)
    try {
      const response = await window.exampower?.submitCode(pid, snapshotCode)
      if (pid !== problemRef.current?.id) return
      if (!response) {
        toast.show(SUBMIT_FAILED, 'error')
      } else if ((response as { code?: number }).code === 401) {
        handleAuthExpired()
      } else if (response.error) {
        toast.show(response.error, 'error')
      } else {
        toast.show('提交成功，代码已上传', 'success')
        // 更新提交记录（仅当前题未切换时更新）
        const subs = await window.exampower?.getSubmissions(pid)
        if (pid !== problemRef.current?.id) return
        if (subs) setSubmissions(subs)
        // 有提交即标记为已提交
        setProblemList(prev => prev.map(p => p.id === pid ? { ...p, status: 'done' as const } : p))
      }
    } catch {
      toast.show(SUBMIT_FAILED, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  // 交卷（兜底上报 + 防作弊上报，交卷后锁定不可再作答）
  const handleFinish = async () => {
    if (guardBusy()) return
    setShowFinishConfirm(false)
    setFinishing(true)
    try {
      const result = await window.exampower?.finishExam()
      if (result?.ok) {
        toast.show('交卷成功', 'success')
        // 交卷后锁定：回到登录页
        setTimeout(() => navigate('/'), 800)
      } else if ((result as { code?: number })?.code === 401) {
        handleAuthExpired()
      } else {
        toast.show('交卷失败，请重试', 'error')
      }
    } catch {
      toast.show('交卷失败，请重试', 'error')
    } finally {
      setFinishing(false)
    }
  }

  // ── 左侧面板互斥折叠：至少保持一个展开 ──
  const toggleTop = () => {
    if (!collapsedTop) {
      // 折叠上面 → 如果下面已折叠，先展开下面
      setCollapsedBottom(false)
      setCollapsedTop(true)
    } else {
      setCollapsedTop(false)
    }
  }

  const toggleBottom = () => {
    if (!collapsedBottom) {
      // 折叠下面 → 如果上面已折叠，先展开上面
      setCollapsedTop(false)
      setCollapsedBottom(true)
    } else {
      setCollapsedBottom(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950">
      {/* ── 自定义标题栏 ── */}
      <TitleBar />

      {/* ── 顶栏 ── */}
      <header className="h-[56px] shrink-0 flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          {/* 帮助按钮 */}
          <button
            onClick={() => setShowGuidelines(true)}
            className="w-[28px] h-[28px] flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
            title="考试须知"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          </button>
          {!problem ? (
            <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">加载中…</span>
          ) : (
            <span className="text-[15px] font-bold text-slate-800 dark:text-slate-100">{problem.title}</span>
          )}
          {problem && (
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${difficultyStyles[problem.difficulty as '简单'|'中等'|'困难'] ?? ''}`}>
              {problem.difficulty}
            </span>
          )}
          {problem && (
            <div className="flex items-center gap-1 ml-1">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="text-[12px] text-slate-400 dark:text-slate-500">{problem.author}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="text-[14px] font-medium text-slate-600 dark:text-slate-300 tabular-nums">
              {formatElapsed(elapsed)}
            </span>
          </div>
          {/* 次要：切题导航（quiet tertiary，不与提交竞争） */}
          <button
            onClick={() => {
              if (guardBusy()) return
              const currentIdx = problemList.findIndex(p => p.id === problem?.id)
              if (currentIdx < problemList.length - 1) {
                loadProblem(problemList[currentIdx + 1].id)
                toast.show('已切换到下一题', 'info')
              } else {
                toast.show('已经是最后一题了', 'warning')
              }
            }}
            disabled={submitting || finishing}
            className="h-[32px] flex items-center gap-1.5 px-3 text-[12px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-800 rounded-lg transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            下一题
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="M12 5l7 7-7 7" />
            </svg>
          </button>
          {/* 主要：提交代码（全屏唯一的 primary 动作） */}
          <button
            onClick={handleSubmit}
            disabled={submitting || finishing}
            className="h-[32px] flex items-center gap-1.5 px-4 text-[12px] font-semibold text-white bg-slate-800 hover:bg-slate-700 active:bg-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 dark:active:bg-slate-300 rounded-lg transition-colors active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-slate-800 disabled:active:scale-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
          >
            {submitting ? (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
            {submitting ? '提交中' : '提交代码'}
          </button>
          {/* 分隔：危险动作与安全动作隔离 */}
          <div className="w-px h-[20px] bg-slate-200 dark:bg-slate-700" aria-hidden />
          {/* 危险：交卷（outline danger，不抢 primary 风头，误触成本由确认弹窗兜底） */}
          <button
            onClick={() => setShowFinishConfirm(true)}
            disabled={finishing || submitting}
            className="h-[32px] flex items-center gap-1.5 px-3.5 text-[12px] font-medium text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 hover:bg-red-600 hover:border-red-600 hover:text-white dark:hover:bg-red-600 dark:hover:border-red-600 dark:hover:text-white rounded-lg transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-red-600 disabled:hover:border-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            title="交卷后不可再作答"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" y1="22" x2="4" y2="15" />
            </svg>
            交卷
          </button>
        </div>
      </header>

      {/* ── 三卡片布局（CSS Grid 平滑过渡） ── */}
      <div
        className="flex-1 px-3 pb-3 overflow-hidden grid"
        style={{
          gridTemplateColumns: collapsedRight ? '1fr 0fr' : '42fr 58fr',
          gap: '12px',
          transition: 'grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          minHeight: 0,
        }}
      >
        {/* 左栏：上下两块卡片（CSS Grid 行高度过渡） */}
        <div
          className="grid overflow-hidden"
          style={{
            gridTemplateRows: collapsedTop ? '0fr 1fr' : collapsedBottom ? '1fr 0fr' : '1.62fr 1fr',
            gap: '12px',
            transition: 'grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            minHeight: 0,
            minWidth: 0,
          }}
        >
          {/* ── 左上：题目描述卡片（始终渲染） ── */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden relative flex flex-col" style={{ minHeight: 38 }}>
            {/* 标题栏（始终渲染，折叠时不显示分割线） */}
            <div
              className={`h-[38px] shrink-0 flex items-center justify-between px-4 relative ${collapsedTop ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : ''} ${collapsedTop ? '' : 'border-b border-slate-50 dark:border-slate-800'}`}
              onClick={collapsedTop ? toggleTop : undefined}
            >
              {/* 展开状态标签 */}
              <div className="flex items-center gap-2" style={{ opacity: collapsedTop ? 0 : 1, transition: 'opacity 0.2s ease' }}>
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300">题目描述</span>
              </div>
              {/* 折叠状态标签（覆盖在展开标签上方） */}
              <div className="absolute left-4 flex items-center gap-2 min-w-0" style={{ opacity: collapsedTop ? 1 : 0, pointerEvents: 'none', transition: 'opacity 0.2s ease' }}>
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300 shrink-0">题目描述</span>
                <span className="text-[12px] text-slate-400 dark:text-slate-500 truncate">{problem?.title}</span>
              </div>
              {/* 折叠/展开按钮 */}
              <button
                onClick={collapsedTop ? undefined : toggleTop}
                className="w-6 h-6 flex items-center justify-center rounded-md text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={collapsedTop ? '展开' : '折叠'}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {collapsedTop ? (
                    <polyline points="6 9 12 15 18 9" />
                  ) : (
                    <polyline points="18 15 12 9 6 15" />
                  )}
                </svg>
              </button>
            </div>
            {/* 内容区 - 始终渲染，折叠时淡出 */}
            <div className="flex-1 min-h-0" style={{ opacity: collapsedTop ? 0 : 1, transition: 'opacity 0.2s ease' }}>
              <CustomScroll key={problem?.id ?? 'empty'} className="h-full">
                <div className="px-6 py-5">
{problem ? (
  <ReactMarkdown
    remarkPlugins={[remarkGfm, remarkMath]}
    rehypePlugins={[rehypeKatex]}
    components={{
      h1: ({ children }) => <h1 className="text-[20px] font-bold text-slate-800 dark:text-slate-100 mb-3">{children}</h1>,
      h2: ({ children }) => <h2 className="text-[16px] font-bold text-slate-800 dark:text-slate-100 mt-5 mb-2">{children}</h2>,
      p: ({ children }) => <p className="text-[14px] text-slate-600 dark:text-slate-300 leading-relaxed mt-2 first:mt-0">{children}</p>,
      ul: ({ children }) => <ul className="text-[14px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-1 mt-2">{children}</ul>,
      li: ({ children }) => <li className="flex gap-2"><span className="text-slate-300 dark:text-slate-600 shrink-0">•</span><span>{children}</span></li>,
      ol: ({ children }) => <ol className="text-[14px] text-slate-600 dark:text-slate-300 leading-relaxed space-y-1 mt-2 list-decimal pl-5">{children}</ol>,
      strong: ({ children }) => <strong className="font-semibold text-slate-800 dark:text-slate-100">{children}</strong>,
      code: ({ className, children }) => {
        // 围栏代码块（pre > code.language-*）：不加内边距/背景，样式交给外层 pre，
        // 否则行内样式叠进块级代码会造成首行缩进和内嵌背景块
        if (className?.includes('language-')) {
          return <code className={className}>{children}</code>
        }
        // 行内代码：保留标签样式
        return <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-mono text-[12.5px]">{children}</code>
      },
      pre: ({ children }) => <pre className="mt-3 mb-3 bg-slate-50 dark:bg-slate-800 rounded-lg p-3 overflow-x-auto text-[12.5px] leading-relaxed font-mono text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{children}</pre>,
    }}
  >
    {problem.md}
  </ReactMarkdown>
) : (
  <div className="flex items-center justify-center h-full text-[13px] text-slate-400 dark:text-slate-500">加载题目中…</div>
)}
                </div>
              </CustomScroll>
            </div>
          </div>

          {/* ── 左下：多 tab 卡片（始终渲染） ── */}
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden relative flex flex-col" style={{ minHeight: 38 }}>
            {/* 标签栏（始终渲染，折叠时标签淡出） */}
            <div
              className={`h-[38px] shrink-0 flex items-center px-3 relative ${collapsedBottom ? 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800' : ''} ${collapsedBottom ? '' : 'border-b border-slate-50 dark:border-slate-800'}`}
              onClick={collapsedBottom ? toggleBottom : undefined}
            >
              {/* Tab 按钮 */}
              <div className="flex items-center gap-0.5" style={{ opacity: collapsedBottom ? 0 : 1, pointerEvents: collapsedBottom ? 'none' : 'auto', transition: 'opacity 0.2s ease' }}>
                {([
                  ['problems', '题目列表'],
                  ['submissions', '提交记录'],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setBottomTab(key)}
                    className={`px-2.5 py-1.5 text-[12px] font-medium rounded-md transition-colors ${
                      bottomTab === key ? 'text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* 折叠状态标签（覆盖在 Tab 上方） */}
              <div className="absolute left-3 flex items-center gap-2" style={{ opacity: collapsedBottom ? 1 : 0, pointerEvents: 'none', transition: 'opacity 0.2s ease' }}>
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 21V9" />
                </svg>
                <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300">{bottomTab === 'problems' ? '题目列表' : '提交记录'}</span>
              </div>
              {/* 折叠/展开按钮 */}
              <button
                onClick={collapsedBottom ? undefined : toggleBottom}
                className="ml-auto w-6 h-6 flex items-center justify-center rounded-md text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title={collapsedBottom ? '展开' : '折叠'}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  {collapsedBottom ? (
                    <polyline points="18 15 12 9 6 15" />
                  ) : (
                    <polyline points="6 9 12 15 18 9" />
                  )}
                </svg>
              </button>
            </div>
            {/* 内容区 */}
            <div className="flex-1 min-h-0" style={{ opacity: collapsedBottom ? 0 : 1, transition: 'opacity 0.2s ease' }}>
              <CustomScroll className="h-full">
                {/* 题目列表 */}
                {bottomTab === 'problems' && (
                  <div className="px-4 py-3 space-y-1">
                    {problemList.map((p, i) => {
                      const s = statusStyles[p.status]
                      return (
                        <div
                          key={p.id}
                          onClick={() => {
                            if (guardBusy()) return
                            loadProblem(p.id)
                          }}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                            p.id === problem?.id ? 'bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <span className="text-[12px] font-medium text-slate-400 dark:text-slate-500 tabular-nums w-5">{i + 1}</span>
                          <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${s.dot}`} />
                          <span className="text-[12px] font-medium text-slate-700 dark:text-slate-200 flex-1 truncate">{p.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${difficultyStyles[p.difficulty] ?? ''}`}>{p.difficulty}</span>
                          <span className={`text-[10px] ${s.text} w-10 text-right`}>{s.label}</span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 提交记录 */}
                {bottomTab === 'submissions' && (
                  <div className="px-4 py-3 space-y-1.5">
                    {submissions.length === 0 ? (
                    <div className="flex items-center justify-center h-full px-4">
                      <p className="text-[13px] text-slate-400 dark:text-slate-500">暂无提交记录</p>
                    </div>
                  ) : (
                    submissions.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800"
                      >
                        <span className="shrink-0 w-4 h-4 flex items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400">
                          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        </span>
                        <span className="text-[12px] font-medium text-slate-600 dark:text-slate-300 tabular-nums">{new Date(s.time).toLocaleTimeString()}</span>
                        <span className="ml-auto text-[11px] text-slate-400 dark:text-slate-500">{languageLabels[s.language] ?? s.language}</span>
                      </div>
                    ))
                  )}
                  </div>
                )}
              </CustomScroll>
            </div>
          </div>
        </div>

        {/* ── 右栏：代码编辑器卡片（始终渲染） ── */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm overflow-hidden relative flex flex-col" style={{ minWidth: 38 }}>
          {/* 完整编辑器 - 始终渲染，折叠时淡出 */}
          <div className="h-full flex flex-col" style={{ opacity: collapsedRight ? 0 : 1, transition: 'opacity 0.2s ease' }}>
            {/* 编辑器顶栏 */}
            <div className="h-[44px] shrink-0 flex items-center justify-between px-4 border-b border-slate-50 dark:border-slate-800">
              <span className="px-2.5 py-1 text-[12px] font-medium text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 rounded-md">
                {languageLabels[language] ?? language}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] leading-none text-slate-300 dark:text-slate-600">UTF-8</span>
                <button
                  onClick={() => setCollapsedRight(true)}
                  className="w-6 h-6 flex items-center justify-center rounded-md text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="折叠"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            </div>
            {/* Monaco */}
            <div className="flex-1">
              <Editor
                language={monacoLang}
                value={code}
                onChange={(v) => { const nv = v || ''; setCode(nv); codeRef.current = nv }}
                beforeMount={handleBeforeMount}
                theme={theme === 'dark' ? 'linexam-dark' : 'linexam-light'}
                loading={<div className="flex items-center justify-center h-full text-[13px] text-slate-400 dark:text-slate-500">加载编辑器…</div>}
                options={{
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  cursorBlinking: 'smooth',
                  cursorSmoothCaretAnimation: 'on',
                  tabSize: 4,
                  automaticLayout: true,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </div>
          </div>
          {/* 折叠状态覆盖层 - 折叠时淡入 */}
          <button
            onClick={() => setCollapsedRight(false)}
            className="absolute inset-0 z-10 flex flex-col items-center justify-between py-4 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            style={{ opacity: collapsedRight ? 1 : 0, pointerEvents: collapsedRight ? 'auto' : 'none', transition: 'opacity 0.2s ease' }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400" style={{ writingMode: 'vertical-rl', letterSpacing: '0.1em' }}>代码编辑器</span>
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── 考试须知弹窗 ── */}
      <Modal
        open={showGuidelines}
        onClose={() => setShowGuidelines(false)}
        title="考试须知"
      >
        <div className="space-y-5 text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
          {/* 考试纪律 */}
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
              考试纪律
            </h3>
            <ul className="ml-4 space-y-1.5">
<li>· 右上角计时器显示<strong className="text-slate-700 dark:text-slate-200">已用时间</strong>，仅作统计参考，不限制答题时长；</li>
<li>· 考试期间系统将记录<strong className="text-slate-700 dark:text-slate-200">切屏次数</strong>，频繁切屏可能被标记为异常行为；</li>
              <li>· 禁止使用搜索引擎、AI 助手、通讯工具等外部辅助；</li>
              <li>· 禁止抄袭他人代码或向他人传递答案。</li>
            </ul>
          </section>

          {/* 界面说明 */}
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              界面说明
            </h3>
            <div className="ml-4 space-y-2">
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">左侧上方</span>
                <span>题目描述区，包含题面、示例和约束条件，支持滚动浏览</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">左侧下方</span>
                <span>两个标签页：题目列表、提交记录</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">右侧</span>
                <span>代码编辑器，考试语言由监考分配，自动保存</span>
              </div>
            </div>
          </section>

          {/* 按钮功能 */}
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              按钮功能
            </h3>
            <div className="ml-4 space-y-2">
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900">
                  <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                  提交
                </span>
                <span>提交当前代码到服务端，考后统一判卷，提交记录可在「提交记录」标签页查看</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">考试语言</span>
                <span>由监考老师按学号分配（C / Python），登录后自动确定，不可切换</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">❓ 帮助</span>
                <span>随时点击顶栏问号图标重新查看本须知</span>
              </div>
            </div>
          </section>

          {/* 答题流程 */}
          <section>
            <h3 className="text-[14px] font-bold text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              答题流程
            </h3>
            <ol className="ml-4 space-y-1.5 list-decimal">
              <li>在左侧题目描述区阅读题目要求和示例</li>
              <li>在右侧编辑器中编写代码（语言已按学号分配好）</li>
              <li>点击「提交」按钮上传代码，可在「提交记录」中查看历次提交</li>
              <li>考后统一判卷，考试期间不显示分数</li>
            </ol>
          </section>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <p className="text-[12px] text-slate-400 dark:text-slate-500">如有疑问，请举手联系监考老师。祝您考试顺利！</p>
          </div>
        </div>
      </Modal>

      {/* ── 交卷确认弹窗 ── */}
      <Modal
        open={showFinishConfirm}
        onClose={() => setShowFinishConfirm(false)}
        title="确认交卷"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/50">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </div>
            <div className="text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed">
              <p>交卷后将<span className="font-semibold text-slate-800 dark:text-slate-100">锁定试卷</span>，无法再提交任何代码。</p>
              <p className="mt-1">当前已提交 <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {problemList.filter(p => p.status === 'done').length}
              </span> 道题。确定现在交卷吗？</p>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2.5 pt-1">
            <button
              onClick={() => setShowFinishConfirm(false)}
              className="h-[36px] px-4 text-[13px] font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleFinish}
              disabled={finishing}
              className="h-[36px] px-4 text-[13px] font-medium text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {finishing ? '交卷中…' : '确认交卷'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
