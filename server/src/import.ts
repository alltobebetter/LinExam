import fs from 'node:fs'
import path from 'node:path'
import db from './db'

// ── 名册导入 ──
// 从 roster.json（本地生成，不入库，见 scripts-local/ 说明）批量导入真实考生：
//   { "students": [{ "id": "手机号", "name": "姓名" }, ...] }
// 新行 language 置空（= 未选语言，须先到 GET /select 选一次）；
// 已存在的行只更新姓名，不碰 allowed（禁考态保留）与 language（已选语言保留）。

const file = path.resolve(process.env.ROSTER_FILE || path.join(__dirname, '../roster.json'))

function main() {
  if (!fs.existsSync(file)) {
    console.error(`[导入] 名册文件不存在：${file}（可用环境变量 ROSTER_FILE 指定）`)
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
    students: { id: string; name: string }[]
  }
  const list = raw.students
  if (!Array.isArray(list) || list.length === 0) {
    console.error('[导入] 名册为空（students 需为非空数组），拒绝执行')
    process.exit(1)
  }

  const seen = new Set<string>()
  const dup: string[] = []
  for (const s of list) {
    if (seen.has(s.id)) dup.push(s.id)
    seen.add(s.id)
  }
  if (dup.length > 0) {
    console.error(`[导入] 手机号重复：${dup.join(', ')}，拒绝执行`)
    process.exit(1)
  }

  const stmt = db.prepare(`
    INSERT INTO students (id, name, allowed, language) VALUES (?, ?, 1, '')
    ON CONFLICT(id) DO UPDATE SET name = excluded.name
  `)
  let n = 0
  for (const s of list) {
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || !s.id.trim() || !s.name.trim()) {
      console.error(`[导入] 跳过非法行：${JSON.stringify(s)}`)
      continue
    }
    stmt.run(s.id.trim(), s.name.trim())
    n += 1
  }
  console.log(`✅ 已导入 ${n} 名考生（language 为空=待选语言，不覆盖禁考/已选语言）。`)
  console.log('考生先访问 GET /select 选语言（每人一次），再用 姓名 + 手机号 登录考试端。')
}

main()
