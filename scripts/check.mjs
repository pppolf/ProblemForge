import { spawnSync } from 'node:child_process';
const scopes = ['contracts', 'database', 'domain', 'storage', 'template-engine', 'judge-adapter', 'judge-core', 'api', 'web', 'tex-worker', 'judge-worker'];
const selected = process.argv.slice(2);
if (!selected.length || selected.some(s => !scopes.includes(s))) {
  console.error(`请指定受影响包：pnpm check ${scopes.join(' ')}。没有默认全仓检查。`);
  process.exit(2);
}
for (const scope of selected) {
  const args = ['--filter', `@problemforge/${scope}`, 'check'];
  const result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], { stdio: 'inherit' })
    : spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
