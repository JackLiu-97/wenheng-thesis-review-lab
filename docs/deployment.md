# 服务器部署

当前部署在阿里云轻量应用服务器（已装宝塔面板与 Docker），通过 `http://<服务器IP>:8000` 访问。平台以 Docker 容器运行，数据库使用宝塔管理的 MySQL 5.7。

## 目录与组件

| 位置 | 内容 |
| --- | --- |
| `/root/wenheng/app/` | 项目代码（构建镜像用） |
| `/root/wenheng/data/` | 上传论文、解析结果、运行记录与 PDF 报告，挂载为容器的 `/app/data` |
| `/root/wenheng/.env` | 服务器配置与凭据，权限 600，只读挂载为容器的 `/app/.env` |
| 宝塔数据库 `wenheng` | 平台数据，账号 `wenheng`，访问权限“本地服务器” |
| Docker 容器 `wenheng` | 镜像 `wenheng:latest`，`--network host`，内存上限 1 GB，开机自动启动 |

镜像由项目根目录的 `Dockerfile` 构建：Node 24、Playwright Chromium（PDF 报告）、Poppler（论文页面图片）、`unzip` 与中文字体，只安装生产依赖。

## 服务器配置

`/root/wenheng/.env` 包含解析与模型凭据，以及以下部署项：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | 容器使用主机网络，直接连接宝塔 MySQL |
| `MYSQL_USER` / `MYSQL_DATABASE` | `wenheng` / `wenheng` | 宝塔创建的库与账号 |
| `REVIEW_HOST` / `REVIEW_PORT` | `0.0.0.0` / `8000` | 对外直接监听 8000 端口 |
| `REVIEW_ALLOWED_HOSTS` | `<服务器IP>` | 允许的访问地址；改用域名时追加域名 |
| `REVIEW_DATA_DIR` | `/app/data` | 容器内数据目录 |

GPT 模型依赖 Codex CLI，镜像中未安装，服务器上请使用 DeepSeek 模型。

## 访问方式与网络

服务器的 80/443 端口由名为 `nginx` 的 Docker 容器提供（配置在 `/home/web/conf.d/`），它只响应已配置的域名，直接用 IP 访问会被丢弃（`return 444`）。宝塔自带的 Nginx 未实际对外服务。因此平台直接监听 8000 端口，需在阿里云防火墙中放行 8000。

当前为 HTTP，登录密码与论文明文传输。需要 HTTPS 时：为子域名（如 `review.example.com`）添加 A 记录指向服务器，在 `/home/web/conf.d/` 中新增反向代理到 `127.0.0.1:8000` 的站点并申请证书，然后把域名加入 `REVIEW_ALLOWED_HOSTS`，最后在防火墙中关闭 8000。修改该 Nginx 前先执行 `docker exec nginx nginx -t`，避免影响同一 Nginx 上的其他站点。

## 更新代码

在本机项目目录上传代码（不含 `.env`、数据与依赖）：

```sh
COPYFILE_DISABLE=1 tar -czf - --exclude=./.git --exclude=./node_modules --exclude=./data --exclude=./local --exclude=./runtime --exclude='./.env' . | ssh root@<服务器IP> 'tar -xzf - -C /root/wenheng/app'
```

在服务器上重新构建并替换容器：

```sh
cd /root/wenheng/app && docker build -t wenheng:latest .
docker rm -f wenheng
docker run -d --name wenheng --restart unless-stopped --network host --memory 1g \
  -v /root/wenheng/data:/app/data -v /root/wenheng/.env:/app/.env:ro wenheng:latest
```

启动时自动执行新的数据库迁移。运行中的评审会被标记为中断，可在页面中从已完成阶段重试；建议在没有评审进行时更新。

本机若经由代理软件（TUN 模式）上网，SSH 到 22 端口可能被代理节点拦截，可加上 `-o "ProxyCommand nc -b en0 %h %p"` 绕过代理直连，或在代理规则中让服务器 IP 走直连。

## 运维命令

```sh
docker logs --tail 100 wenheng          # 查看服务日志
docker restart wenheng                  # 修改 .env 后重启
docker stats --no-stream wenheng        # 查看内存占用
```

备份在容器内执行，并把 `mysqldump` 指向宝塔的 MySQL 客户端，或在服务器上直接使用宝塔的数据库备份功能；论文与报告文件位于 `/root/wenheng/data/`，一并备份。备份与恢复细节见 [数据库说明](database.md)。

## 部署前验证

部署前在服务器上用临时 MySQL 5.7.44 容器运行了数据库相关的全部测试（102 项通过），浏览器流程测试在本机 MySQL 上通过；部署后确认了公网访问、MinerU 与 DeepSeek 配置、Chromium 和 Poppler 可用。
