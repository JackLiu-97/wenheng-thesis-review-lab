#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

node_bin="${REVIEW_NODE_BIN:-}"
if [[ -z "$node_bin" ]]; then
  for candidate in "$HOME"/.nvm/versions/node/v24.*/bin/node(N) /opt/homebrew/opt/node@24/bin/node /usr/local/opt/node@24/bin/node; do
    if [[ -x "$candidate" ]]; then
      node_bin="$candidate"
      break
    fi
  done
fi
if [[ -z "$node_bin" ]] && command -v node >/dev/null 2>&1; then
  node_bin="$(command -v node)"
fi
if [[ -z "$node_bin" || ! -x "$node_bin" ]]; then
  print -u2 '未找到 Node.js 24，请安装后重试，或设置 REVIEW_NODE_BIN。'
  exit 1
fi
export PATH="${node_bin:h}:$PATH"
exec "$node_bin" scripts/macos-launch.mjs "$@"
