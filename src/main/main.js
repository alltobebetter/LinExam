const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { startExamMonitoring, stopExamMonitoring, bindWindowEvents, getBehaviorSummary } = require('./anticheat')
const { verifyFetchedProblems } = require('./problems')

// 显式固定用户数据目录（%APPDATA%/linexam）：
// 引入 productName 后 app.getName() 会变为 "LinExam"，不钉住的话
// 升级到新版本时考试进度/提交记录的目录会对不上
app.setPath('userData', path.join(app.getPath('appData'), 'linexam'))

// 考试语言由后端按学生绑定（c/python），登录后确定，不可切换
const isDev = process.argv.includes('--dev')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

// 外部服务地址（生产环境可用环境变量覆盖）
// 服务端地址：登录页填写（localStorage 记忆），无默认预填；环境变量仅供本地调试覆盖
let serverUrl = process.env.LINEXAM_SERVER_URL || ''

let mainWindow = null
let sessionToken = null
let sessionLanguage = 'c'
let sessionProblems = []   // 登录时校验通过的服务端题目（含题面）
let sessionExamId = null // 本场考试指纹（manifestHash，仅作进度命名空间）
let finished = false
let currentStudentId = null  // 当前登录学生，用于 submissions 过滤与补报归属

/**
 * 开发模式窗口/任务栏图标：指向仓库内的 build/icon.png。
 * 打包后该路径不存在（图标已嵌入 exe），返回 undefined 走系统默认。
 */
function getAppIcon() {
  const devIcon = path.join(__dirname, '../../build/icon.png')
  return fs.existsSync(devIcon) ? devIcon : undefined
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: 'LinExam',
    frame: false,
    backgroundColor: '#f1f5f9',
    // 开发模式任务栏/窗口图标（打包后由 electron-builder 嵌入 exe，此路径不存在时自动忽略）
    icon: getAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev && VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(
      path.join(__dirname, '../renderer/dist/index.html')
    )
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 绑定防作弊事件
  bindWindowEvents(mainWindow)
}

// ── 窗口控制 IPC ──
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
    // 通知渲染层（TitleBar 图标切换）
    mainWindow.webContents.send('window:maximized-change', mainWindow.isMaximized())
  }
})

ipcMain.on('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

/**
 * 归一化并校验用户输入的服务器地址：只接受 http/https 根地址，
 * 未写协议自动补 http（明文有嗅探风险，仅限内网机房）。
 */
function normalizeServerUrl(input) {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    if (url.pathname !== '/' && url.pathname !== '') return null
    if (url.search || url.hash) return null
    return withScheme.replace(/\/+$/, '')
  } catch {
    return null
  }
}

// ── 原子写 JSON（tmp + rename，避免崩溃写半截文件；rename 失败时回退直写）──
function atomicWriteJson(file, data) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const text = JSON.stringify(data, null, 2)
  try {
    fs.writeFileSync(tmp, text, 'utf-8')
    try {
      fs.renameSync(tmp, file)
    } catch (err) {
      // Windows 被占用/AV 锁定时 rename 可能 EPERM：unlink 后重试，仍失败则直写目标并告警
      try {
        fs.rmSync(file, { force: true })
        fs.renameSync(tmp, file)
      } catch {
        fs.writeFileSync(file, text, 'utf-8')
        try { fs.rmSync(tmp, { force: true }) } catch {}
        console.error('原子写 rename 失败，已回退直写:', err?.message || err)
      }
    }
  } catch (err) {
    console.error('原子写失败:', err?.message || err)
    throw err
  }
}

// ── 待补报队列（交卷/行为上报失败时落盘，下次 login/finish 补报）──
function pendingFinishFile() {
  return path.join(app.getPath('userData'), 'pending-finish.json')
}

function pendingBehaviorFile() {
  return path.join(app.getPath('userData'), 'pending-behavior.json')
}

function loadPendingFinish() {
  try {
    const data = JSON.parse(fs.readFileSync(pendingFinishFile(), 'utf-8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

function savePendingFinish(queue) {
  try {
    atomicWriteJson(pendingFinishFile(), queue)
  } catch (err) {
    console.error('保存待补报队列失败:', err)
  }
}

function queuePendingFinish(entry) {
  // 按学生单槽覆盖：同一学生多次失败只保留最新 snapshot，避免恢复后重复上报
  const queue = loadPendingFinish().filter(q => (q.studentId || q.summary?.studentId) !== entry.studentId)
  queue.push(entry)
  savePendingFinish(queue)
}

/**
 * 补报旧队列（先补旧）：逐条重放 /api/finish + /api/behavior（按 needsFinish 决定是否补交卷）。
 * 都 ok 才出队，失败（网络/非2xx）则保留剩余，下次再试；同时合并 legacy pending-behavior.json。
 */
async function flushPendingFinish(token) {
  // 合并 legacy pending-behavior.json（关窗快照）：转为 needsFinish=false 条目后删除旧文件
  // TODO(迁移窗后删除)：老版本升级一次性合并，新安装不会产生该文件
  try {
    const legacy = loadJson(pendingBehaviorFile(), null)
    if (legacy) {
      const arr = Array.isArray(legacy) ? legacy : [legacy]
      const cur = loadPendingFinish()
      let changed = false
      for (const s of arr) {
        if (!s || typeof s !== 'object') continue
        cur.push({ studentId: s.studentId || currentStudentId, time: new Date().toISOString(), summary: s.summary || s, needsFinish: false })
        changed = true
      }
      if (changed) savePendingFinish(cur)
      fs.rmSync(pendingBehaviorFile(), { force: true })
    }
  } catch { /* 无旧文件则忽略 */ }
  const queue = loadPendingFinish()
  if (!queue.length || !token) return
  const remain = []
  for (const item of queue) {
    const summary = item.summary || item
    const needsFinish = item.needsFinish !== false
    try {
      if (needsFinish) {
        const fResp = await postFinish(token)
        if (fResp.status === 401) { remain.push(item); continue }
        if (!(fResp.ok || fResp.status === 403)) { remain.push(item); continue }
      }
      const resp = await postBehavior(token, summary)
      if (!resp.ok) {
        // behavior 失败则保留（下次重放 finish 幂等）
        remain.push(item)
      }
    } catch (err) {
      console.error('[补报] 旧行为数据补报失败，保留队列:', err?.message || err)
      remain.push(item)
    }
  }
  if (remain.length !== queue.length) {
    savePendingFinish(remain)
  }
}

// ── 登录（在线验证 + 题库下发校验） ──
// 登录成功后立即拉取题库并用本地指纹清单校验：题目不对就禁止进入考试，
// 防止考生把客户端指向伪造服务器换取"友善版"题目。
ipcMain.handle('auth:login', async (_event, { name, studentId, serverUrl: inputUrl }) => {
  // 清除上一会话的令牌/题目缓存：重新登录必须走完整的题库校验，
  // 避免"题库校验失败但仍持旧令牌"的半开状态
  sessionToken = null
  sessionProblems = []

  const normalized = normalizeServerUrl(inputUrl)
  if (!normalized) {
    return { ok: false, error: '服务器地址格式不正确，只需填写 http://IP:端口' }
  }
  serverUrl = normalized

  try {
    const resp = await fetch(`${serverUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, studentId }),
      signal: AbortSignal.timeout(10000),
    })
    const data = await resp.json()

    if (!resp.ok) {
      return { ok: false, error: data.error || '登录失败' }
    }

    // ── 题库下发 + 指纹校验（不通过则拒绝进入考试）──
    let fetchedProblems
    let fetchedExamId = null
    try {
      const pResp = await fetch(`${serverUrl}/api/problems`, {
        headers: { Authorization: `Bearer ${data.token}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!pResp.ok) {
        if (pResp.status === 401) {
          return { ok: false, error: '登录已过期，请重新登录', code: 401 }
        }
        return { ok: false, error: '题库获取失败，请联系监考老师' }
      }
      const pData = await pResp.json()
      const verdict = verifyFetchedProblems(pData.problems)
      if (!verdict.ok) {
        console.error('[题库校验失败]', verdict.error)
        return { ok: false, error: verdict.error }
      }
      fetchedProblems = pData.problems
      fetchedExamId = typeof pData.manifestHash === 'string' ? pData.manifestHash : null
    } catch (err) {
      console.error('[题库获取失败]', err)
      return { ok: false, error: '题库获取失败，请检查网络后重试' }
    }

    sessionToken = data.token
    sessionLanguage = data.language === 'python' ? 'python' : 'c'
    sessionProblems = fetchedProblems
    sessionExamId = fetchedExamId
    currentStudentId = data.studentId

    // ── 按学生+考试重置/延续考试状态 ──
    // 同一学生同一套卷重新登录（如客户端崩溃重启）：保留代码进度，仅重置计时器；
    // 换学生或换套卷：清空上一份代码/进度/提交记录，避免泄露与串卷。
    resetExamStateFor(data.studentId, fetchedExamId)

    // 登录成功后补报旧队列（先补旧）
    try {
      await flushPendingFinish(sessionToken)
    } catch (err) {
      console.error('[补报] 登录后补报失败:', err)
    }

    return { ok: true, ...data }
  } catch (err) {
    console.error('[登录] 无法连接考试服务:', err)
    return { ok: false, error: '无法连接到考试服务，请稍后重试' }
  }
})

// ── 题库 IPC ──
ipcMain.handle('problem:list', () => {
  // 题目来自登录时校验过的服务端下发缓存
  return sessionProblems.map(p => ({
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    author: p.author,
  }))
})

ipcMain.handle('problem:get', (_event, problemId) => {
  const p = sessionProblems.find(p => p.id === problemId)
  if (!p) return null
  // 纯提交模式：前端只做题面展示，不做任何判题
  return {
    id: p.id,
    title: p.title,
    difficulty: p.difficulty,
    author: p.author,
    md: p.md,
  }
})

// 考试进度持久化：userData/exam-progress.json，key = problemId，_meta 记录归属/考试/计时
function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) || fallback
  } catch {
    return fallback
  }
}

function loadProgress() {
  return loadJson(path.join(app.getPath('userData'), 'exam-progress.json'), {})
}

function saveProgress(progress) {
  try {
    const file = path.join(app.getPath('userData'), 'exam-progress.json')
    atomicWriteJson(file, progress)
  } catch (err) {
    console.error('保存考试进度失败:', err)
  }
}

// 进度写队列：promise 链串行化 read-modify-write，避免 autosave 与 submit 交错丢 code
let progressWriteQueue = Promise.resolve()
function enqueueProgressUpdate(mutator) {
  const task = progressWriteQueue.then(() => {
    const progress = loadProgress()
    mutator(progress)
    saveProgress(progress)
  })
  progressWriteQueue = task.catch(() => {})
  return task
}

/**
 * 登录时按学生+考试重置考试状态。
 * - 同一学生同一套卷：保留代码进度（崩溃恢复），重置考试开始时间；已交卷则本地锁定。
 * - 不同学生（含 _meta 缺失的未知归属）或不同套卷（examId 不一致）：清空进度与提交记录。
 * examId 取服务端下发的 manifestHash，仅作命名空间（换卷识别），不作安全判定；
 * 缺失时做向后兼容：不断言换卷，只沿用旧值，避免升级当场丢草稿。
 */
function resetExamStateFor(studentId, examId) {
  const progress = loadProgress()
  const meta = progress._meta || {}
  const examChanged = !!(meta.examId && examId && meta.examId !== examId)

  if (!meta.studentId || meta.studentId !== studentId || examChanged) {
    // 换人/换卷（含归属缺失）：全部清空，并立即写入新归属标记，
    // 防止「换人做题→重启→第三人登录」时被误判为同一学生而串卷
    try {
      fs.rmSync(path.join(app.getPath('userData'), 'exam-progress.json'), { force: true })
      fs.rmSync(path.join(app.getPath('userData'), 'submissions.json'), { force: true })
    } catch (err) {
      console.error('重置考试状态失败:', err)
    }
    finished = false
    saveProgress({ _meta: { studentId, examId: examId || meta.examId, startTime: Date.now() } })
    if (examChanged) {
      console.log(`[登录] 检测到换卷（examId 变化），已重置考试状态（→ ${studentId}）`)
    } else if (meta.studentId) {
      console.log(`[登录] 检测到学生切换（${meta.studentId} → ${studentId}），已重置考试状态`)
    } else {
      console.log(`[登录] 进度无归属标记，按换人处理，已重置考试状态（→ ${studentId}）`)
    }
    return
  }

  // 同一学生同一套卷：保留进度，重置计时器（旧的 startTime 可能属于上一场考试）
  finished = !!meta.finished
  progress._meta = { ...meta, studentId, examId: examId || meta.examId, startTime: Date.now(), finished: finished || undefined }
  saveProgress(progress)

  if (finished) {
    // 已交卷的学生重新登录：同步本地锁，防止继续作答
    console.log('[登录] 该学生已交卷，本地保持锁定')
  }
}

// 代码提交记录：userData/submissions.json（上报成功才落库）
function loadSubmissions() {
  const v = loadJson(path.join(app.getPath('userData'), 'submissions.json'), [])
  return Array.isArray(v) ? v : []
}

function saveSubmissions(list) {
  try {
    atomicWriteJson(path.join(app.getPath('userData'), 'submissions.json'), list)
  } catch (err) {
    console.error('保存提交记录失败:', err)
  }
}

function authHeaders(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

function postCode({ problemId, title, code }) {
  if (!sessionToken) return
  return fetch(`${serverUrl}/api/submit`, {
    method: 'POST',
    headers: authHeaders(sessionToken),
    body: JSON.stringify({ problemId, title, code }),
    signal: AbortSignal.timeout(10000),
  })
}

function postFinish(token) {
  return fetch(`${serverUrl}/api/finish`, {
    method: 'POST',
    headers: authHeaders(token),
    signal: AbortSignal.timeout(10000),
  })
}

function postBehavior(token, summary) {
  return fetch(`${serverUrl}/api/behavior`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      focusLossCount: summary.focusLossCount || 0,
      violations: summary.violations || [],
      duration: summary.duration || 0,
      level: summary.level || 'normal',
    }),
    signal: AbortSignal.timeout(10000),
  })
}

ipcMain.handle('code:submit', async (_event, { problemId, code }) => {
  const problem = sessionProblems.find(p => p.id === problemId)
  if (!problem) return { error: '题目不存在' }

  if (finished) {
    return { error: '已交卷，无法再次提交' }
  }

  if (!sessionToken) {
    return { error: '尚未登录，无法提交' }
  }

  const language = sessionLanguage

  if (!code?.trim()) {
    return { error: '请先编写代码' }
  }

  // ── 上报代码（失败则本次提交失败，不落库）──
  try {
    const resp = await postCode({
      problemId, title: problem.title, code,
    })
    if (!resp || !resp.ok) {
      const status = resp?.status
      if (status === 401) {
        return { error: '登录已过期，请重新登录', code: 401 }
      }
      if (status === 403) {
        return { error: '已交卷，无法再次提交' }
      }
      console.error('[提交] 代码上报被拒绝:', status, await resp?.text().catch(() => ''))
      return { error: '提交失败，请稍后重试' }
    }
  } catch (err) {
    console.error('[提交] 无法连接考试服务:', err)
    return { error: '无法连接考试服务，请稍后重试' }
  }

  // 标记看过（经写队列串行化，避免与 autosave 交错丢 code）
  await enqueueProgressUpdate((progress) => {
    progress[problemId] = {
      ...(progress[problemId] || {}),
      viewed: true,
    }
  })

  // 上报成功后才本地保存（带 studentId，便于按人过滤）
  const list = loadSubmissions()
  list.push({
    problemId, language, code,
    studentId: currentStudentId,
    time: new Date().toISOString(),
  })
  saveSubmissions(list)

  return { ok: true }
})

// ── 提交记录 IPC（本地持久化，按当前学生过滤）──
ipcMain.handle('submission:list', (_event, problemId) => {
  let result = loadSubmissions()
  if (currentStudentId) {
    // 兼容老数据（无 studentId）：不过滤，避免升级后记录变空
    result = result.filter(s => !s.studentId || s.studentId === currentStudentId)
  }
  if (problemId) {
    result = result.filter(s => s.problemId === problemId)
  }
  return result.slice(-50).reverse()
})

// ── 考试进度 IPC ──
// 保存某题进度（代码/是否看过），经写队列串行化
ipcMain.handle('progress:save', async (_event, { problemId, code, viewed }) => {
  await enqueueProgressUpdate((progress) => {
    const entry = progress[problemId] || {}
    if (code !== undefined) entry.code = code
    if (viewed !== undefined) entry.viewed = viewed
    progress[problemId] = entry
  })
  return { ok: true }
})

// ── 上次答题题目（仅 _meta.lastProblemId，不含代码；换卷时由 resetExamStateFor 清空）──
ipcMain.handle('progress:setLast', async (_event, problemId) => {
  const id = Number(problemId)
  if (!Number.isFinite(id)) return { ok: false }
  // 白名单校验：不在本场题内不记，避免后端换题后记脏 ID
  if (!sessionProblems.some(p => p.id === id)) return { ok: false }
  await enqueueProgressUpdate((progress) => {
    progress._meta = { ...(progress._meta || {}), lastProblemId: id }
  })
  return { ok: true }
})

// ── 考试语言（登录时由后端绑定，不可切换）──
ipcMain.handle('exam:language', () => {
  return sessionLanguage
})

ipcMain.handle('progress:get', () => {
  return loadProgress()
})

// ── 考试开始时间（持久化，刷新不丢）──
// 首次进入返回并记录当前时间，之后返回已存的时间
ipcMain.handle('exam:startTime', () => {
  const progress = loadProgress()
  let startTime = progress._meta?.startTime
  if (!startTime) {
    startTime = Date.now()
    progress._meta = { ...(progress._meta || {}), startTime }
    saveProgress(progress)
  }
  return startTime
})

// 交卷：只有服务端确认 uploaded 才落盘 finished；失败入 pending-finish 队列下次补报
ipcMain.handle('exam:finish', async () => {
  const summary = stopExamMonitoring() || { focusLossCount: 0, violations: [] }

  // 先补旧队列再继续本次上报
  if (sessionToken) {
    try {
      await flushPendingFinish(sessionToken)
    } catch (err) {
      console.error('[交卷] 补报旧队列失败:', err)
    }
  }

  let uploaded = false
  let expired = false
  if (sessionToken) {
    try {
      // 并发：交卷 + 防作弊数据上报
      const [finishResp, behaviorResp] = await Promise.all([
        postFinish(sessionToken),
        postBehavior(sessionToken, summary),
      ])
      if (finishResp.status === 401 || behaviorResp.status === 401) {
        expired = true
        uploaded = false
      } else if (finishResp.status === 403) {
        // 服务端认为已交卷：视为成功，本地锁定（保持原“已交卷”语义）
        uploaded = true
      } else {
        uploaded = finishResp.ok && behaviorResp.ok
      }
      if (!uploaded && !expired) {
        console.error('[交卷] 上报被拒绝:', finishResp.status, behaviorResp.status)
      }
    } catch (err) {
      console.error('[交卷] 无法连接考试服务:', err)
      uploaded = false
    }
  }

  if (expired) {
    // token 过期：snapshot 入队列（含 needsFinish，下次用新 token 重放 finish+behavior），不标记 finished
    queuePendingFinish({ studentId: currentStudentId, time: new Date().toISOString(), summary, needsFinish: true })
    return {
      ok: false,
      error: '登录已过期，请重新登录',
      code: 401,
      ...summary,
    }
  }

  if (uploaded) {
    // 标记已交卷（本地锁定，防再次作答；同时持久化，重启后仍生效）
    finished = true
    {
      const progress = loadProgress()
      progress._meta = { ...(progress._meta || {}), finished: true }
      saveProgress(progress)
    }
  } else {
    // 失败则入统一队列（含 needsFinish），下次 login/finish 先补旧；snapshot 不丢
    queuePendingFinish({ studentId: currentStudentId, time: new Date().toISOString(), summary, needsFinish: true })
  }

  return {
    ok: uploaded,
    ...summary,
  }
})

// ── 防作弊 IPC ──
ipcMain.handle('anticheat:start', (_event, { studentId, studentName }) => {
  startExamMonitoring(studentId, studentName)
  return { ok: true }
})

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock()

// Windows 任务栏归属/图标分组用，与 electron-builder 的 appId 保持一致（其他平台无副作用）
if (process.platform === 'win32') {
  app.setAppUserModelId('com.linexam.app')
}
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  // 关窗不丢数据：若已登录未交卷，写入统一 pending-finish 队列（needsFinish=false，仅补 behavior），
  // 下次 login/finish 经 flushPendingFinish 补报（关窗时无 token 可用则按下次登录 token 补）
  try {
    if (sessionToken && !finished) {
      const snapshot = getBehaviorSummary()
      if (snapshot) {
        queuePendingFinish({
          studentId: currentStudentId,
          time: new Date().toISOString(),
          summary: snapshot,
          needsFinish: false,
        })
      }
    }
  } catch (err) {
    console.error('关窗前保存行为快照失败:', err)
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
