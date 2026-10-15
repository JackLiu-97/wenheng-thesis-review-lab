# 在这台 Mac 上使用

此项目运行在 Apple Silicon macOS 上。账号、论文、评审记录和服务凭据沿用原数据。

## 启动和停止

在 Finder 中双击项目根目录的 `START-MACOS.command`。启动器先连接 MySQL（未启动时会提示），检查数据库与文件引用，在终端启动服务，并自动打开 <http://127.0.0.1:4173/>。

使用原有账号和密码登录。保持启动的终端窗口打开；停止时在该窗口按 `Control+C`。如果提示端口被占用，先检查是否已经有一个文衡窗口在运行。

终端启动也可以在项目目录执行：

```sh
./START-MACOS.command
```

只做本地自检：

```sh
./START-MACOS.command --check
```

也可使用 `npm start`；它直接启动后端，不会自动打开浏览器或处理移动目录后的路径迁移。

## 本机环境

- Node.js 24：使用本机 nvm 安装；双击启动脚本会自动寻找 Node 24。
- MySQL：Homebrew 安装的 MySQL，平台账号为 `wenheng`，连接配置在 `.env` 的 `MYSQL_*`。电脑重启后需先启动 MySQL（`brew services start mysql` 可设为开机自启）。
- Playwright Chromium：已安装 macOS ARM64 浏览器，用于报告 PDF 和浏览器测试。
- Poppler：本机使用 `runtime/macos/poppler/` 中的组件。该目录不上传 Git；从仓库获取项目后需安装 Poppler 或配置 `PDFTOPPM_BIN`。
- GPT CLI：`.env` 的 `REVIEW_CODEX_BIN` 指向本机已安装的程序。
- MinerU ZIP 结果：使用系统 `unzip`。

`.env` 中的解析和模型服务凭据保持原值；修改配置后重启。真实评审仍取决于对应服务的网络、额度和模型权限。

## 数据和备份

业务数据库是本机 MySQL 的 `wenheng` 库；原 SQLite 数据（`data/review.sqlite3`）已通过 `npm run import:sqlite` 导入，原文件保留未改动。论文、解析结果与报告仍在 `data/`。启动器每次启动都会根据数据库中记录的项目根目录检查并修正文件引用，因此移动整个项目文件夹后仍可直接启动。

如需移动整个项目，先停止服务，再完整移动项目，最后使用 `START-MACOS.command` 启动，它会重新定位数据库中的文件路径。备份见 [数据库说明](database.md)。

原 Windows 便携包的启动脚本、运行组件和迁移说明已移除。`scripts/relocate-data.mjs` 负责移动项目目录后的路径更新，并保留旧备份路径的读取兼容。

## 本次验证

JavaScript 语法检查和全部 73 项自动测试通过，覆盖本地模拟解析、两阶段评审、桌面与手机页面、原文页面渲染和 PDF 下载。GPT 与 DeepSeek 模型列表接口均返回 HTTP 200，当前配置的默认模型均在列表中。此验证未调用真实付费评审；MinerU 真实云端解析未提交。

初次配置记录见 `local/macos-setup-report.json`，最近整理的测试日志见 `local/git-sync-tests.log`，完整验证范围见 [验证记录](verification.md)。
