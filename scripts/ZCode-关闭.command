#!/bin/zsh
set -eu
task_root="${0:A:h:h}"
task_node="${TOKEN_SPEED_NODE:-$(command -v node || true)}"
[[ -n "$task_node" ]] || { print '未找到 Node.js'; exit 1; }
"$task_node" "$task_root/src/cli.mjs" stop --app zcode
