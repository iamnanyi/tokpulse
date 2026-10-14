#!/bin/zsh
set -eu
task_root="${0:A:h:h}"
task_node="${TOKEN_SPEED_NODE:-$(command -v node || true)}"
if [[ -z "$task_node" ]]; then
  print '未找到 Node.js 22+。请在终端设置 TOKEN_SPEED_NODE，或使用 npm run install:auto。'
  exit 1
fi
"$task_node" "$task_root/src/cli.mjs" install
