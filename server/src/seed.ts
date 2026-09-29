import db from './db'

// ── 测试学生名单 ──
// 登录时服务端会校验：姓名 + 学号 必须匹配名单中的某一行，且 allowed=1。
// 想增删学生，编辑这个数组后重新运行 `npm run seed`。
const students = [
  { id: '20260001', name: '张三', language: 'c' },
  { id: '20260002', name: '李四', language: 'python' },
  { id: '20260003', name: '王五', language: 'c' },
]

function seed() {
  const stmt = db.prepare(`
    INSERT INTO students (id, name, allowed, language) VALUES (?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, allowed = 1, language = excluded.language
  `)

  for (const s of students) {
    stmt.run(s.id, s.name, s.language)
  }

  console.log(`✅ 已写入 ${students.length} 个测试学生：`)
  for (const s of students) {
    console.log(`   ${s.id}  ${s.name}  ${s.language}`)
  }
  console.log('登录时请使用上述 姓名 + 学号 组合。')
}

seed()
