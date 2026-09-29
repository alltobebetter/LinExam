/**
 * 从 build/icon.svg 生成应用图标 PNG 全尺寸集。
 *
 * electron-builder 约定：build/icon.png（≥512×512）作为 Windows/Linux 图标源，
 * 打包时自动转换 ico（含 16~256 多尺寸）；macOS 用 build/icon-mac.png
 * （1024 含内边距）转 icns。本脚本同时输出 build/icons/ 下的常用尺寸副本。
 *
 * 依赖：sharp（SVG 光栅化）。一次性工具，不进 devDependencies，
 * 需要重新生成图标时执行：npm install --no-save sharp && node scripts/gen-icons.js
 *
 * 用法：node scripts/gen-icons.js
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const svgFile = path.join(root, 'build', 'icon.svg')
const outMain = path.join(root, 'build', 'icon.png')
const outDir = path.join(root, 'build', 'icons')
const SIZES = [16, 32, 48, 64, 128, 256, 512]

async function main() {
  let sharp
  try {
    sharp = require('sharp')
  } catch {
    console.error('缺少 sharp：请先执行 npm install --no-save sharp')
    process.exit(1)
  }

  const svg = fs.readFileSync(svgFile)

  // 主图标：512×512（Windows/Linux 打包源；ico 多尺寸由 electron-builder 自动转换）
  await sharp(svg, { density: 384 }) // 高密度光栅化保证 512 边缘锐利
    .resize(512, 512)
    .png()
    .toFile(outMain)
  console.log(`[图标] ${path.relative(root, outMain)} (512×512)`)

  // macOS 专用：Big Sur 起要求图标自带内边距（1024 画布，内容约 82%，与苹果原生应用一致），
  // 否则在程序坞/Launchpad 里会比其他应用显大一圈
  const macOut = path.join(root, 'build', 'icon-mac.png')
  await sharp(svg, { density: 384 })
    .resize(840, 840)
    .extend({ top: 92, bottom: 92, left: 92, right: 92, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(macOut)
  console.log(`[图标] ${path.relative(root, macOut)} (1024×1024 含 macOS 内边距)`)

  // 常用尺寸副本
  fs.mkdirSync(outDir, { recursive: true })
  for (const size of SIZES) {
    const out = path.join(outDir, `icon-${size}.png`)
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(out)
    console.log(`[图标] ${path.relative(root, out)} (${size}×${size})`)
  }
}

main().catch(err => {
  console.error('生成失败:', err)
  process.exit(1)
})
