import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, safeReleasePath, verifyRelease } from './cloud-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Git 信息读取失败'); return result.stdout.trim();
};
if (git('status', '--porcelain')) throw new Error('部署包要求先提交工作区，只打包已提交内容');
const commit = git('rev-parse', 'HEAD'), tree = git('rev-parse', 'HEAD^{tree}'), builtAt = new Date().toISOString();
const buildId = process.argv[2] ?? `${builtAt.replace(/[^0-9]/g, '').slice(0, 14)}-${commit.slice(0, 12)}`;
if (!/^[a-z0-9][a-z0-9.-]{2,80}$/.test(buildId)) throw new Error('构建标识只能含小写字母、数字、点和连字符');
const out = resolve(root, '.local/releases'), stage = resolve(out, `cloud-${buildId}`), folder = resolve(stage, 'problemforge');
await mkdir(out, { recursive: true }); await mkdir(stage); await mkdir(folder);
const archive = resolve(stage, 'source.tar');
git('archive', '--format=tar', `--output=${archive}`, commit);
function tar(args) {
  // Windows bsdtar otherwise interprets Git's UTF-8 names using the local code page.
  const charset = process.platform === 'win32' ? ['--options', 'hdrcharset=UTF-8'] : [];
  const result = spawnSync('tar', [...charset, ...args], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('部署包归档失败');
}
tar(['-xf', archive, '-C', folder]);
const migrationsPath = resolve(folder, 'packages/database/prisma/migrations');
const migrations = [];
for (const entry of await readdir(migrationsPath, { withFileTypes: true })) if (entry.isDirectory()) migrations.push({ name: entry.name, checksum: digest(await readFile(resolve(migrationsPath, entry.name, 'migration.sql'))) });
migrations.sort((a, b) => a.name.localeCompare(b.name));
await writeFile(resolve(folder, 'release.json'), JSON.stringify({ format: 1, buildId, gitCommit: commit, gitTree: tree, builtAt, migrations }, null, 2));
const files = [];
async function inventory(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix + entry.name, absolute = resolve(directory, entry.name);
    if (!safeReleasePath(path) || (await lstat(absolute)).isSymbolicLink()) throw new Error(`部署包含不允许的路径：${path}`);
    if (entry.isDirectory()) await inventory(absolute, `${path}/`);
    else if (entry.isFile()) files.push({ path, sha256: digest(await readFile(absolute)) });
    else throw new Error('部署包不能包含特殊文件');
  }
}
await inventory(folder); files.sort((a, b) => a.path.localeCompare(b.path));
await writeFile(resolve(folder, 'cloud-release.json'), JSON.stringify({ format: 1, buildId, gitCommit: commit, files }, null, 2));
await verifyRelease(folder);
const name = `problemforge-caddy-pm2-${buildId}.tar.gz`;
tar(['--format=pax', '-czf', resolve(out, name), '-C', stage, 'problemforge']);
await writeFile(resolve(out, `${name}.sha256`), `${digest(await readFile(resolve(out, name)))}  ${name}\n`);
console.log(`部署包：${resolve(out, name)}\n不包含 .env、密钥、数据库或私有题库文件。`);
