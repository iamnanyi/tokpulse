#!/bin/zsh
set -eu
exec /bin/zsh "${0:A:h}/launch-app.zsh" "$1" zcode
