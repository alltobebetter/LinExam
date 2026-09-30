import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { config } from './config'
import db from './db'

// ── 登录令牌（DB 持久化）──
// 会话存 sessions 表：服务重启后令牌仍有效，过期由定时 sweep 清理。

interface Session {
  studentId: string
  name: string
  language: string
  createdAt: number
}

/** 为学生签发登录令牌（写入 DB，含 expires_at = now + TOKEN_TTL） */
export function issueToken(studentId: string, name: string, language: string): string {
  const token = crypto.randomBytes(24).toString('hex')
  const nowSec = Math.floor(Date.now() / 1000)
  db.prepare(
    'INSERT INTO sessions (token, student_id, name, language, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(token, studentId, name, language, nowSec, nowSec + config.TOKEN_TTL)
  return token
}

/** 校验 Bearer 令牌，成功后挂载到 req.user */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供登录令牌' })
  }

  const token = header.slice(7)
  const row = db.prepare(
    'SELECT student_id AS studentId, name, language, created_at AS createdAt, expires_at AS expiresAt FROM sessions WHERE token = ?'
  ).get(token) as
    | { studentId: string; name: string; language: string; createdAt: number; expiresAt: number }
    | undefined

  if (!row) {
    return res.status(401).json({ error: '登录令牌无效或已过期，请重新登录' })
  }

  if (row.expiresAt <= Math.floor(Date.now() / 1000)) {
    try {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    } catch {
      // 删除失败不影响返回 401
    }
    return res.status(401).json({ error: '登录已过期，请重新登录' })
  }

  const session: Session = {
    studentId: row.studentId,
    name: row.name,
    language: row.language,
    createdAt: row.createdAt * 1000,
  }
  ;(req as any).user = session
  next()
}

/** 每小时清理过期会话（幂等，global guard 防重复启动；仅由 index.ts 调用） */
export function startSweep(): void {
  const g = globalThis as unknown as { __linexam_session_sweep?: unknown }
  if (g.__linexam_session_sweep) return
  const timer = setInterval(() => {
    try {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000))
    } catch (err) {
      console.error('[会话] 清理过期令牌失败:', err)
    }
  }, 3600 * 1000)
  const t = timer as unknown as { unref?: () => void }
  if (typeof t.unref === 'function') t.unref()
  g.__linexam_session_sweep = timer
}
