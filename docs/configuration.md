# 服务配置

以下字段以 `src/server.mjs` 当前读取的配置为准。复制根目录 `.env.example` 为 `.env` 后填写；后端按照代码所在位置定位项目根目录，与启动终端的工作目录无关。修改后重启服务。

## 论文解析与模型

| 字段 | 用途 |
| --- | --- |
| `MINERU_TOKEN` | 上传 PDF 进行 MinerU 解析所需的凭据 |
| `MINERU_API_BASE` | 解析服务基础地址，默认 `https://mineru.net/api/v4` |
| `MINERU_MODEL_VERSION` | 解析模型版本，默认 `vlm` |
| `CODEX_API_KEY` | GPT 评审服务的 API Key |
| `CODEX_BASE_URL` | 支持 Responses 协议的服务基础地址 |
| `REVIEW_CODEX_MODEL` | 服务商实际支持的模型 ID，不预设模型名 |
| `REVIEW_CODEX_BIN` | Codex CLI 路径；未设置时依次使用 `CODEX_CLI_PATH` 或 `codex` |
| `DEEPSEEK_API_KEY` | DeepSeek API Key，可选 |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | DeepSeek 服务实际支持的模型 ID |

GPT 后端在临时目录创建独立 CLI 配置，通过子进程环境传入 Key，使用 Responses 协议；不修改用户的全局 CLI 配置。DeepSeek 使用 Chat Completions JSON 模式。两种路径都把六个评审维度合并为一次模型请求。

## 本地运行

| 字段 | 用途 |
| --- | --- |
| `REVIEW_PORT` | 默认 `4173`，只监听 `127.0.0.1` |
| `REVIEW_DATA_DIR` | 为空时使用项目根目录 `data/`；自定义时建议使用绝对路径 |
| `PDFTOPPM_BIN` | PDF 页面渲染程序，默认 `pdftoppm` |
| `REVIEW_SKIP_ENV` | 测试时设置为 `1`，跳过本地 `.env` 加载 |

当前存储为 JSON 文件 `data/store.json`，并非 SQLite。上传论文、解析缓存、页面图片及完整提示词位于 `data/runs/`。运行数据和账号信息全部属于本地私有文件。

队列按单任务串行处理。旧模板中的 `DATABASE_PATH`、`REVIEW_MAX_CONCURRENCY`、`REVIEW_TIMEOUT_SECONDS`、`REVIEW_CODEX_PROFILE` 等字段当前没有对应读取逻辑，因此已从示例中移除；原有本地 `.env` 原样保留。

## 提示词与访问边界

`src/prompts.mjs` 维护统一开头、输出规范和拼接函数。各账号六个维度的重点在存储中单独版本化，保存接口检查 `base_version`，冲突返回 409。提交任务时冻结最新快照，每次实际运行保存完整 `prompt.txt`，后续修改不会改变旧记录。

静态服务只返回白名单内的 `public/` 文件。后端源代码、配置、数据与本地备份不作为静态资源提供。论文和报告通过检查账号归属的 API 读取。