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
  PORT: Number(process.env.PORT || 3000),

  // 数据库路径
  DB_PATH: process.env.DB_PATH || './data/linexam.db',

  // 登录令牌有效期（秒）
  TOKEN_TTL: 12 * 60 * 60,

  // 登录限流：同一 IP 连续失败达上限后锁定一段时间
  LOGIN_MAX_FAILURES: Number(process.env.LOGIN_MAX_FAILURES || 10),
  LOGIN_LOCKOUT_SECONDS: Number(process.env.LOGIN_LOCKOUT_SECONDS || 300),

  // 题库目录（真实题库在 problems-local，仓库内只提交示例题库）
  PROBLEMS_DIR: resolveProblemsDir(),
}
