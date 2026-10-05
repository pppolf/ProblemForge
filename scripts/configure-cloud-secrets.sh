#!/usr/bin/env bash
set -euo pipefail
set +x

if [ "$#" -gt 1 ]; then
  printf '%s\n' '用法：bash scripts/configure-cloud-secrets.sh [私有 JSON 文件绝对路径]' >&2
  exit 1
fi
pf_secrets_file="${1:-/root/problemforge.secrets.json}"
if [[ "$pf_secrets_file" != /* ]]; then
  printf '%s\n' '请使用私有 JSON 文件的绝对路径。' >&2
  exit 1
fi
command -v node >/dev/null || { printf '%s\n' '请先执行 . /opt/problemforge-tools/env.sh' >&2; exit 1; }
umask 077

if [[ -e "$pf_secrets_file" || -L "$pf_secrets_file" ]]; then
  node --input-type=module - "$pf_secrets_file" <<'NODE'
import { lstatSync, readFileSync, chmodSync } from 'node:fs';
try {
  const path = process.argv[2];
  if (!lstatSync(path).isFile()) throw new Error();
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof saved?.associationAppKey !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/.test(saved.associationAppKey)) throw new Error();
  chmodSync(path, 0o600);
  console.log('私有配置已存在且 APPKEY 格式正确，保留原内容。可以继续部署。');
} catch {
  console.error('已有私有配置无法读取或 APPKEY 格式不正确，未覆盖；请先检查该文件。');
  process.exitCode = 1;
}
NODE
  exit 0
fi

# Read only from the controlling terminal, never from pasted script source or a pipe.
if ! { exec 3</dev/tty; } 2>/dev/null; then
  printf '%s\n' '需要在交互式 SSH 终端执行此命令。' >&2
  exit 1
fi
while true; do
  if ! IFS= read -r -s -u 3 -p '请粘贴完整协会 APPKEY（输入不显示），然后按回车：' PF_PRIVATE_KEY; then
    printf '\n%s\n' '输入已取消，未创建私有配置。' >&2
    exit 1
  fi
  printf '\n'
  if PF_PRIVATE_KEY="$PF_PRIVATE_KEY" node --input-type=module - "$pf_secrets_file" <<'NODE'
import { writeFileSync } from 'node:fs';
const key = (process.env.PF_PRIVATE_KEY ?? '').trim();
if (!/^[A-Za-z0-9_-]{16,512}$/.test(key)) {
  console.error(key ? '格式不正确：请只粘贴 APPKEY 本身，不要带引号、命令或中间的空格。请重新输入。' : '没有读到 APPKEY，请重新粘贴并回车。');
  process.exit(2);
}
try {
  writeFileSync(process.argv[2], JSON.stringify({ associationAppKey: key, adminEmail: 'admin@problems.cwnupaa.com' }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('私有配置已保存，权限为 600。可以继续部署。');
} catch (error) {
  console.error(error.code === 'EEXIST' ? '私有配置已存在，未覆盖；请重新运行此命令检查。' : '私有配置写入失败，请检查目录和权限。');
  process.exitCode = 1;
}
NODE
  then
    unset PF_PRIVATE_KEY
    exit 0
  else
    pf_input_status=$?
    unset PF_PRIVATE_KEY
    if [ "$pf_input_status" -ne 2 ]; then exit "$pf_input_status"; fi
  fi
done
