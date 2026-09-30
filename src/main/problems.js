/**
 * 题库指纹校验。
 *
 * 客户端不再打包题面（题面由考试服务端在登录后下发），
 * 本地只带一份指纹清单 manifest.json（构建时由 scripts/gen-problem-manifest.js
 * 从 server/problems/ 生成）。运行时用【收到的题目内容本地重算指纹】再与清单比对：
 *   - 任何字段（题面/标题/难度/作者）被篡改 → 重算指纹对不上 → 拒绝进入考试；
 *   - 清单里没有的题、清单里有但服务端没发的题 → 拒绝。
 * 注意：绝不能只比对服务端自报的 hash 字段——伪造服务器改了内容后
 * 自会附上按新内容算的 hash，只有本地重算才能识破。
 *
 * 指纹算法必须与 scripts/gen-problem-manifest.js / server/src/problems.ts 一致：
 *   sha256( `${id}|${title}|${difficulty}|${author}|${md 归一化为 \n}` )
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const manifestFile = path.join(__dirname, 'problems', 'manifest.json')

function normalize(text) {
  return String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 用收到的题目内容本地重算指纹（不信任服务端算的） */
function recomputeHash(p) {
  return crypto
    .createHash('sha256')
    .update(`${p.id}|${p.title}|${p.difficulty}|${p.author}|${normalize(p.md)}`)
    .digest('hex')
}

function loadManifest() {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'))
  return new Map(manifest.problems.map(p => [p.id, p.hash]))
}

/**
 * 校验服务端下发的题目列表。
 * @param {Array<{id:number, title:string, difficulty:string, author:string, md:string, hash?:string}>} fetched
 * @returns {{ok: true, problems: Array} | {ok: false, error: string}}
 */
function verifyFetchedProblems(fetched) {
  if (!Array.isArray(fetched) || fetched.length === 0) {
    return { ok: false, error: '服务端未返回任何题目' }
  }

  let manifest
  try {
    manifest = loadManifest()
  } catch {
    return { ok: false, error: '客户端题库清单缺失，请联系监考老师' }
  }

  // 题量与题号必须与清单完全一致
  if (fetched.length !== manifest.size) {
    return { ok: false, error: '题目数量与考试清单不符，请检查服务器地址是否正确' }
  }
  for (const p of fetched) {
    if (!manifest.has(p.id)) {
      return { ok: false, error: `题目#${p.id}不在本场考试清单中，请检查服务器地址是否正确` }
    }
  }

  // 逐题用收到的内容重算指纹与清单比对（不信任服务端自报 hash）
  for (const p of fetched) {
    if (recomputeHash(p) !== manifest.get(p.id)) {
      return { ok: false, error: `题目#${p.id}内容与考试清单不符，请检查服务器地址是否正确` }
    }
  }

  return { ok: true, problems: fetched }
}

module.exports = { verifyFetchedProblems }
