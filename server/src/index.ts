import express from 'express'
import cors from 'cors'
import { config } from './config'
import { authMiddleware, issueToken } from './auth'
import db from './db'
import { loadProblems, manifestFingerprint } from './problems'

const app = express()

// ── 登录限流（极简内存实现）──
// 每个来源 IP 连续失败超过阈值后锁定一段时间，防止局域网内暴力枚举姓名+学号。
// 注意：多考点共用出口 IP 时需放宽阈值或改用学号维度限流。
interface LoginFailure {
  count: number
  lockedUntil: number
}
const loginFailures = new Map<string, LoginFailure>()

function isLoginLocked(ip: string): boolean {
  const f = loginFailures.get(ip)
  if (!f) return false
  if (f.lockedUntil > Date.now()) return true
  if (f.lockedUntil > 0 && f.lockedUntil <= Date.now()) {
    loginFailures.delete(ip) // 锁定过期，重置
  }
  return false
}

function recordLoginFailure(ip: string): void {
  // 防止长期运行时 Map 无界增长：条目超过 1000 时先清理已过期的
  if (loginFailures.size > 1000) {
    const now = Date.now()
    for (const [k, f] of loginFailures) {
      if (f.lockedUntil > 0 && f.lockedUntil <= now) loginFailures.delete(k)
    }
  }
  const f = loginFailures.get(ip) || { count: 0, lockedUntil: 0 }
  f.count += 1
  if (f.count >= config.LOGIN_MAX_FAILURES) {
    f.lockedUntil = Date.now() + config.LOGIN_LOCKOUT_SECONDS * 1000
  }
  loginFailures.set(ip, f)
}

function clearLoginFailures(ip: string): void {
  loginFailures.delete(ip)
}

// ── 中间件 ──
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// ── 健康检查 ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'linexam-server' })
})

// ── 登录 ──
// 校验学生是否在考试名单中（allowed=1），姓名和学号必须匹配。
app.post('/api/login', (req, res) => {
  const ip = req.ip || 'unknown'

  if (isLoginLocked(ip)) {
    return res.status(429).json({ error: '尝试次数过多，请稍后再试' })
  }

  const { name, studentId } = req.body

  if (!name?.trim() || !studentId?.trim()) {
    return res.status(400).json({ error: '请输入姓名和学号' })
  }

  const trimmedId = studentId.trim()
  const trimmedName = name.trim()

  // 在名单中且允许考试
  const student = db.prepare(
    'SELECT id, name, allowed, language FROM students WHERE id = ?'
  ).get(trimmedId) as { id: string; name: string; allowed: number; language: string } | undefined

  if (!student || student.allowed !== 1) {
    recordLoginFailure(ip)
    console.error(`[登录失败] 学号 ${trimmedId} 不在考试名单或未获授权`)
    return res.status(403).json({ error: '你不在本次考试名单中，请联系监考老师' })
  }

  if (student.name !== trimmedName) {
    recordLoginFailure(ip)
    console.error(`[登录失败] 学号 ${trimmedId} 姓名不匹配（期望 ${student.name}，收到 ${trimmedName}）`)
    return res.status(403).json({ error: '姓名与学号不匹配，请核对后重试' })
  }

  clearLoginFailures(ip)

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
  const user = (req as any).user
  const { problemId, title, code } = req.body
  const language: string = user.language === 'python' ? 'python' : 'c'

  if (!problemId || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: '提交数据不完整' })
  }

  // 服务端强制：已交卷的学生不能再提交（客户端锁只是辅助，重启即失效）
  const finished = db.prepare('SELECT 1 FROM finishes WHERE student_id = ?').get(user.studentId)
  if (finished) {
    return res.status(403).json({ error: '已交卷，无法再次提交' })
  }

  // 名单有效性：学生仍允许考试才接受上报
  const student = db.prepare('SELECT allowed FROM students WHERE id = ?').get(user.studentId) as
    | { allowed: number }
    | undefined
  if (!student || student.allowed !== 1) {
    return res.status(403).json({ error: '考试资格已被取消，无法提交' })
  }

  db.prepare(`
    INSERT INTO submissions (student_id, problem_id, title, language, code, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).run(
    user.studentId,
    problemId,
    title ?? null,
    language,
    code,
  )

  res.json({ ok: true })
})

// ── 交卷 ──
// 交卷兜底上报（幂等，每生一条）。
app.post('/api/finish', (req, res) => {
  const user = (req as any).user
  // 与 /api/submit 对齐：被取消资格的学生不能交卷
  const student = db.prepare('SELECT allowed FROM students WHERE id = ?').get(user.studentId) as
    | { allowed: number }
    | undefined
  if (!student || student.allowed !== 1) {
    return res.status(403).json({ error: '考试资格已被取消，无法交卷' })
  }

  db.prepare(`
    INSERT OR IGNORE INTO finishes (student_id) VALUES (?)
  `).run(user.studentId)
  res.json({ ok: true })
})

// ── 上报防作弊行为 ──
// 交卷时随防作弊数据一起上报（最简，每生一条，覆盖写）。
app.post('/api/behavior', (req, res) => {
  const user = (req as any).user
  const { focusLossCount, violations, duration, level } = req.body

  if (typeof focusLossCount !== 'number' || typeof duration !== 'number') {
    return res.status(400).json({ error: '行为数据不完整' })
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
    focusLossCount,
    JSON.stringify(violations || []),
    Math.round(duration / 1000),
    typeof level === 'string' ? level : 'normal',
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
