const { app, BrowserWindow, shell, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { startExamMonitoring, stopExamMonitoring, bindWindowEvents } = require('./anticheat')
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
let finished = false

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
 * 归一化并校验用户输入的服务器地址。
 * 只接受 http/https，去掉尾部斜杠；非法输入返回 null。
 */
function normalizeServerUrl(input) {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return withScheme.replace(/\/+$/, '')
  } catch {
    return null
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
    return { ok: false, error: '服务器地址格式不正确，应为 http://IP:端口' }
  }
  serverUrl = normalized

  try {
    const resp = await fetch(`${serverUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, studentId }),
    })
    const data = await resp.json()

    if (!resp.ok) {
      return { ok: false, error: data.error || '登录失败' }
    }

    // ── 题库下发 + 指纹校验（不通过则拒绝进入考试）──
    let fetchedProblems
    try {
      const pResp = await fetch(`${serverUrl}/api/problems`, {
        headers: { Authorization: `Bearer ${data.token}` },
      })
      if (!pResp.ok) {
        return { ok: false, error: '题库获取失败，请联系监考老师' }
      }
      const pData = await pResp.json()
      const verdict = verifyFetchedProblems(pData.problems)
      if (!verdict.ok) {
        console.error('[题库校验失败]', verdict.error)
        return { ok: false, error: verdict.error }
      }
      fetchedProblems = pData.problems
    } catch (err) {
      console.error('[题库获取失败]', err)
      return { ok: false, error: '题库获取失败，请检查网络后重试' }
    }

    sessionToken = data.token
    sessionLanguage = data.language === 'python' ? 'python' : 'c'
    sessionProblems = fetchedProblems

    // ── 按学生重置/延续考试状态 ──
    // 同一学生重新登录（如客户端崩溃重启）：保留代码进度，仅重置计时器；
    // 换学生登录（如机器流转给下一位考生）：清空上一人的代码/进度/提交记录，避免泄露与串卷。
    resetExamStateFor(data.studentId)

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

// ── 考试进度持久化（每题代码/是否看过）──
// 统一存 userData/exam-progress.json，key = problemId；
// _meta.studentId 记录进度归属，换人登录时整份重置。
function loadProgress() {
  try {
    const file = path.join(app.getPath('userData'), 'exam-progress.json')
    return JSON.parse(fs.readFileSync(file, 'utf-8')) || {}
  } catch {
    return {}
  }
}

function saveProgress(progress) {
  try {
    const file = path.join(app.getPath('userData'), 'exam-progress.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(progress, null, 2), 'utf-8')
  } catch (err) {
    console.error('保存考试进度失败:', err)
  }
}

/**
 * 登录时按学生重置考试状态。
 * - 同一学生：保留代码进度（崩溃恢复），重置考试开始时间；已交卷则本地锁定。
 * - 不同学生：清空进度与提交记录，计时器归零。
 */
function resetExamStateFor(studentId) {
  const progress = loadProgress()
  const meta = progress._meta || {}

  if (meta.studentId && meta.studentId !== studentId) {
    // 换人：全部清空，并立即写入新学生的归属标记，
    // 防止「换人做题→重启→第三人登录」时被误判为同一学生而串卷
    try {
      fs.rmSync(path.join(app.getPath('userData'), 'exam-progress.json'), { force: true })
      fs.rmSync(path.join(app.getPath('userData'), 'submissions.json'), { force: true })
    } catch (err) {
      console.error('重置考试状态失败:', err)
    }
    finished = false
    saveProgress({ _meta: { studentId, startTime: Date.now() } })
    console.log(`[登录] 检测到学生切换（${meta.studentId} → ${studentId}），已重置考试状态`)
    return
  }

  // 同一学生：保留进度，重置计时器（旧的 startTime 可能属于上一场考试）
  finished = !!meta.finished
  progress._meta = { ...meta, studentId, startTime: Date.now(), finished: finished || undefined }
  saveProgress(progress)

  if (finished) {
    // 已交卷的学生重新登录：同步本地锁，防止继续作答
    console.log('[登录] 该学生已交卷，本地保持锁定')
  }
}

// ── 代码提交 IPC（纯提交：不判题，只上报代码，考后统一判卷）──
function loadSubmissions() {
  try {
    const file = path.join(app.getPath('userData'), 'submissions.json')
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return []
  }
}

function saveSubmissions(list) {
  try {
    const file = path.join(app.getPath('userData'), 'submissions.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf-8')
  } catch (err) {
    console.error('保存提交记录失败:', err)
  }
}

function postCode({ problemId, title, code }) {
  if (!sessionToken) return
  return fetch(`${serverUrl}/api/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ problemId, title, code }),
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
      console.error('[提交] 代码上报被拒绝:', resp?.status, await resp?.text().catch(() => ''))
      return { error: '提交失败，请稍后重试' }
    }
  } catch (err) {
    console.error('[提交] 无法连接考试服务:', err)
    return { error: '无法连接考试服务，请稍后重试' }
  }

  // 标记看过
  const progress = loadProgress()
  progress[problemId] = {
    ...(progress[problemId] || {}),
    viewed: true,
  }
  saveProgress(progress)

  // 上报成功后才本地保存
  const list = loadSubmissions()
  list.push({
    problemId, language, code,
    time: new Date().toISOString(),
  })
  saveSubmissions(list)

  return { ok: true }
})

// ── 提交记录 IPC（本地持久化）──
ipcMain.handle('submission:list', (_event, problemId) => {
  let result = loadSubmissions()
  if (problemId) {
    result = result.filter(s => s.problemId === problemId)
  }
  return result.slice(-50).reverse()
})

// ── 考试进度 IPC ──
// 保存某题进度（代码/是否看过）
ipcMain.handle('progress:save', (_event, { problemId, code, viewed }) => {
  const progress = loadProgress()
  const entry = progress[problemId] || {}
  if (code !== undefined) entry.code = code
  if (viewed !== undefined) entry.viewed = viewed
  progress[problemId] = entry
  saveProgress(progress)
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

// ── 交卷 IPC（上报交卷 + 防作弊数据）──
ipcMain.handle('exam:finish', async () => {
  const summary = stopExamMonitoring() || { focusLossCount: 0, violations: [] }

  // 标记已交卷（本地锁定，防再次作答；同时持久化，重启后仍生效）
  finished = true
  {
    const progress = loadProgress()
    progress._meta = { ...(progress._meta || {}), finished: true }
    saveProgress(progress)
  }

  let uploaded = false
  if (sessionToken) {
    try {
      // 并发：交卷 + 防作弊数据上报
      const [finishResp, behaviorResp] = await Promise.all([
        fetch(`${serverUrl}/api/finish`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
        }),
        fetch(`${serverUrl}/api/behavior`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            focusLossCount: summary.focusLossCount || 0,
            violations: summary.violations || [],
            duration: summary.duration || 0,
            level: summary.level || 'normal',
          }),
        }),
      ])
      uploaded = finishResp.ok && behaviorResp.ok
    } catch (err) {
      console.error('[交卷] 无法连接考试服务:', err)
      uploaded = false
    }
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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
