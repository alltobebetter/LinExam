// ── 极简外部服务配置 ──
// 本服务只负责：登录验证 + 代码收集 + 交卷 + 题库下发，不参与实时评测（考后统一判卷）。
import fs from 'node:fs'
import path from 'node:path'

// 题库目录解析：环境变量 > 本地真实题库（problems-local，不入库）> 示例题库（problems，随仓库分发）
function resolveProblemsDir(): string {
  if (process.env.PROBLEMS_DIR) return path.resolve(process.env.PROBLEMS_DIR)
  const localDir = path.resolve(__dirname, '../problems-local')
  if (fs.existsSync(localDir)) return localDir
  return path.resolve(__dirname, '../problems')
}

export const config = {
  // 服务端口
  PORT: num('PORT', 3000, n => n >= 0),

  // 数据库路径（resolve 为绝对路径，避免 cwd 变化导致读写错位）
  DB_PATH: path.resolve(process.env.DB_PATH || './data/linexam.db'),

  // 登录令牌有效期（秒，可用环境变量覆盖）
  TOKEN_TTL: num('TOKEN_TTL', 12 * 3600, n => n > 0),

  // 登录限流：同一维度连续失败达上限后锁定一段时间
  LOGIN_MAX_FAILURES: num('LOGIN_MAX_FAILURES', 10, n => n > 0),
  LOGIN_LOCKOUT_SECONDS: num('LOGIN_LOCKOUT_SECONDS', 300, n => n > 0),

  // 题库目录（真实题库在 problems-local，仓库内只提交示例题库）
  PROBLEMS_DIR: resolveProblemsDir(),
}

function num(name: string, def: number, validate: (n: number) => boolean): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  return Number.isFinite(n) && validate(n) ? n : def
}
