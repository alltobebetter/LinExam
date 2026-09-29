/**
 * 生成客户端题库指纹清单（src/main/problems/manifest.json）。
 *
 * 从服务端题库源（server/problems/）计算每道题的指纹，
 * 客户端打包时只带这份清单（不含题面），运行时用它校验
 * 服务端下发的题目，防止考生把客户端指向伪造服务器换题。
 *
 * 指纹算法必须与 server/src/problems.ts 保持一致：
 *   sha256( `${id}|${title}|${difficulty}|${author}|${statement 归一化为 \n}` )
 *
 * 用法：node scripts/gen-problem-manifest.js  （predev:all / prebuild 自动执行）
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const root = path.resolve(__dirname, '..')

// 题库源解析：本地真实题库（problems-local，不入库）优先，否则用仓库内示例题库
const candidates = [
  path.join(root, 'server', 'problems-local'),
  path.join(root, 'server', 'problems'),
]
const problemsDir = candidates.find(dir => fs.existsSync(path.join(dir, 'problems.json')))
if (!problemsDir) {
  console.error('[指纹清单] 未找到题库源（server/problems 或 server/problems-local）')
  process.exit(1)
}

const outFile = path.join(root, 'src', 'main', 'problems', 'manifest.json')

function normalize(text) {
  return text.replace(/\r\n/g, '\n')
}

function fingerprint(p) {
  return crypto
    .createHash('sha256')
    .update(`${p.id}|${p.title}|${p.difficulty}|${p.author}|${normalize(p.statement)}`)
    .digest('hex')
}

const meta = JSON.parse(fs.readFileSync(path.join(problemsDir, 'problems.json'), 'utf-8'))
const entries = meta.problems
  .map(p => {
    const statement = fs.readFileSync(path.join(problemsDir, p.file), 'utf-8')
    return { id: p.id, hash: fingerprint({ ...p, statement }) }
  })
  .sort((a, b) => a.id - b.id)

const manifestHash = crypto
  .createHash('sha256')
  .update(entries.map(e => `${e.id}:${e.hash}`).join('\n'))
  .digest('hex')

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify({ problems: entries, manifestHash }, null, 2) + '\n', 'utf-8')
console.log(`[指纹清单] 已生成 ${entries.length} 条 → ${path.relative(root, outFile)}`)
