#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  echo '需要 Node.js 22.12+ 或 24，请先在服务器安装受支持的 Node.js。' >&2
  exit 1
fi
exec node scripts/cloud-deploy.mjs "$@"
