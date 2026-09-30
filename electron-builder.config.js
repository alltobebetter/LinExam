/**
 * electron-builder 配置
 * 文档: https://www.electron.build/
 */
module.exports = {
  appId: 'com.linexam.app',
  productName: 'LinExam',
  copyright: 'Copyright © 2026 LinExam',

  // 源文件目录
  directories: {
    output: 'dist',
    buildResources: 'build',
  },

  // 需要打包的文件（renderer 只需构建产物，无需源码）
  files: [
    'src/main/**/*',
    'src/renderer/dist/**/*',
    'package.json',
  ],

  // ===== Windows 配置 =====
  win: {
    target: ['nsis'],
    // 统一用 icon.png，electron-builder 打包时自动转换 ico
    icon: 'build/icon.png',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'LinExam',
  },

  // ===== macOS 配置 =====
  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    // macOS 要求图标自带内边距（Big Sur 规范），用带边距的专用变体转 icns
    icon: 'build/icon-mac.png',
    category: 'public.app-category.education',
    // 后续配置代码签名时启用
    // identity: "YOUR_APPLE_ID",
    // notarize: true,
  },
  dmg: {
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },

  // ===== Linux 配置 =====
  linux: {
    target: ['AppImage', 'deb'],
    icon: 'build/icon.png',
    category: 'Education',
  },
}
