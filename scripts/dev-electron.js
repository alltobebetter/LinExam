/**
 * Electron 开发启动器
 *
 * 解决 Cursor / VS Code 等基于 Electron 的 IDE 集成终端
 * 会注入 ELECTRON_RUN_AS_NODE=1 环境变量的问题。
 *
 * 该变量会导致 electron.exe 以纯 Node.js 模式运行，
 * require('electron') 只返回路径字符串而非 API 对象，
 * app / BrowserWindow / ipcMain 等全部为 undefined。
 *
 * 本脚本在启动 electron 子进程前删除该变量，确保 Electron
 * 以正常 GUI 主进程模式运行。
 */
const { spawn } = require('child_process')
const electronPath = require('electron')

// 复制环境变量并删除 ELECTRON_RUN_AS_NODE
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// 将 --dev 等额外参数透传给 electron
// 相当于: electron . --dev
const args = ['.', ...process.argv.slice(2)]

const child = spawn(electronPath, args, {
  stdio: 'inherit',
  env,
  shell: false,
})

child.on('close', (code) => process.exit(code ?? 0))
