import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { config } from './config'

// ── 极简登录令牌 ──
// 令牌存在内存中：服务重启后令牌失效，客户端重新登录即可（提交已落库，不会丢）。

interface Session {
  studentId: string
  name: string
  language: string
  createdAt: number
}

const sessions = new Map<string, Session>()

/** 为学生签发登录令牌 */
export function issueToken(studentId: string, name: string, language: string): string {
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, { studentId, name, language, createdAt: Date.now() })
  return token
}

/** 校验 Bearer 令牌，成功后挂载到 req.user */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供登录令牌' })
  }

  const token = header.slice(7)
  const session = sessions.get(token)

  if (!session) {
    return res.status(401).json({ error: '登录令牌无效或已过期，请重新登录' })
  }

  if (Date.now() - session.createdAt > config.TOKEN_TTL * 1000) {
    sessions.delete(token)
    return res.status(401).json({ error: '登录已过期，请重新登录' })
  }

  ;(req as any).user = session
  next()
}
