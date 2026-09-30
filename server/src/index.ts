import express from 'express'
import cors from 'cors'
import { config } from './config'
import { authMiddleware, issueToken, startSweep } from './auth'
import db from './db'
import { loadProblems, manifestFingerprint } from './problems'

const app = express()

// 会话过期清理（auth 内有 global guard，重复调用安全）
startSweep()

// ── 登录限流（极简内存实现）──
// 限流键为 ip + 学号双维度（小写归一），防止同一出口 IP 下一人失败牵连他人，
// 也防止针对单个学号的暴力枚举。另带 10 分钟滑动窗口：窗口过期自动重置计数。
// 注意：多考点共用出口 IP 时仍需按需放宽阈值。
interface LoginFailure {
  count: number
  lockedUntil: number
  firstFailAt: number
}
const loginFailures = new Map<string, LoginFailure>()
const LOGIN_WINDOW_MS = 10 * 60 * 1000

function loginKey(ip: string, studentId: string): string {
  return `${ip}|${studentId.trim().toLowerCase()}`
}

function isLoginLocked(key: string): boolean {
  const f = loginFailures.get(key)
  if (!f) return false
  const now = Date.now()
  if (now - f.firstFailAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(key) // 滑动窗口过期，重置
    return false
  }
  if (f.lockedUntil > now) return true
  if (f.lockedUntil > 0 && f.lockedUntil <= now) {
    loginFailures.delete(key) // 锁定过期，重置
  }
  return false
}

function recordLoginFailure(key: string): void {
  // 防止长期运行时 Map 无界增长：条目超过 1000 时先清理已过期/窗口外的
  if (loginFailures.size > 1000) {
    const now = Date.now()
    for (const [k, f] of loginFailures) {
      if ((f.lockedUntil > 0 && f.lockedUntil <= now) || now - f.firstFailAt > LOGIN_WINDOW_MS) {
        loginFailures.delete(k)
      }
    }
  }
  const now = Date.now()
  const f = loginFailures.get(key)
  if (!f || now - f.firstFailAt > LOGIN_WINDOW_MS) {
    // 新窗口
    const fresh: LoginFailure = { count: 1, lockedUntil: 0, firstFailAt: now }
    if (fresh.count >= config.LOGIN_MAX_FAILURES) {
      fresh.lockedUntil = now + config.LOGIN_LOCKOUT_SECONDS * 1000
    }
    loginFailures.set(key, fresh)
    return
  }
  f.count += 1
  if (f.count >= config.LOGIN_MAX_FAILURES) {
    f.lockedUntil = now + config.LOGIN_LOCKOUT_SECONDS * 1000
  }
  loginFailures.set(key, f)
}

function clearLoginFailures(key: string): void {
  loginFailures.delete(key)
}

// ── 按 token 的简易限流（submit / behavior 共用，30 次/分钟，超限 429）──
const tokenRate = new Map<string, { count: number; windowStart: number }>()
const TOKEN_RATE_LIMIT = 30
const TOKEN_RATE_WINDOW_MS = 60 * 1000

function hitTokenRate(token: string): boolean {
  const now = Date.now()
  if (tokenRate.size > 5000) {
    for (const [k, v] of tokenRate) {
      if (now - v.windowStart >= TOKEN_RATE_WINDOW_MS) tokenRate.delete(k)
    }
  }
  const e = tokenRate.get(token)
  if (!e || now - e.windowStart >= TOKEN_RATE_WINDOW_MS) {
    tokenRate.set(token, { count: 1, windowStart: now })
    return true
  }
  e.count += 1
  if (e.count > TOKEN_RATE_LIMIT) return false
  return true
}

function checkTokenRate(req: express.Request, res: express.Response): boolean {
  const token = getBearer(req) || (req as any).user?.studentId || 'unknown'
  if (!hitTokenRate(token)) {
    res.status(429).json({ error: '请求过于频繁，请稍后再试' })
    return false
  }
  return true
}

function getBearer(req: express.Request): string {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7) : header
}

// 题目白名单缓存（loadProblems 自带进程缓存，此处再缓存 id Set 避免每次重建）
let validProblemIds: Set<number> | null = null
function getValidProblemIds(): Set<number> {
  if (!validProblemIds) {
    validProblemIds = new Set(loadProblems().map(p => p.id))
  }
  return validProblemIds
}

// 名单资格校验：仍在允许考试名单才接受上报（submit/finish 共用）
function requireAllowed(studentId: string): { ok: boolean; error?: string } {
  const row = db.prepare('SELECT allowed FROM students WHERE id = ?').get(studentId) as
    | { allowed: number }
    | undefined
  if (!row || row.allowed !== 1) {
    return { ok: false, error: '考试资格已被取消' }
  }
  return { ok: true }
}

// ── 中间件 ──
// Electron 客户端走本地加载，不需要浏览器跨域；CORS 仅本地联调时开启，生产默认关闭。
if (process.env.NODE_ENV !== 'production') {
  app.use(cors())
}
app.use(express.json({ limit: '1mb' }))

// ── 健康检查 ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'linexam-server' })
})

// ── 登录 ──
// 校验学生是否在考试名单中（allowed=1），姓名和学号必须匹配。
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown'

  const { name, studentId } = req.body

  if (typeof name !== 'string' || typeof studentId !== 'string' || !name?.trim() || !studentId?.trim()) {
    return res.status(400).json({ error: '请输入姓名和学号' })
  }

  const trimmedId = studentId.trim()
  const trimmedName = name.trim()
  const rateKey = loginKey(ip, trimmedId)

  if (isLoginLocked(rateKey)) {
    return res.status(429).json({ error: '尝试次数过多，请稍后再试' })
  }

  // 在名单中且允许考试
  const student = db.prepare(
    'SELECT id, name, allowed, language FROM students WHERE id = ?'
  ).get(trimmedId) as { id: string; name: string; allowed: number; language: string } | undefined

  // 统一文案防枚举：不在名单 / 被禁考 / 姓名不匹配一律同错；日志只记学号
  if (!student || student.allowed !== 1 || student.name !== trimmedName) {
    recordLoginFailure(rateKey)
    console.error(`[登录失败] 学号 ${trimmedId} 登录失败`)
    return res.status(403).json({ error: '姓名与学号不匹配，请核对后重试' })
  }

  clearLoginFailures(rateKey)

  const language = student.language === 'python' ? 'python' : 'c'
  const token = issueToken(trimmedId, trimmedName, language)

  res.json({
    token,
    studentId: trimmedId,
    name: trimmedName,
    language,
    expiresIn: config.TOKEN_TTL,
  })
})

// ── 以下接口都需要令牌 ──
app.use('/api', authMiddleware)

// ── 题库下发（登录后）──
// 题目随登录态下发，客户端用构建时预置的指纹清单逐题校验（防伪造服务器换题）。
app.get('/api/problems', (_req, res) => {
  try {
    const problems = loadProblems()
    return res.json({
      problems: problems.map(p => ({
        id: p.id,
        title: p.title,
        difficulty: p.difficulty,
        author: p.author,
        md: p.statement,
        hash: p.hash,
      })),
      manifestHash: manifestFingerprint(problems),
    })
  } catch (err) {
    console.error('[题库] 读取失败:', err)
    return res.status(500).json({ error: '题库加载失败，请联系监考老师' })
  }
})

// ── 提交代码 ──
// 纯提交：只存代码，不判题，考后统一判卷。
app.post('/api/submit', (req, res) => {
  if (!checkTokenRate(req, res)) return
  const user = (req as any).user
  const { problemId, title, code } = req.body
  const language: string = user.language === 'python' ? 'python' : 'c'

  if (problemId === undefined || problemId === null || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: '提交数据不完整' })
  }

  // 题目必须在服务端白名单内（loadProblems 自带缓存，不必每次重建 Set）
  const pid = Number(problemId)
  try {
    if (!Number.isInteger(pid) || !getValidProblemIds().has(pid)) {
      return res.status(400).json({ error: '题目不存在' })
    }
  } catch (err) {
    console.error('[提交] 题库加载失败:', err)
    return res.status(500).json({ error: '服务异常，请稍后重试' })
  }

  // 代码长度上限 200KB（防超大 body 灌爆磁盘）
  if (Buffer.byteLength(code, 'utf8') > 200 * 1024) {
    return res.status(400).json({ error: '代码过长（上限 200KB），请精简后提交' })
  }

  // 标题截断 100 字
  const safeTitle = typeof title === 'string' ? title.slice(0, 100) : null

  const allowed = requireAllowed(user.studentId)
  if (!allowed.ok) {
    return res.status(403).json({ error: '考试资格已被取消，无法提交' })
  }

  // BEGIN IMMEDIATE 事务包裹「查交卷 + 写提交」：避免并发下已交卷仍写入
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      // 服务端强制：已交卷的学生不能再提交（客户端锁只是辅助，重启即失效）
      const finished = db.prepare('SELECT 1 FROM finishes WHERE student_id = ?').get(user.studentId)
      if (finished) {
        db.exec('ROLLBACK')
        return res.status(403).json({ error: '已交卷，无法再次提交' })
      }

      db.prepare(`
        INSERT INTO submissions (student_id, problem_id, title, language, code, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `).run(
        user.studentId,
        pid,
        safeTitle ?? null,
        language,
        code,
      )
      db.exec('COMMIT')
    } catch (err) {
      try { db.exec('ROLLBACK') } catch { /* 已回滚或无事务时忽略 */ }
      throw err
    }
  } catch (err) {
    console.error('[提交] 写入失败:', err)
    return res.status(500).json({ error: '服务异常，请稍后重试' })
  }

  res.json({ ok: true })
})

// 交卷兜底上报（幂等，每生一条）。
app.post('/api/finish', (req, res) => {
  const user = (req as any).user
  const allowed = requireAllowed(user.studentId)
  if (!allowed.ok) {
    return res.status(403).json({ error: '考试资格已被取消，无法交卷' })
  }

  db.prepare(`
    INSERT OR IGNORE INTO finishes (student_id) VALUES (?)
  `).run(user.studentId)
  res.json({ ok: true })
})

// ── 上报防作弊行为 ──
// 交卷时随防作弊数据一起上报（最简，每生一条，合并写）。
// 只允许升级不降级：客户端重传旧快照时不得覆盖已记录的更严重等级。
const LEVEL_SEV: Record<string, number> = { normal: 0, warning: 1, serious: 2 }

function normalizeLevel(l: unknown): string {
  return l === 'warning' || l === 'serious' ? l : 'normal'
}

app.post('/api/behavior', (req, res) => {
  if (!checkTokenRate(req, res)) return
  const user = (req as any).user
  const { focusLossCount, violations, duration, level } = req.body

  if (typeof focusLossCount !== 'number' || typeof duration !== 'number') {
    return res.status(400).json({ error: '行为数据不完整' })
  }

  const old = db.prepare(
    'SELECT focus_loss_count, violations, level FROM behaviors WHERE student_id = ?'
  ).get(user.studentId) as
    | { focus_loss_count: number; violations: string; level: string }
    | undefined

  const oldLevel = normalizeLevel(old?.level)
  let mergedLevel = normalizeLevel(level)
  // 严重度只升不降：normal < warning < serious
  if ((LEVEL_SEV[mergedLevel] ?? 0) < (LEVEL_SEV[oldLevel] ?? 0)) {
    mergedLevel = oldLevel
  }

  // focus_loss_count 取 max（防旧快照回退计数）
  const incomingFocus = Number.isFinite(focusLossCount) && focusLossCount > 0 ? Math.floor(focusLossCount) : 0
  const mergedFocus = Math.max(old?.focus_loss_count ?? 0, incomingFocus)

  // violations 合并追加：旧数组 concat 新数组，按 JSON 去重，截断 500 条
  let oldViolations: unknown[] = []
  try {
    const parsed: unknown = JSON.parse(old?.violations ?? '[]')
    if (Array.isArray(parsed)) oldViolations = parsed
  } catch {
    oldViolations = []
  }
  const incomingViolations = Array.isArray(violations) ? violations : []
  const seen = new Set<string>()
  const mergedViolations: unknown[] = []
  // 保新不保旧：新事件在前，截断保留最新 500，避免旧 normal 挤掉新 serious
  for (const v of [...incomingViolations, ...oldViolations]) {
    let k: string
    try { k = JSON.stringify(v) } catch { continue }
    if (seen.has(k)) continue
    seen.add(k)
    mergedViolations.push(v)
    if (mergedViolations.length >= 500) break
  }

  // 服务端按 focusLossCount 重算等级（>10 serious, >3 warning），客户端等级更低则取服务端值
  const serverLevel = mergedFocus > 10 ? 'serious' : mergedFocus > 3 ? 'warning' : 'normal'
  if ((LEVEL_SEV[mergedLevel] ?? 0) < (LEVEL_SEV[serverLevel] ?? 0)) {
    mergedLevel = serverLevel
  }

  db.prepare(`
    INSERT INTO behaviors (student_id, focus_loss_count, violations, duration_seconds, level)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(student_id) DO UPDATE SET
      focus_loss_count = excluded.focus_loss_count,
      violations = excluded.violations,
      duration_seconds = excluded.duration_seconds,
      level = excluded.level,
      reported_at = strftime('%s','now')
  `).run(
    user.studentId,
    mergedFocus,
    JSON.stringify(mergedViolations),
    Math.round(duration / 1000),
    mergedLevel,
  )

  res.json({ ok: true })
})

// ── 全局错误兜底（不把技术细节透给学生） ──
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[服务端] 未捕获错误:', err)
  res.status(500).json({ error: '服务异常，请稍后重试' })
})

// ── 启动 ──
app.listen(config.PORT, () => {
  console.log(`LinExam 外部服务已启动: http://0.0.0.0:${config.PORT}`)
})
