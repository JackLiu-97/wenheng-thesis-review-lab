# 文衡评审平台：Node 24 + Chromium（PDF 报告）+ Poppler（论文页面图片）。数据库使用外部 MySQL。
FROM node:24.12.0-bookworm-slim
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils unzip fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npx playwright install --with-deps chromium \
 && npm cache clean --force
COPY assets ./assets
COPY config ./config
COPY migrations ./migrations
COPY public ./public
COPY src ./src
COPY scripts ./scripts
# Uploaded papers, parse results and reports live in a mounted volume.
VOLUME /app/data
EXPOSE 4173
CMD ["node","src/server.mjs"]
