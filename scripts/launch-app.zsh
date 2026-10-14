#!/bin/zsh
set -eu
task_root="$1"
task_app="$2"
case "$task_app" in
  chatgpt) task_name='ChatGPT Token Speed'; task_label='local.chatgpt-token-speed' ;;
  zcode) task_name='ZCode Token Speed'; task_label='local.zcode-token-speed' ;;
  *) print -u2 '未知 App；请选择 chatgpt 或 zcode'; exit 1 ;;
esac
task_base="$HOME/Library/Application Support/$task_name"
task_plist="$HOME/Library/LaunchAgents/$task_label.plist"

# Finder does not inherit a terminal's PATH; include common macOS Node installations.
task_node="${TOKEN_SPEED_NODE:-$(command -v node || true)}"
if [[ -z "$task_node" ]]; then
  for task_candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$task_candidate" ]]; then task_node="$task_candidate"; break; fi
  done
fi
if [[ -z "$task_node" ]]; then
  task_nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$task_nvm_dir/nvm.sh" ]]; then
    # nvm's shell initialization is not compatible with nounset.
    set +u
    source "$task_nvm_dir/nvm.sh"
    set -u
    task_node="$(command -v node || true)"
  fi
fi
if [[ -z "$task_node" || ! -x "$task_node" ]]; then
  print -u2 '未找到 Node.js 22+；请安装 Node 或设置 TOKEN_SPEED_NODE 为可执行文件的绝对路径。'
  exit 1
fi
"$task_node" --input-type=module -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("需要 Node.js 22 或以上"); process.exit(1); }'

# Install only on first use. Later launches preserve the existing service and config.
if [[ ! -f "$task_plist" || ! -f "$task_base/app/src/cli.mjs" ]]; then
  "$task_node" "$task_root/src/cli.mjs" install --app "$task_app"
fi
exec "$task_node" "$task_root/src/cli.mjs" launch --app "$task_app"
