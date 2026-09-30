import { DatabaseSync } from 'node:sqlite'
import { config } from './config'
import path from 'path'
import fs from 'fs'

// 确保数据目录存在
const dbDir = path.dirname(config.DB_PATH)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new DatabaseSync(config.DB_PATH)

// 开启 WAL 模式（更好的并发读写）
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA busy_timeout = 5000')
db.exec('PRAGMA foreign_keys = ON')
db.exec('PRAGMA synchronous = NORMAL')

// 老库升级：补齐 allowed / language 列
try {
  const cols = db.prepare("SELECT name FROM pragma_table_info('students')").all() as { name: string }[]
  const names = new Set(cols.map(c => c.name))
  if (cols.length > 0) {
    if (!names.has('allowed')) {
      db.exec("ALTER TABLE students ADD COLUMN allowed INTEGER NOT NULL DEFAULT 0")
    }
    if (!names.has('language')) {
      db.exec("ALTER TABLE students ADD COLUMN language TEXT NOT NULL DEFAULT 'c'")
    }
  }
} catch {
  // 表还没建时忽略
}

// 老库升级：scores → submissions（只存代码 + 考后判分字段）
try {
  const hasScores = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scores'").get()
  const hasSubmissions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='submissions'").get()
  if (hasScores && !hasSubmissions) {
    db.exec('ALTER TABLE scores RENAME TO submissions')
  }
  const cols = db.prepare("SELECT name FROM pragma_table_info('submissions')").all() as { name: string }[]
  const names = new Set(cols.map(c => c.name))
  if (cols.length > 0 && !names.has('judged_at')) {
    db.exec('ALTER TABLE submissions ADD COLUMN judged_at INTEGER')
  }
} catch {
  // 表还没建时忽略
}

// 老库升级：behaviors 补 level 列（防作弊分级）
try {
  const hasBehaviors = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='behaviors'").get()
  const bcols = db.prepare("SELECT name FROM pragma_table_info('behaviors')").all() as { name: string }[]
  if (hasBehaviors && bcols.length > 0 && !new Set(bcols.map(c => c.name)).has('level')) {
    db.exec("ALTER TABLE behaviors ADD COLUMN level TEXT NOT NULL DEFAULT 'normal'")
  }
} catch {
  // 表还没建时忽略
}

// ── 建表 ──
db.exec(`
  -- 学生表（allowed=1 才允许考试，language 绑定考试语言 c/python）
  CREATE TABLE IF NOT EXISTS students (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    allowed     INTEGER NOT NULL DEFAULT 0,
    language    TEXT NOT NULL DEFAULT 'c',
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  -- 提交表（每次提交存一条代码，考后统一判卷）
  CREATE TABLE IF NOT EXISTS submissions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   TEXT NOT NULL,
    problem_id   INTEGER NOT NULL,
    title        TEXT,
    language     TEXT NOT NULL,
    code         TEXT NOT NULL,
    score        INTEGER,
    passed       INTEGER,
    total        INTEGER,
    status       TEXT NOT NULL DEFAULT 'pending',
    submitted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    judged_at    INTEGER,
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  -- 交卷记录（幂等，每生一条）
  CREATE TABLE IF NOT EXISTS finishes (
    student_id  TEXT PRIMARY KEY,
    finished_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  -- 防作弊行为记录（交卷时上报一次，最简；level: normal/warning/serious）
  CREATE TABLE IF NOT EXISTS behaviors (
    student_id        TEXT PRIMARY KEY,
    focus_loss_count  INTEGER NOT NULL DEFAULT 0,
    violations        TEXT NOT NULL DEFAULT '[]',
    duration_seconds  INTEGER NOT NULL DEFAULT 0,
    level             TEXT NOT NULL DEFAULT 'normal',
    reported_at       INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (student_id) REFERENCES students(id)
  );

  -- 登录会话（DB 持久化，服务重启后令牌仍有效；过期由定时 sweep 清理）
  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    student_id  TEXT NOT NULL,
    name        TEXT,
    language    TEXT,
    created_at  INTEGER,
    expires_at  INTEGER
  );

  -- 提交查询加速（按学生+题目查卷）
  CREATE INDEX IF NOT EXISTS idx_submissions_student_problem ON submissions(student_id, problem_id);
`)

export default db
