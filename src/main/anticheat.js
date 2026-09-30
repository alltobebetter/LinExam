const { powerMonitor } = require('electron')

// 切屏阈值：瞬时分焦（输入法/通知）不计，离焦超 1s 才算切屏
const MIN_FOCUS_LOSS_MS = 1000

let examRecord = null
let focusLossCount = 0
let isMonitoring = false
let blurTime = 0
let powerMonitorBound = false

function active() {
  return isMonitoring && examRecord
}

function recordViolation(type, message) {
  if (!active()) return
  examRecord.violations.push({ time: Date.now(), type, message })
}

/**
 * 初始化考试行为记录
 */
function startExamMonitoring(studentId, studentName) {
  // 同人重复启动忽略；换人则重置（login 未交卷切账号时旧记录不再归属新人）
  if (isMonitoring && examRecord) {
    if (examRecord.studentId === studentId) {
      console.log('[防作弊] 已在监控，忽略重复启动')
      return
    }
  }
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
  // 失焦只记时间，结算统一在 focus，避免一次离席记两次
  mainWindow.on('blur', () => {
    if (!active() || blurTime > 0) return
    blurTime = Date.now()
  })

  // 获焦时按离焦时长判定切屏
  mainWindow.on('focus', () => {
    if (!active()) return
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

  // 电源事件全局只绑一次
  if (!powerMonitorBound) {
    powerMonitorBound = true
    powerMonitor.on('resume', () => recordViolation('system_resume', '系统从睡眠中恢复'))
    powerMonitor.on('suspend', () => recordViolation('system_suspend', '系统进入睡眠'))
  }
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
    duration: (examRecord.endTime || Date.now()) - examRecord.startTime,
    level,
  }
}

module.exports = {
  startExamMonitoring,
  stopExamMonitoring,
  bindWindowEvents,
  getBehaviorSummary,
}
