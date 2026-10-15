# macOS 验证记录

> 本文记录 2026-10-11 的验收，当时数据库为 SQLite。2026-10-15 起已改用 MySQL，见 [数据库说明](database.md) 与 [服务器部署](deployment.md)。

验证日期：2026-10-11（America/Los_Angeles）。本机环境为 Apple Silicon macOS、Node.js 24.12.0、better-sqlite3 12.11.1 和 Playwright 1.64.0 Chromium。

## 检查结果

- `npm run check`：源代码、前端、脚本和测试的 JavaScript 语法检查通过。
- `npm test`：73 项通过，0 失败、0 跳过。
- `./START-MACOS.command --check`：数据库完整性、文件引用、GPT CLI、Poppler、unzip 和 Chromium 自检通过。
- `git diff --check`：通过。

测试覆盖账号隔离、提示词版本、数据库迁移、四类学位与九类学科组合、评分与证据关联、阶段恢复、上下文限制、前端交互和 PDF 导出。Chromium 流程包括上传、标准预览、两阶段评审、重评、原文定位、桌面与手机视口及重复下载 PDF；浏览器检查未发现 JavaScript 错误。

解析与模型流程使用本地 MinerU / DeepSeek 协议替身和固定响应，本次未调用真实付费评审。这些测试验证功能和流程，不代表对模型实际评审质量的评价。

## 数据与运行文件

清理只涉及源代码、文档和运行包装文件，业务数据位于 `data/`，本地配置位于 `.env`。数据库路径迁移功能继续用于移动项目目录，也兼容旧备份中的 Windows 路径；无需 Windows 运行组件。

Windows 启动脚本、打包工具、迁移说明及运行时已移除。页面统一使用 `public/css/theme.css`，已删除不再被页面引用的两个旧样式占位文件。

`.env`、`data/`、`local/`、`runtime/` 和 `node_modules/` 被 Git 忽略。本次整理前的代码备份位于 `local/git-sync-backup-*`；原有数据库和配置备份继续保留。测试日志位于 `local/git-sync-tests.log`，浏览器验证产物位于 `data/ui-verification/`。

## 复查命令

```sh
npm run check
npm test
./START-MACOS.command --check
git diff --check
```

启动方式和依赖安装说明见 [Mac 使用说明](setup-macos.md) 与 [项目 README](../README.md)。Python 报告检查工具的环境配置见 [辅助工具](tools.md)。
