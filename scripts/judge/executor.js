const { execFile, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ── 编译器配置（考后判卷仅支持 C / Python）──
// 注意：当前无内存限制（Node 无原生手段；Windows 下真正限制需 Job Object，
// 属于重量级沙箱改造，超出本项目范围），仅有时间限制兜底。
const LANG_CONFIG = {
  c: {
    fileName: 'solution.c',
    compileArgs: (compiler) => [compiler, 'solution.c', '-o', 'solution', '-lm'],
  },
  python: {
    fileName: 'solution.py',
    compileArgs: null,
  },
}

// ── 跨平台查找可执行文件 ──
function findExecutable(name) {
  try {
    if (process.platform === 'win32') {
      // Windows: where 命令
      const result = execFileSync('where', [name], { encoding: 'utf-8', timeout: 3000 })
      const lines = result.trim().split('\n')
      return lines[0]?.trim() || null
    } else {
      // Unix-like (macOS/Linux): which 命令
      const result = execFileSync('which', [name], { encoding: 'utf-8', timeout: 3000 })
      return result.trim().split('\n')[0]?.trim() || null
    }
  } catch {
    return null
  }
}

// ── 检测已安装的编译器/解释器 ──
let detectedCompilers = null

function detectCompilers() {
  if (detectedCompilers) return detectedCompilers

  const result = {
    c: null,
    python: null,
  }

  // C: gcc
  result.c = findExecutable('gcc') || findExecutable('cc')

  // Python: python3 or python
  result.python = findExecutable('python3') || findExecutable('python')

  detectedCompilers = result
  console.log('[编译器检测]', JSON.stringify(result))
  return result
}

// ── 执行单个命令（带超时）──
// 统一用手动 setTimeout 超时：Windows 下 taskkill /t 可杀整个进程树，
// 比 execFile 自带的 timeout（仅 SIGTERM 主进程）更可靠，故不再传 timeout 选项。
function execWithTimeout(cmd, args, opts, timeoutMs, stdin) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, {
      ...opts,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,  // 1MB stdout/stderr
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    if (stdin && child.stdin) {
      child.stdin.write(stdin)
      child.stdin.end()
    }

    child.stdout?.on('data', (data) => { stdout += data })
    child.stderr?.on('data', (data) => { stderr += data })

    const settle = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    child.on('error', (err) => {
      settle({ ok: false, stdout, stderr: err.message, timedOut: false, exitCode: -1 })
    })

    child.on('close', (code) => {
      settle({ ok: code === 0, stdout, stderr, timedOut, exitCode: code })
    })

    // 超时控制：Windows 用 taskkill 杀进程树，Unix 用 SIGKILL。
    // 杀进程失败（如权限问题）时也要兜底 resolve，避免判卷流程永久卡死；
    // 残留的孤儿进程由操作系统回收，判卷结果按超时处理。
    setTimeout(() => {
      if (settled) return
      timedOut = true
      try {
        if (process.platform === 'win32') {
          require('child_process').execSync(`taskkill /pid ${child.pid} /f /t`, { stdio: 'ignore' })
        } else {
          child.kill('SIGKILL')
        }
      } catch {}
      // kill 后给 close 事件留一点时间回传已收集的输出；仍未退出则强制结算
      setTimeout(() => {
        settle({ ok: false, stdout, stderr: stderr + '\n[executor] 进程超时且未能终止', timedOut: true, exitCode: -1 })
      }, 2000)
    }, timeoutMs)
  })
}

// ── 核心执行函数 ──
// 内存限制暂不支持（见文件顶部说明）
async function executeCode(language, code, stdin, timeLimitMs) {
  const config = LANG_CONFIG[language]
  if (!config) {
    return { status: 'error', error: `不支持的语言: ${language}` }
  }

  const compilers = detectCompilers()
  const compiler = compilers[language]
  if (!compiler) {
    return { status: 'error', error: `未检测到 ${language} 编译器/解释器` }
  }

  // 创建临时目录
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linexam-'))
  const fileName = config.fileName
  const filePath = path.join(tmpDir, fileName)

  try {
    // 写入源码
    fs.writeFileSync(filePath, code, 'utf-8')

    let compileResult = null

    // 编译步骤（如果需要）
    if (config.compileArgs) {
      const compileArgs = config.compileArgs(compiler)

      compileResult = await execWithTimeout(
        compileArgs[0],
        compileArgs.slice(1),
        { cwd: tmpDir },
        10000,  // 10s 编译超时
        null
      )

      if (!compileResult.ok) {
        return {
          status: 'compile_error',
          error: compileResult.stderr || '编译失败',
          stderr: compileResult.stderr,
        }
      }
    }

    // 运行步骤
    let runCmd, runArgs
    if (language === 'python') {
      runCmd = compiler  // python3 路径
      runArgs = ['solution.py']
    } else {
      // C: 运行编译出的可执行文件
      if (process.platform === 'win32') {
        runCmd = path.join(tmpDir, 'solution.exe')
      } else {
        runCmd = path.join(tmpDir, 'solution')
      }
      runArgs = []
    }

    const runResult = await execWithTimeout(
      runCmd,
      runArgs,
      { cwd: tmpDir },
      timeLimitMs,
      stdin
    )

    return {
      status: runResult.timedOut ? 'timeout' : runResult.ok ? 'success' : 'runtime_error',
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      exitCode: runResult.exitCode,
      timedOut: runResult.timedOut,
    }
  } catch (err) {
    return { status: 'error', error: err.message }
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {}
  }
}

module.exports = { detectCompilers, executeCode }
