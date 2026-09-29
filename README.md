# LinExam

编程考试平台（C / Python）：Electron 考试端 + Express 服务端 + 考后统一判卷。

## 架构

- **客户端**（`src/`）：Electron + React，题面展示、代码编辑（Monaco）、提交与交卷，防作弊切屏监控。题面由服务端登录后下发，客户端本地只持指纹清单校验，防止指向伪造服务器。
- **服务端**（`server/`）：Express + SQLite，登录校验、题库下发、代码收集、交卷登记、防作弊数据落库。考试期间不执行任何学生代码。
- **判卷**（`scripts/judge/`）：考后手动运行，gcc/Python 执行提交代码并按测试用例计分，每生每题以最后一次提交为准。

## 开发

```bash
npm install
npm run dev:all        # 服务端 + Vite + Electron 三进程
npm run build:win      # 打包 Windows 安装包（build:mac / build:linux 同理）
```

服务端：`cd server && npm install && npm run seed` 写入测试学生后 `npm run dev`。

## 关于题库与用例

仓库内 `server/problems/` 与 `cases/full.example.json` 仅为一套**示例题**。真实考试的题库与判卷用例放在本地忽略目录（`server/problems-local/`、`cases-local/`），程序会自动优先使用本地目录；不存在时回退到示例集。

## 安全设计

- 服务端不执行学生代码，判卷独立在教师机完成
- 交卷后服务端强制拦截再次提交
- 题目指纹本地重算校验，防伪造服务器换题
- 数据库不入库，真实名单/用例/标准解均在忽略目录
