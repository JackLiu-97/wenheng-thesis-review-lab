# 升级、运行和验收

## Node 与依赖

平台运行在 Node.js 24。npm 脚本通过 scripts/run.mjs 选择 REVIEW_NODE_BIN、当前 Node 或 Codex 独立 Node 24 运行时，不修改全局 Node 安装。本机使用 nvm 安装的 Node 24。新机器应先安装 Node 24，再执行：

```sh
npm ci
npx playwright install chromium
npm run check
npm test
npm run migrate -- --dry-run
npm start
```

安装依赖的 npm 也应由 Node 24 运行；请先用 `node --version` 和 `npm version` 确认。已经安装依赖的本机可以直接 `npm start`，启动器会选择可用 Node 24。

页面仍为 http://127.0.0.1:4173/。保留原账号密码；首次升级会安全迁移旧 JSON。详细表结构、备份和恢复见 [数据库说明](database.md)。

## 使用变化

上传时填写学位、学科、专业及完成年月。批量上传可展开每篇论文的参数覆盖区，留空的字段继承公共参数；提交前逐篇校验。可先预览实际生效的标准和提示词。

结果页展示总体评分、等级、建议、维度分数、评分依据和原文证据。重评参数默认继承当前记录；“上传此论文的修订稿”关联到同一论文的新文件版本。修改元数据后重评同一文件复用解析，不产生新文件版本。

评审完成后自动生成 PDF。若渲染失败，可单独重试。历史记录也可以直接生成 PDF，但不会补造原来不存在的分数和结论。下载已生成的 PDF 不调用模型。

## 报告和验证命令

```sh
npm run reports:samples
uv run python scripts/verify_reports.py
npm run reports:generate -- --database data/review.sqlite3 --run <记录ID>
```

四类虚构报告位于 data/report-samples，包括 JSON、HTML、提示词和 PDF。verify_reports.py 使用 pdfinfo、pdfplumber、Pillow 和 pdftoppm 检查文本、页边界并生成所有页面 PNG 与联系表，仍需人工检查版式。Python 仅用于这些辅助工具，不是平台运行依赖。其他机器可使用项目自己的 Python 环境安装 scripts/requirements.txt。

自动化测试包括原有账号、DOM 和提示词行为，以及 SQLite 迁移、36 种标准组合、分数边界、错误输出、证据归属、失败重试和真实 Chromium 浏览器流程。HTTP 浏览器测试使用本地固定模型响应与 MinerU 协议替身，不调用付费服务；截图和 PDF 位于 data/ui-verification。

真实服务检查只使用虚构论文，运行于独立数据目录：

```sh
npm run audit:live -- --run-live
```

该命令会调用已配置的真实解析与模型服务，保存审计结果。没有配置的模型明确记录 blocked，不使用其他模型冒充；有配置的其他模型通过复用解析结果进行独立评审。每个成功运行同时检查 PDF 导出。

## 兼容与限制

- 旧 GET /api/runs/:id/export 默认仍返回 HTML；PDF 明确使用 format=pdf，JSON 使用 format=json。
- 新任务必须有完整背景参数。旧记录重评前需要补齐参数。
- 参数、评分和标准均由服务端再次验证，页面限制不是唯一约束。
- 学科大类是平台分类；没有学校专属模板、外部文献检索或自动分章长文评审。
- MinerU 解压依赖系统 `unzip`，页面渲染依赖 Poppler。本机组件在 `runtime/macos/poppler/`；该目录被 Git 忽略，新机器需另行安装或配置 Poppler。
- 模型结果具有随机性；标准测试和固定响应测试验证的是规则与流程，不证明自动评分等价于人类评委判断。
