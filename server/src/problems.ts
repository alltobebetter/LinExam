/**
 * 服务端题库加载。
 *
 * 题库是"纯提交"考试的唯一事实源：登录后通过 GET /api/problems 下发给客户端，
 * 客户端用本地预置的指纹清单（构建时由 scripts/gen-problem-manifest.js 生成）
 * 逐题校验，防止考生把客户端指向伪造服务器换取"友善版"题目。
 *
 * 指纹算法（与生成脚本必须保持一致）：
 *   sha256( `${id}|${title}|${difficulty}|${author}|${statement 归一化为 \n}` )
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config'

export interface ExamProblem {
  id: number
  title: string
  difficulty: string
  author: string
  statement: string
  hash: string
}

/** 题面换行归一化：统一为 \n，消除 Windows/Linux 检出差异导致的指纹漂移 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n')
}

export function problemFingerprint(p: {
  id: number
  title: string
  difficulty: string
  author: string
  statement: string
}): string {
  return crypto
    .createHash('sha256')
    .update(`${p.id}|${p.title}|${p.difficulty}|${p.author}|${normalize(p.statement)}`)
    .digest('hex')
}

let cached: ExamProblem[] | null = null

export function loadProblems(): ExamProblem[] {
  if (cached) return cached

  const dir = path.resolve(config.PROBLEMS_DIR)
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'problems.json'), 'utf-8')) as {
    problems: { id: number; title: string; difficulty: string; author: string; file: string }[]
  }

  cached = meta.problems
    .map(p => {
      const statement = fs.readFileSync(path.join(dir, p.file), 'utf-8')
      const full = { ...p, statement }
      return { ...full, hash: problemFingerprint(full) }
    })
    .sort((a, b) => a.id - b.id)

  console.log(`[题库] 已加载 ${cached.length} 道题目（${dir}）`)
  return cached
}

/** 整卷指纹：所有题目指纹按题号排序后再次哈希，用于整体一致性校验 */
export function manifestFingerprint(problems: ExamProblem[]): string {
  return crypto
    .createHash('sha256')
    .update(problems.map(p => `${p.id}:${p.hash}`).join('\n'))
    .digest('hex')
}
