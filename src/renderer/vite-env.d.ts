/// <reference types="vite/client" />

interface ProblemListItem {
  id: number
  title: string
  difficulty: '简单' | '中等' | '困难'
  author: string
}

interface ProblemDetail extends ProblemListItem {
  /** Markdown 题面（纯展示，来自 MD 文件） */
  md: string
}

interface SubmitResponse {
  ok?: boolean
  error?: string
}

interface SubmissionRecord {
  problemId: number
  language: string
  code: string
  time: string
}

interface BehaviorSummary {
  focusLossCount: number
  focusLossEvents: { time: number; duration: number }[]
  violations: { time: number; type: string; message: string }[]
  duration: number
  level: 'normal' | 'warning' | 'serious'
}

/** 单题考试进度（持久化到主进程 userData/exam-progress.json） */
interface ProblemProgress {
  viewed?: boolean
  code?: string
}

interface Window {
  exampower?: {
    // 窗口控制
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onWindowMaximizedChange: (cb: (isMax: boolean) => void) => () => void

    // 登录（在线验证 + 题库下发校验，返回绑定的考试语言）
    login: (name: string, studentId: string, serverUrl: string) => Promise<{
      ok: boolean
      token?: string
      studentId?: string
      name?: string
      language?: string
      expiresIn?: number
      error?: string
    }>

    // 题库
    getProblemList: () => Promise<ProblemListItem[]>
    getProblem: (id: number) => Promise<ProblemDetail | null>

    // 代码提交（纯提交，不判题；语言由登录会话绑定）
    submitCode: (problemId: number, code: string) => Promise<SubmitResponse>

    // 提交记录
    getSubmissions: (problemId?: number) => Promise<SubmissionRecord[]>

    // 考试进度（本地持久化，_meta 含 studentId/examId/lastProblemId/startTime/finished）
    saveProgress: (problemId: number, code: string, viewed: boolean) => Promise<{ ok: boolean }>
    setLastProblemId: (problemId: number) => Promise<{ ok: boolean }>
    getExamStartTime: () => Promise<number>
    getProgress: () => Promise<Record<string, ProblemProgress> & { _meta?: { lastProblemId?: number; examId?: string; studentId?: string; startTime?: number; finished?: boolean } }>

    // 考试语言（登录时由后端绑定，不可切换）
    getLanguage: () => Promise<string>

    // 交卷（兜底上报 + 防作弊摘要）
    finishExam: () => Promise<{ ok: boolean } & Partial<BehaviorSummary>>

    // 防作弊（登录时启动监控；交卷时由主进程自动上报）
    startMonitoring: (studentId: string, studentName: string) => Promise<{ ok: boolean }>
  }
}
