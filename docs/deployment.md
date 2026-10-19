# 服务器部署

当前部署在阿里云轻量应用服务器（已装宝塔面板与 Docker），通过 `https://review.example.com`（实际子域名见服务器配置）访问。平台以 Docker 容器运行，由服务器上已有的 Docker Nginx 提供 HTTPS 并转发到平台；数据库使用宝塔管理的 MySQL 5.7。

## 目录与组件

| 位置 | 内容 |
| --- | --- |
| `/root/wenheng/app/` | 项目代码（构建镜像用） |
| `/root/wenheng/data/` | 上传论文、解析结果、运行记录与 PDF 报告，挂载为容器的 `/app/data` |
| `/root/wenheng/.env` | 服务器配置与凭据，权限 600，只读挂载为容器的 `/app/.env` |
| 宝塔数据库 `wenheng` | 平台数据，账号 `wenheng`，访问权限“本地服务器” |
| Docker 容器 `wenheng` | 镜像 `wenheng:latest`，`--network host`，内存上限 1 GB，开机自动启动 |
| `/home/web/conf.d/review.example.com.conf` | Docker Nginx 中的站点配置：HTTPS、HTTP 跳转、上传上限与证书验证路径 |
| `/home/web/certs/review.example.com_cert.pem`、`_key.pem` | 站点证书（Let's Encrypt），由续期脚本自动更新 |

镜像由项目根目录的 `Dockerfile` 构建：Node 24、Playwright Chromium（PDF 报告）、Poppler（论文页面图片）、`unzip` 与中文字体，只安装生产依赖。

## 服务器配置

`/root/wenheng/.env` 包含解析与模型凭据，以及以下部署项：

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | 容器使用主机网络，直接连接宝塔 MySQL |
| `MYSQL_USER` / `MYSQL_DATABASE` | `wenheng` / `wenheng` | 宝塔创建的库与账号 |
| `REVIEW_HOST` / `REVIEW_PORT` | `0.0.0.0` / `8000` | 平台监听端口；Nginx 经本机 `127.0.0.1:8000` 转发，对外的 8000 端口在阿里云防火墙中关闭 |
| `REVIEW_ALLOWED_HOSTS` | `<服务器IP>,review.example.com` | 允许的访问地址（逗号分隔）；更换域名时同步修改 |
| `REVIEW_DATA_DIR` | `/app/data` | 容器内数据目录 |

GPT 模型依赖 Codex CLI，镜像中未安装，服务器上请使用 DeepSeek 模型。

## 访问方式与网络

服务器的 80/443 端口由名为 `nginx` 的 Docker 容器提供（主机网络，配置在 `/home/web/conf.d/`），同一个 Nginx 上还有其他站点。它只响应已配置的域名，直接用 IP 访问会被丢弃（`return 444`）；宝塔自带的 Nginx 未实际对外服务。

平台的访问链路：

```
浏览器 → https://review.example.com（DNS A 记录 → 服务器，Cloudflare“仅 DNS”）
       → Docker Nginx :443（证书、HTTP→HTTPS 跳转、上传上限 32 MB、超时 300 秒）
       → 127.0.0.1:8000（wenheng 容器）
```

域名托管在 Cloudflare，子域名的 A 记录使用“仅 DNS”（灰色云朵），不经过 Cloudflare 代理，因此不受其上传大小与超时限制。Nginx 主配置对所有子域名开启了 HSTS，浏览器会强制使用 HTTPS。

修改 Docker Nginx 配置时，先执行 `docker exec nginx nginx -t`，通过后再 `docker exec nginx nginx -s reload`，避免影响同一 Nginx 上的其他站点。站点配置的上传上限 `client_max_body_size 32m` 不能删除：该 Nginx 默认只允许 1 MB，会拒绝论文上传。

平台本身仍监听 8000 端口。对外只需开放 80/443；阿里云防火墙中的 8000 端口应关闭（Nginx 通过本机地址访问，不受防火墙影响）。

## HTTPS 证书

证书由 Let's Encrypt 免费签发，有效期约 90 天，无需付费或充值。服务器的定时任务每天 0 点运行 `/root/auto_cert_renewal.sh`，遍历 `/home/web/certs/*_cert.pem`，到期前 15 天自动续签并重新加载 Nginx。站点配置中保留了 `/.well-known/acme-challenge/` 验证路径，续期脚本据此使用 webroot 方式，续期时不停止 Nginx。

首次签发（或更换子域名）的步骤：

1. 在 Cloudflare 为子域名添加 A 记录，指向服务器 IP，代理状态选“仅 DNS”。
2. 在 `/home/web/conf.d/` 新增仅监听 80 端口、包含 `location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }` 的站点，检查并重新加载 Nginx。
3. 使用服务器上已有的 Let's Encrypt 账号签发证书：

   ```sh
   docker run --rm -v /etc/letsencrypt/:/etc/letsencrypt -v /home/web/letsencrypt:/var/www/letsencrypt \
     certbot/certbot certonly --webroot -w /var/www/letsencrypt -d review.example.com --key-type ecdsa -n
   ```

4. 把 `/etc/letsencrypt/live/review.example.com/` 下的 `fullchain.pem`、`privkey.pem` 复制为 `/home/web/certs/review.example.com_cert.pem`、`_key.pem`，将站点改为监听 443 并开启 HTTP 跳转，检查后重新加载 Nginx。
5. 把域名加入 `REVIEW_ALLOWED_HOSTS`，执行 `docker restart wenheng`。

需要付费续费的是域名（在原注册商处每年续费）和云服务器本身，与证书无关。

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

部署前在服务器上用临时 MySQL 5.7.44 容器运行了数据库相关的全部测试（102 项通过），浏览器流程测试在本机 MySQL 上通过；部署后确认了公网访问、MinerU 与 DeepSeek 配置、Chromium 和 Poppler 可用。启用 HTTPS 后确认了 HTTP 跳转、证书、登录接口经代理可用、20 MB 请求可通过 Nginx 而 40 MB 被拒，以及同一 Nginx 上的其他站点不受影响。
