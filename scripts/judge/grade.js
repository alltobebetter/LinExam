const { DatabaseSync } = require('node:sqlite')
const fs = require('fs')
const path = require('path')
const { executeCode } = require('./executor')

// 考后统一判卷：读取 submissions（status=pending），每生每题只取最后一次判卷
// （绝不累加多次提交），用 cases-local/full.json（本地，不入库）> cases/full.example.json
// 的全部用例逐个运行，回写 score/passed/total/status；被覆盖的旧待判标 superseded。
//
// 用法：node scripts/judge/grade.js [dbPath] [casesPath]
//   默认 dbPath=server/data/linexam.db，casesPath 按上述回落自动选择

const dbPath = path.resolve(process.argv[2] || path.join(__dirname, '../../server/data/linexam.db'))
const casesPath = path.resolve(
  process.argv[3] ||
  (fs.existsSync(path.join(__dirname, '../../cases-local/full.json'))
    ? path.join(__dirname, '../../cases-local/full.json')
    : path.join(__dirname, '../../cases/full.example.json'))
)
const DEFAULT_TIME_LIMIT = 5000

const normalize = (s) => (s || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`数据库不存在: ${dbPath}`)
    process.exit(1)
  }
  if (!fs.existsSync(casesPath)) {
    console.error(`评测数据不存在: ${casesPath}`)
    process.exit(1)
  }

  const cases = JSON.parse(fs.readFileSync(casesPath, 'utf-8'))
  const db = new DatabaseSync(dbPath)

  // 每生每题只取最后一次待判提交（id 最大，仅 pending），其余待判旧提交标记 superseded。
  // 注意：只动 pending 行，已判的 pass/fail 绝不覆盖（可重复执行）；汇总时再按每组 MAX(id) 去重防双计。
  const superseded = db.prepare(`
    UPDATE submissions SET status = 'superseded', judged_at = strftime('%s','now')
    WHERE status = 'pending' AND id NOT IN (
      SELECT MAX(id) FROM submissions WHERE status = 'pending' GROUP BY student_id, problem_id
    )
  `).run()
  if (superseded.changes > 0) {
    console.log(`已跳过 ${superseded.changes} 份被后续提交覆盖的旧提交（superseded）`)
  }

  const rows = db.prepare(
    "SELECT id, student_id, problem_id, language, code FROM submissions WHERE status = 'pending'"
  ).all()

  console.log(`待判 ${rows.length} 份，数据库 ${dbPath}`)

  const update = db.prepare(`
    UPDATE submissions
    SET score = ?, passed = ?, total = ?, status = ?, judged_at = strftime('%s','now')
    WHERE id = ?
  `)

  let done = 0
  for (const row of rows) {
    const problem = cases[String(row.problem_id)]
    if (!problem) {
      // 未知题保持 pending 跳过（不回写 error，避免污染汇总 total 口径），下次配好用例再判
      console.error(`[跳过] id=${row.id} 未知题目 ${row.problem_id}`)
      continue
    }
    const allCases = problem.testCases || []
    let passed = 0
    let status = 'fail'

    if (!allCases.length) {
      status = 'error'
    } else if (row.language !== 'c' && row.language !== 'python') {
      status = 'error'
    } else {
      let broken = false
      for (const tc of allCases) {
        // 注意：当前无内存限制（见 executor.js 说明），仅时间限制兜底
        // 用例级 timeLimit 优先，其次题目级，最后默认值
        const limit = tc.timeLimit ?? problem.timeLimit ?? DEFAULT_TIME_LIMIT
        const result = await executeCode(row.language, row.code, tc.input, limit)
        if (result.status === 'compile_error') {
          status = 'compile_error'
          passed = 0
          broken = true
          break
        }
        if (result.status === 'timeout') {
          status = 'timeout'
          broken = true
          break
        }
        if (result.status === 'runtime_error') {
          status = 'runtime_error'
          broken = true
          break
        }
        if (result.status === 'error') {
          status = 'error'
          broken = true
          break
        }
        if (result.status === 'success' && normalize(result.stdout) === normalize(tc.expectedOutput)) {
          passed++
        }
      }
      if (!broken) {
        status = passed === allCases.length ? 'pass' : 'fail'
      }
    }

    const score = allCases.length ? Math.round((passed / allCases.length) * 100) : 0
    update.run(score, passed, allCases.length, status, row.id)
    done++
    console.log(`[${done}/${rows.length}] id=${row.id} ${row.student_id} 题${row.problem_id} ${row.language} → ${status} ${passed}/${allCases.length} 分${score}`)
  }

  // 汇总：每生每题以最后一次提交为准（内层 MAX 取 id 最大，外层只统计已判状态）
  // （状态枚举与判卷写入一致：pass / fail / compile_error / error / timeout / runtime_error）
  const summary = db.prepare(`
    SELECT student_id, COUNT(*) AS total, SUM(score) AS sum_score
    FROM submissions WHERE id IN (
      SELECT MAX(id) FROM submissions
      WHERE status IN ('pass', 'fail', 'compile_error', 'error', 'timeout', 'runtime_error')
      GROUP BY student_id, problem_id
    )
    GROUP BY student_id ORDER BY sum_score DESC
  `).all()
  console.log('\n── 总分汇总（每生每题以最后一次提交为准）──')
  for (const s of summary) {
    console.log(`${s.student_id} 覆盖${s.total}题 总分${s.sum_score}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
