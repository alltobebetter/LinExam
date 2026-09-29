const { powerMonitor } = require('electron')

// 切屏判定的最短离焦时长（毫秒）：输入法切换、通知弹窗、截图等瞬时分焦不误报，
// 只有真正离开窗口超过阈值的才算一次切屏（业界监考类软件的通行做法）。
const MIN_FOCUS_LOSS_MS = 1000

// ── 考试行为记录 ──
let examRecord = null
let focusLossCount = 0
let isMonitoring = false
let blurTime = 0   // 当前离焦开始时间（0 = 未离焦）

/**
 * 初始化考试行为记录
 */
function startExamMonitoring(studentId, studentName) {
  examRecord = {
    studentId,
    studentName,
    startTime: Date.now(),
    endTime: null,
    focusLossEvents: [],   // 切屏记录（仅记录超过阈值的）
    violations: [],        // 违规记录
  }
  focusLossCount = 0
  blurTime = 0
  isMonitoring = true
  console.log('[防作弊] 开始监控考试行为')
}

/**
 * 停止监控，返回含分级（level）的行为摘要（交卷时由主进程上报给服务端）
 */
function stopExamMonitoring() {
  if (!examRecord) return null
  isMonitoring = false
  examRecord.endTime = Date.now()
  console.log('[防作弊] 停止监控，切屏次数:', focusLossCount)
  return getBehaviorSummary()
}

/**
 * 绑定窗口事件（在 createWindow 后调用）
 */
function bindWindowEvents(mainWindow) {
  // 窗口失焦：只记录时间，不计次（等回焦时按时长判定）
  mainWindow.on('blur', () => {
    if (!isMonitoring || !examRecord) return
    blurTime = Date.now()
  })

  // 窗口获焦：离焦时长超过阈值才计为一次切屏
  mainWindow.on('focus', () => {
    if (!isMonitoring || !examRecord) return
    if (blurTime > 0) {
      const duration = Date.now() - blurTime
      blurTime = 0
      if (duration >= MIN_FOCUS_LOSS_MS) {
        focusLossCount++
        examRecord.focusLossEvents.push({
          time: Date.now(),
          duration,
        })
        console.log(`[防作弊] 切屏 #${focusLossCount}（离焦 ${(duration / 1000).toFixed(1)}s）`)
      }
    }
  })

  // 系统级：电源事件（睡眠/唤醒）
  powerMonitor.on('resume', () => {
    if (!isMonitoring || !examRecord) return
    examRecord.violations.push({
      time: Date.now(),
      type: 'system_resume',
      message: '系统从睡眠中恢复',
    })
  })

  powerMonitor.on('suspend', () => {
    if (!isMonitoring || !examRecord) return
    examRecord.violations.push({
      time: Date.now(),
      type: 'system_suspend',
      message: '系统进入睡眠',
    })
  })
}

/**
 * 计算当前行为摘要（内部使用；交卷上报与分级判定均由此产出）
 */
function getBehaviorSummary() {
  if (!examRecord) return null

  let level = 'normal'  // normal / warning / serious
  if (focusLossCount > 10) {
    level = 'serious'
  } else if (focusLossCount > 3) {
    level = 'warning'
  }

  return {
    focusLossCount,
    focusLossEvents: examRecord.focusLossEvents,
    violations: examRecord.violations,
    duration: Date.now() - examRecord.startTime,
    level,
  }
}

module.exports = {
  startExamMonitoring,
  stopExamMonitoring,
  bindWindowEvents,
}
