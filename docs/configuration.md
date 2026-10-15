# 服务配置

以下字段以 `src/server.mjs` 当前读取的配置为准。复制根目录 `.env.example` 为 `.env` 后填写；后端按照代码所在位置定位项目根目录，与启动终端的工作目录无关。修改后重启服务。

## 论文解析与模型

| 字段 | 用途 |
| --- | --- |
| `MINERU_TOKEN` | 上传 PDF 进行 MinerU 解析所需的凭据 |
| `MINERU_API_BASE` | 解析服务基础地址，默认 `https://mineru.net/api/v4` |
| `MINERU_MODEL_VERSION` | 解析模型版本，默认 `vlm` |
| `CODEX_API_KEY` | 五个 GPT 模型共用的 API Key |
| `CODEX_BASE_URL` | 支持 Responses 协议的服务基础地址 |
| `REVIEW_CODEX_MODEL` | 默认选择的 GPT 模型，默认 `gpt-6.1-sol`；仍可兼容自定义模型 |
| `REVIEW_CODEX_BIN` | Codex CLI 路径；未设置时依次使用 `CODEX_CLI_PATH` 或 `codex` |
| `DEEPSEEK_API_KEY` | DeepSeek Flash 和 Pro 共用的 API Key，可选 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_FLASH_MODEL` | Flash 对应的 API 模型 ID，默认 `deepseek-flash` |
| `DEEPSEEK_PRO_MODEL` | Pro 对应的 API 模型 ID，默认 `deepseek-v4-pro` |
| `DEEPSEEK_MODEL` | 兼容旧配置，可省略；旧客户端仅提交 deepseek 时使用的默认模型 |

上传与重新评审的下拉框从同一后端模型清单加载：GPT 6.1 Sol、GPT 6 Astra、GPT 6 Sol、GPT 6 Luna、GPT 5.6 Sol、DeepSeek Flash、DeepSeek Pro。GPT 五个选项共用 CODEX_API_KEY／CODEX_BASE_URL；DeepSeek 两个选项共用 DEEPSEEK_API_KEY／DEEPSEEK_BASE_URL。未配置凭据的选项仍可见，提交按钮会禁用；“已配置”表示本地配置齐全，不代表服务商已授权所有模型。

DeepSeek 模型 ID 与 1M 上下文依据 [官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)。若代理使用其他模型别名，可分别修改 FLASH_MODEL 和 PRO_MODEL。任务快照保存模型选择 ID、实际模型 ID、服务地址及预算，数据库 provider 仍为 gpt 或 deepseek，已有评审记录与失败重试继续兼容。

GPT 后端在临时目录创建独立 CLI 配置，通过子进程环境传入 Key，使用 Responses 协议；不修改用户的全局 CLI 配置。DeepSeek 使用 Chat Completions JSON 模式。两种路径均执行六维度详细评审和综合评议两阶段，使用一致的服务端结果校验。

## 本地运行

| 字段 | 用途 |
| --- | --- |
| `REVIEW_PORT` | 默认 `4173` |
| `REVIEW_HOST` | 监听地址，默认 `127.0.0.1`；服务器直接对外时设为 `0.0.0.0` |
| `REVIEW_ALLOWED_HOSTS` | 除 `127.0.0.1`、`localhost` 外允许的访问域名或 IP，逗号分隔；其他 Host 请求返回 403 |
| `REVIEW_DATA_DIR` | 为空时使用项目根目录 `data/`；自定义时建议使用绝对路径 |
| `PDFTOPPM_BIN` | PDF 页面渲染程序，默认 `pdftoppm` |
| `REVIEW_SKIP_ENV` | 测试时设置为 `1`，跳过本地 `.env` 加载 |

数据库为 MySQL，连接配置见下表；表结构与备份见 [数据库说明](database.md)。上传文件在 `data/papers/`，实际提示词和模型输出在 `data/runs/`，PDF 在 `data/reports/`。旧目录通过数据库保留原路径，不要求移动文件。

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| `MYSQL_HOST` | `127.0.0.1` | MySQL 地址 |
| `MYSQL_PORT` | `3306` | MySQL 端口 |
| `MYSQL_USER` | `wenheng` | 平台账号；需对 `MYSQL_DATABASE` 有全部权限，运行测试还需能创建 `wenheng_test_*` 库 |
| `MYSQL_PASSWORD` | 空 | 平台账号密码 |
| `MYSQL_DATABASE` | `wenheng` | 数据库名；账号有权限时启动自动创建 |

队列按单任务串行处理，任务、阶段检查点和提交快照持久化。重启自动恢复排队任务，运行中的任务标记中断，等待手动重试。原有本地 `.env` 不会被升级覆盖；旧的 `REVIEW_DATABASE_PATH`、`DATABASE_PATH` 已不再使用。

## 提示词与访问边界

`src/prompts.mjs` 维护统一开头、输出规范和拼接函数。各账号六个维度的评审提示词在数据库中单独版本化，保存接口检查 `base_version`，冲突返回 409。提交任务时冻结所选版本（默认最新）的快照，每次实际运行保存完整 `prompt.txt`，后续修改不会改变旧记录。

静态服务只返回白名单内的 `public/` 文件。后端源代码、配置、数据与本地备份不作为静态资源提供。论文和报告通过检查账号归属的 API 读取。

## 上下文与报告运行时

GPT-6.1 Sol 的默认窗口按 [官方模型规格](https://developers.openai.com/api/docs/models/gpt-6.1-sol) 设置为 1,050,000 tokens。128,000 是该模型最大输出量，不是上下文窗口；平台仍预留 12,000 输出预算。修改 `.env` 中的模型、地址、上下文或输出预算并重启后，对失败任务点击重试会建立关联的新任务：保留原快照、评审标准和提示词，使用当前模型配置，复用解析结果，同一模型已完成的阶段不重复调用。配置未变时，重试在原任务上从已完成阶段继续。

| 字段 | 默认 | 用途 |
| --- | --- | --- |
| REVIEW_CODEX_CONTEXT_TOKENS | 五个内置 GPT 模型为 1050000；自定义模型为 128000 | GPT 路径上下文预算；显式配置可覆盖默认值 |
| REVIEW_CODEX_OUTPUT_TOKENS | 12000 | GPT 输出预留，用于完整输入检查 |
| DEEPSEEK_CONTEXT_TOKENS | Flash／Pro 为 1000000；自定义模型为 128000 | DeepSeek 路径上下文预算；显式配置可覆盖默认值 |
| DEEPSEEK_OUTPUT_TOKENS | 12000 | DeepSeek 输出预留及 max_tokens |
| REVIEW_NODE_BIN | 自动探测 | npm 启动器使用的 Node 24 可执行文件；需作为进程环境变量设置 |

输入检查使用 UTF-8 字节数加协议预留作为保守 token 上界，不是精确 tokenizer。长论文超限会保留文件和解析，提示调整配置或改用更大窗口模型；不会静默截断。GPT CLI 的实际输出上限仍由所配置模型服务决定，输出预算字段用于输入检查。

PDF 依赖项目的 Playwright Chromium（`npx playwright install chromium`），字体从 assets/fonts 本地读取。浏览器不加载远程资源。PDF 失败可以单独重试，不会再次调用模型。
