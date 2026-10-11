# 升级验收记录

验收日期：2026-10-11（北京时间）。环境：Windows、项目启动器选择 Node 24.19.0、better-sqlite3 12.11.1、Playwright 1.64.0 Chromium。未修改系统全局 Node，也未修改真实服务凭据。

## 自动化与浏览器

- `npm test`：66 项全部通过，0 失败、0 跳过。保留原有账号、提示词和 DOM 测试，并增加 SQLite、迁移、评分、证据归属、阶段重试、报告及参数测试。
- `npm run check`：所有源代码、前端、脚本和测试的 JavaScript 语法检查通过。
- 最终 PDF 打印样式调整后，单独重跑 `node --test tests/http-workflow.test.mjs`：浏览器完整流程及 PDF 下载通过。
- `git diff --check`：通过；Windows 行尾提示不影响检查结果。
- 四类学位 × 九类学科共 36 种标准组合通过。包括整数分校验、分数边界、权重、重大问题、关键维度低分、材料不足及长上下文拒绝。
- HTTP 端到端测试通过真实 Chromium 操作注册、上传背景、标准预览、两阶段任务、结果评分、PDF 下载和修订稿流程。本项使用本地 MinerU／DeepSeek 协议替身与固定响应，不代表真实 DeepSeek 服务验收。
- 桌面和 390px 手机视口截图已检查：上传必填项、评分、模型选择、原文页面与证据高亮可见，无横向溢出。截图保存在 `data/ui-verification/`。

## 实际旧数据迁移与备份

已运行带预检的迁移命令，并把实际 `data/store.json` 迁入 `data/review.sqlite3`。源 JSON 保留，备份为 `data/store.json.before-sqlite-1791688316268.bak`。

源记录：1 个用户、1 条旧任务记录、5 次评审、101 条意见、423 条意见与证据关联。未发现缺失论文文件。完整迁移报告为 `data/review.sqlite3.migration-report.json`。

新数据库按每次结果关联任务的结构保存 5 条任务和 5 次结果；旧任务与运行 ID 保留，不按文件名合并论文。旧记录没有的学位、专业和评分不补造。

执行：

```powershell
npm run backup -- --database data/review.sqlite3 --target data/backup-verification-20261011
```

备份包含一致 SQLite 快照及 5 个关联文件，缺失数 0。原数据库和备份均通过 `PRAGMA integrity_check`（ok）与 `PRAGMA foreign_key_check`（0 条错误）；用户、任务、结果、意见和证据关联数量一致。完整解析附件与调用原始文件的归档方式见 [数据库说明](database.md)。

## 真实解析与模型链路

`npm run audit:live -- --run-live` 使用独立数据目录和虚构论文调用真实 MinerU 与已配置的 GPT 路径。记录位于 `data/audit-2026-10-11T03-04-36-991Z/audit-report.json`。

| 项目 | 结果 |
| --- | --- |
| 真实解析 | 3 页、43 个文本块 |
| 首次两阶段评审 | gpt-6.1-sol；14 条意见、30 条证据关联；49.5 分 |
| 编辑补充重点后重评 | gpt-6.1-sol；11 条意见、23 条证据关联；55.3 分 |
| 提示词快照与解析复用 | 通过；原评审快照保留 |
| 首次 PDF／HTML／JSON 导出 | 通过 |
| DeepSeek 真实服务 | 未执行：未配置凭据或模型；没有用其他服务替代 |

模型链路运行后，PDF 字体和打印样式继续做了修正；两个已保存的真实结果通过 `reports:generate` 离线重新生成最终 `report-v2.5`，没有为排版再次调用模型。第二次评审的最终 PDF 通过离线生成验证；最初实时审计没有等待该次 PDF，审计脚本现已补上等待与下载检查。

真实核查仅覆盖上述短篇虚构论文及一次重评。解析器随后完善了表格正文、图注与脚注提取，该部分通过协议固定数据测试，未再发起真实解析。当前测试不证明模型评分与学校专家评价等价，也不构成长篇论文质量评测。

## PDF 验收

执行：

```powershell
npm run reports:samples
uv run --project E:\Codex-env python scripts/verify_reports.py
uv run --project E:\Codex-env python scripts/verify_reports.py data/verification-reports
pdffonts data/report-samples/synthetic-academic_master.pdf
```

四份固定响应报告分别覆盖学硕、专硕、学博和专博；分数为 82.6、76.5、64.4、86.5，不能当作真实学位论文的模型评价。前三份分别为 6 页；专博长意见样例为 7 页。JSON、HTML、提示词与 PDF 一同保存在 `data/report-samples/`。

两份真实模型结果报告最终分别为 11 页和 10 页，核验副本在 `data/verification-reports/`。

全部报告经 pdfinfo 检查、pdfplumber 文本提取和页边界检查、pdftoppm 全页渲染与逐页联系表检查。包含中文、长意见自然跨页、评分表重复表头、证据页码、页眉页脚及追溯信息；未发现乱码、文字裁切、表格重叠或完全空白页。短证据摘录与标题保持在一起；追溯附录保持整体，末页可有正常留白。页面 PNG、提取文本和机器检查结果保存在各目录的 `qa/` 和 `qa-report.json`。

中文字体使用本地 Noto Sans SC 静态 Regular／Bold，许可随项目保存；pdffonts 确认嵌入、子集和 Unicode 映射。PDF 不加载远程资源，正文可选择和搜索。

## 尚需外部条件的验收

真实 DeepSeek 链路需要配置 `DEEPSEEK_API_KEY` 与实际模型后再执行 live audit。当前功能实现、固定响应流程和错误处理测试已完成，真实服务结果仍待核验。


## 2026-10-11 模型选择扩展

新增 GPT 6.1 Sol、GPT 6 Astra、GPT 6 Sol、GPT 6 Luna、GPT 5.6 Sol、DeepSeek Flash、DeepSeek Pro。GPT 统一读取 CODEX_API_KEY／CODEX_BASE_URL，DeepSeek 统一读取 DEEPSEEK_API_KEY／DEEPSEEK_BASE_URL；公开模型接口仅返回模型元数据与配置状态，不返回密钥。

模型扩展后 `npm test` 为 71 项通过，`npm run check` 通过。新增模型清单、配置继承、旧模型兼容、Flash／Pro 请求中的模型和 Key 路由测试；后续单独运行的 Chromium HTTP 测试覆盖七个选项、Flash 两阶段评审、Pro 两阶段重评和历史模型回显。全部使用固定响应，没有为验证新增模型调用真实付费服务。

## Windows 迁移与提交前复核

加入数据库路径修复测试后，最终 `npm test`：72 项通过，0 失败、0 跳过；`npm run check` 和 `git diff --check` 通过。便携包完成异目录解压和文件 SHA-256 核对，15 处关联路径修复成功；5 次历史评审和原论文可读取，7 个模型选项、页面预览及 PDF 生成通过。测试未调用付费模型。

Git 仅提交代码、配置模板、字体许可、测试和文档；真实 `.env`、数据库、论文、报告及私人迁移包仍由忽略规则保护。
