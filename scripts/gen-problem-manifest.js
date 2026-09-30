/**
 * 生成客户端题库指纹清单（src/main/problems/manifest.json）。
 *
 * 从服务端题库源（server/problems/）计算每道题的指纹，
 * 客户端打包时只带这份清单（不含题面），运行时用它校验
 * 服务端下发的题目，防止考生把客户端指向伪造服务器换题。
 *
 * 指纹算法必须与 server/src/problems.ts 保持一致：
 *   sha256( `${id}|${title}|${difficulty}|${author}|${statement 归一化为 \n}` )
 * 归一化 = 去 BOM 头 + \r\n->\n + \r->\n（字段不 trim，避免全场哈希漂移）
 *
 * 用法：node scripts/gen-problem-manifest.js [--src <dir>]
 *   --src 优先（process.argv[2] 优先，支持 `--src <dir>` 或直接给目录）；
 *   否则本地真实题库（problems-local，不入库）优先，再用仓库内示例题库。
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')

const root = path.resolve(__dirname, '..')

// --src 参数（process.argv[2] 优先）：支持 `--src <dir>` 或直接传目录
function parseSrcArg() {
  const a = process.argv.slice(2)
  if (a.length === 0) return null
  if (a[0] === '--src') return a[1] || null
  if (a[0].startsWith('--src=')) return a[0].slice('--src='.length) || null
  return a[0]
}

// 题库源解析：--src 优先（不存在即失败，不回落，避免静默用错库），否则本地真实题库优先，否则用仓库内示例题库
const srcArg = parseSrcArg()
if (srcArg) {
  const explicit = path.resolve(root, srcArg)
  if (!fs.existsSync(path.join(explicit, 'problems.json'))) {
    console.error(`[指纹清单] --src 指定的题库不存在：${explicit}（cwd=${process.cwd()}）`)
    process.exit(1)
  }
}
const candidates = [
  ...(srcArg ? [path.resolve(root, srcArg)] : []),
  path.join(root, 'server', 'problems-local'),
  path.join(root, 'server', 'problems'),
]
const problemsDir = candidates.find(dir => dir && fs.existsSync(path.join(dir, 'problems.json')))
if (!problemsDir) {
  console.error(`[指纹清单] 未找到题库源，已检查：${candidates.join(' ； ')}（cwd=${process.cwd()}）`)
  process.exit(1)
}

const outFile = path.join(root, 'src', 'main', 'problems', 'manifest.json')

// 与 server/src/problems.ts 同步：去 BOM + 统一换行为 \n（字段不 trim）
function normalize(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function fingerprint(p) {
  return crypto
    .createHash('sha256')
    .update(`${p.id}|${p.title}|${p.difficulty}|${p.author}|${normalize(p.statement)}`)
    .digest('hex')
}

function gitRev() {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, encoding: 'utf-8', timeout: 5000 }).trim()
  } catch {
    return 'unknown'
  }
}

const meta = JSON.parse(fs.readFileSync(path.join(problemsDir, 'problems.json'), 'utf-8'))
const list = meta.problems || []

// 题数校验：0 题则失败退出
if (!Array.isArray(list) || list.length === 0) {
  console.error('[指纹清单] 题库为空（0 题），拒绝生成')
  process.exit(1)
}

// id 去重校验：重复 id 失败退出
{
  const seen = new Set()
  const dup = new Set()
  for (const p of list) {
    if (seen.has(p.id)) dup.add(p.id)
    seen.add(p.id)
  }
  if (dup.size > 0) {
    console.error(`[指纹清单] 题目 id 重复：${[...dup].join(', ')}，拒绝生成`)
    process.exit(1)
  }
}

const entries = list
  .map(p => {
    const statement = fs.readFileSync(path.join(problemsDir, p.file), 'utf-8')
    return { id: p.id, hash: fingerprint({ ...p, statement }) }
  })
  .sort((a, b) => a.id - b.id)

const manifestHash = crypto
  .createHash('sha256')
  .update(entries.map(e => `${e.id}:${e.hash}`).join('\n'))
  .digest('hex')

const out = {
  problems: entries,
  manifestHash,
  meta: {
    source: path.relative(root, problemsDir) || problemsDir,
    builtAt: new Date().toISOString(),
    gitRev: gitRev(),
  },
}

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n', 'utf-8')
console.log(`[指纹清单] 已生成 ${entries.length} 条 → ${path.relative(root, outFile)}（source=${out.meta.source} rev=${out.meta.gitRev}）`)
