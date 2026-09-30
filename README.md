# LinExam

机房编程考试平台（C / Python）：Electron 考试端 + Express 服务端 + 考后统一判卷。

考前防换题，考中防作弊，考后自动判 —— 题是对的，卷是全的，分是准的。

[![Release](https://img.shields.io/github/v/release/alltobebetter/LinExam)](https://github.com/alltobebetter/LinExam/releases)
[![License](https://img.shields.io/github/license/alltobebetter/LinExam)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/alltobebetter/LinExam/releases)

## 下载

学生考试端去 [Releases](https://github.com/alltobebetter/LinExam/releases) 下载对应安装包（Windows `.exe` / macOS `.dmg` / Linux `.AppImage` `.deb`），产品介绍见展示站。

## 特性

- **考试期只收不判**：服务端不执行任何学生代码，只做登录校验、题库下发与代码收集
- **题目指纹校验**：题面登录后下发，客户端用构建时指纹清单逐题重算比对，伪造服务器换题直接拒绝进场
- **切屏行为记录**：离焦超 1 秒记一次切屏，睡眠 / 恢复记为违规，分级随卷上报
- **交卷锁定 + 补报**：服务端落库后强制拦截再提交；弱网下快照入本地队列，下次登录自动补报
- **考后统一判卷**：教师机跑 gcc / Python 逐用例执行，每生每题只取最后一次提交计分

## 架构

- **考试端**（`src/`）：Electron + React，题面展示、代码编辑（Monaco）、提交与交卷，防作弊切屏监控
- **服务端**（`server/`）：Express + SQLite，登录校验、题库下发、代码收集、交卷登记、防作弊数据落库
- **判卷**（`scripts/judge/`）：考后手动运行，`node scripts/judge/grade.js`

## 开发

```bash
npm install
npm run dev:all        # 服务端 + Vite + Electron 三进程
npm run build:win      # 打包 Windows 安装包（build:mac / build:linux 同理）
```

服务端：`cd server && npm install && npm run seed` 写入测试学生后 `npm run dev`。

发版：推 `v*` 标签触发三平台构建，产物自动进 Release 草稿（见 `.github/workflows/build.yml`）。

## 关于题库与用例

仓库内 `server/problems/` 与 `cases/full.example.json` 仅为一套**示例题**。真实考试的题库与判卷用例放在本地忽略目录（`server/problems-local/`、`cases-local/`），程序会自动优先使用本地目录；不存在时回退到示例集。

## 安全设计

- 服务端不执行学生代码，判卷独立在教师机完成
- 交卷后服务端强制拦截再次提交
- 题目指纹本地重算校验，防伪造服务器换题
- 真实名单/用例/标准解均在忽略目录，不入库

## License

[MIT](./LICENSE) —— 字体文件遵循各自许可（见 `src/renderer/assets/fonts/` 内 LICENSE）。
