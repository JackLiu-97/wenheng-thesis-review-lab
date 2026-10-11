# 辅助工具

所有命令默认从项目根目录运行。Python 工具是可选功能，平台启动与 `npm test` 不依赖 Python。

## Python 环境

可在本项目创建独立环境并安装工具依赖：

```powershell
uv venv
uv pip install --python .venv/Scripts/python.exe -r scripts/requirements.txt
```

## 生成虚构示例论文

```powershell
.venv/Scripts/python.exe scripts/create_sample.py
```

输出为 `data/samples/` 中的 PDF、页面 PNG 和定位 JSON，均被 Git 忽略。脚本内的论文为虚构演示内容。再次运行会重新生成同名示例文件；真实用户论文应放在其他数据子目录。

## 真实评审流程核查

先生成示例论文并填写根目录 `.env`，再显式运行：

```powershell
npm run audit:live -- --run-live
```

该命令调用配置的 MinerU 和 GPT 服务，可能产生费用；它使用独立的 `data/audit-*` 目录创建测试账号并保存评审、导出及页面核查结果。没有 `--run-live` 时拒绝运行。

## 导出 PriorReview 论文数据（可选）

```powershell
Copy-Item -LiteralPath config/oral-download.env.example -Destination config/oral-download.env
# 在本地配置文件中填写 PostgreSQL 和可选 OpenReview 凭据。
.venv/Scripts/python.exe scripts/export_oral_papers.py --env-file config/oral-download.env --limit 1
```

首次使用先通过 `--help` 查看下载等选项。默认清单位于 `data/oral_papers.json`，论文数据位于 `data/oral_papers/`；已有非空 PDF 默认跳过，除非传入 `--force`。该工具依赖外部 PriorReview 数据库的表结构，与平台自身 JSON 存储相互独立。

真实配置文件 `config/oral-download.env` 及全部输出都被 Git 忽略。