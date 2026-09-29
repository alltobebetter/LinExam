const { contextBridge, ipcRenderer } = require('electron')

// 通过 contextBridge 安全地暴露 API 给渲染进程
contextBridge.exposeInMainWorld('exampower', {
  // ── 窗口控制 ──
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximizedChange: (cb) => {
    const listener = (_e, isMax) => cb(isMax)
    ipcRenderer.on('window:maximized-change', listener)
    return () => ipcRenderer.removeListener('window:maximized-change', listener)
  },

  // ── 登录（在线验证 + 题库下发校验；serverUrl 来自登录页，localStorage 记忆） ──
  login: (name, studentId, serverUrl) =>
    ipcRenderer.invoke('auth:login', { name, studentId, serverUrl }),

  // ── 题库（登录时服务端下发，主进程缓存） ──
  getProblemList: () => ipcRenderer.invoke('problem:list'),
  getProblem: (id) => ipcRenderer.invoke('problem:get', id),

  // ── 代码提交（纯提交，不判题；语言由登录会话绑定）──
  submitCode: (problemId, code) =>
    ipcRenderer.invoke('code:submit', { problemId, code }),

  // ── 提交记录（本地持久化） ──
  getSubmissions: (problemId) =>
    ipcRenderer.invoke('submission:list', problemId),

  // ── 考试进度（本地持久化） ──
  saveProgress: (problemId, code, viewed) =>
    ipcRenderer.invoke('progress:save', { problemId, code, viewed }),
  getExamStartTime: () => ipcRenderer.invoke('exam:startTime'),
  getProgress: () => ipcRenderer.invoke('progress:get'),

  // ── 考试语言（登录时由后端绑定，不可切换）──
  getLanguage: () => ipcRenderer.invoke('exam:language'),

  // ── 交卷（兜底上报 + 防作弊摘要） ──
  finishExam: () => ipcRenderer.invoke('exam:finish'),

  // ── 防作弊（登录时启动监控；交卷时由主进程自动上报，无需渲染层查询）──
  startMonitoring: (studentId, studentName) =>
    ipcRenderer.invoke('anticheat:start', { studentId, studentName }),
})
