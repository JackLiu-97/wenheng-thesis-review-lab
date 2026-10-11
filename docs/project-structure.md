# 目录迁移说明

项目从 `paper-review-demo/` 提升到当前工作区根目录，npm 包名改为 `wenheng-thesis-review-lab`。本地工作区文件夹仍可保留中文名称；建议远程仓库使用英文名称。

| 原路径 | 新路径 |
| --- | --- |
| `paper-review-demo/server.mjs`、`auth.mjs`、`prompts.mjs` | `src/` |
| `paper-review-demo/*.html` | `public/` |
| `paper-review-demo/*.js` | `public/js/` |
| `paper-review-demo/*.css` | `public/css/` |
| `paper-review-demo/scripts/*.test.mjs` | `tests/` |
| 其他 `paper-review-demo/scripts/` 工具 | `scripts/` |
| `paper-review-demo/CONFIGURATION.md` | `docs/configuration.md` |
| `paper-review-demo/oral_download.env.example` | `config/oral-download.env.example` |
| `paper-review-demo/data/` | `data/`，本地保留，不提交 |
| `paper-review-demo/assets/` | `data/samples/`，本地保留，不提交 |
| `paper-review-demo/.env` | 根目录 `.env`，原样保留，不提交 |
| 外层空 `app.js`、临时 `tmp_forum.html` | `local/`，本地保留，不提交 |

`local/structure-backup/` 保留整理前的代码和文档，`local/private-files-before.xml` 保存私有文件的迁移前校验值，均不提交。

今后从根目录运行 `npm start`，入口为 `src/server.mjs`。网页脚本路径为 `/js/`，样式路径为 `/css/`。页面不依赖仓库附带示例 PDF；示例仅供辅助工具使用，可由脚本重新生成。

后端仍按根目录加载 `.env` 和默认 `data/`。如果自己的启动脚本、快捷方式或环境变量中写死了旧绝对路径，应同步修改；`REVIEW_DATA_DIR` 等本地自定义值未被自动覆盖。