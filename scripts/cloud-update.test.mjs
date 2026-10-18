import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, realpath, rm, rmdir, writeFile, copyFile, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, basename } from 'node:path';
import { cloudSourceRevision, stageCloudUpdate } from './cloud-update.mjs';
import { inspectCloudStages, applyCloudStageRetention } from './cloud-stage-retention.mjs';

const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

const run = async (bin, args, options = {}) => {
  const result = spawnSync(bin, args, { cwd: options.cwd, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'command failed');
  return result.stdout.trim();
};

async function repository(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pf-cloud-update-')));
  t.after(async () => {
    assert.equal(dirname(root), await realpath(tmpdir()));
    assert.ok(basename(root).startsWith('pf-cloud-update-'));
    await rm(root, { recursive: true, force: true });
  });
  const files = {
    '.gitignore': '.local/\n', 'package.json': '{"private":true}', 'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    'deploy.sh': '#!/bin/bash\n', 'scripts/cloud-deploy.mjs': '// deployment fixture\n',
    'infra/compose.pm2.yml': 'name: problemforge-cloud\n',
    'packages/database/prisma/migrations/0001/migration.sql': 'SELECT 1;\n',
    '题面.txt': '发布包中的中文文件名\n',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  for (const name of ['package-cloud.mjs', 'cloud-config.mjs']) await copyFile(new URL(name, import.meta.url), join(root, 'scripts', name));
  const git = args => run('git', args, { cwd: root });
  await git(['init', '-q']);
  await git(['config', 'core.autocrlf', 'false']);
  await git(['config', 'core.eol', 'lf']);
  await git(['add', '.']);
  await git(['-c', 'commit.gpgSign=false', '-c', 'user.name=Deployment Test', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  return { root, git, commit: await git(['rev-parse', 'HEAD']) };
}

test('update stages the exact clean Git commit with the real packager, then reuses a verified package', async t => {
  const { root, commit } = await repository(t);
  assert.equal(await cloudSourceRevision(root, run), commit);
  let packages = 0;
  const packageRun = async (...args) => { packages++; return run(...args); };
  const first = await stageCloudUpdate(root, commit, packageRun, process.execPath);
  assert.equal(first.manifest.buildId, `git-${commit}`);
  assert.equal(first.manifest.gitCommit, commit);
  assert.equal(await readFile(join(first.source, '题面.txt'), 'utf8'), '发布包中的中文文件名\n');
  assert.equal((JSON.parse(await readFile(join(first.source, 'release.json'), 'utf8'))).migrations.length, 1);
  assert.equal(await exists(join(dirname(first.source), 'source.tar')), false);
  assert.equal(await exists(join(root, '.local/releases', `problemforge-caddy-pm2-${first.manifest.buildId}.tar.gz`)), false);
  assert.deepEqual(await stageCloudUpdate(root, commit, packageRun, process.execPath), first);
  assert.equal(packages, 1);
  await writeFile(join(first.source, 'deploy.sh'), 'changed');
  await assert.rejects(stageCloudUpdate(root, commit, packageRun, process.execPath), /校验失败/);
  assert.equal(packages, 1);
});

test('update refuses dirty or non-root checkouts before packaging', async t => {
  const { root } = await repository(t);
  await assert.rejects(cloudSourceRevision(join(root, 'scripts'), run), /源码根目录/);
  await writeFile(join(root, 'uncommitted.txt'), 'local edit');
  await assert.rejects(cloudSourceRevision(root, run), /未提交改动/);
  assert.equal(await readFile(join(root, 'uncommitted.txt'), 'utf8'), 'local edit');
});

test('update preserves incomplete packages and rejects invalid commit paths', async t => {
  const { root, commit } = await repository(t);
  await mkdir(join(root, '.local', 'releases', `cloud-git-${commit}`), { recursive: true });
  const noRun = () => { throw new Error('must not run a command'); };
  await assert.rejects(stageCloudUpdate(root, commit, noRun, process.execPath), /未完成的打包目录/);
  await assert.rejects(stageCloudUpdate(root, '../outside', noRun, process.execPath), /无效 Git 提交/);
});

test('normal cloud packaging keeps the distributable archive; cleanup deletes only an old verified package', async t => {
  const { root, commit } = await repository(t);
  await run(process.execPath, ['scripts/package-cloud.mjs', 'archive-release'], { cwd: root });
  const directory = join(root, '.local/releases'), archive = join(directory, 'problemforge-caddy-pm2-archive-release.tar.gz');
  assert.equal(await exists(archive), true);
  assert.equal(await exists(`${archive}.sha256`), true);
  assert.equal(await exists(join(directory, 'cloud-archive-release/source.tar')), false);
  const current = await stageCloudUpdate(root, commit, run, process.execPath);
  const options = { protectedBuildIds: [current.manifest.buildId] };
  const plan = await inspectCloudStages(root, options);
  assert.deepEqual(plan.candidates.map(row => row.buildId), ['archive-release']);
  assert.equal(await exists(archive), true);
  const result = await applyCloudStageRetention(plan, options);
  assert.equal(result.removed.length, 1);
  assert.equal(await exists(archive), false);
  assert.equal(await exists(`${archive}.sha256`), false);
  assert.equal(await exists(current.source), true);
  assert.deepEqual((await inspectCloudStages(root, options)).candidates, []);
});

test('stage cleanup preserves extra files, incomplete archives and source changed after preview', async t => {
  const { root, commit } = await repository(t);
  const first = await stageCloudUpdate(root, commit, run, process.execPath);
  const initial = await inspectCloudStages(root);
  assert.equal(initial.candidates.length, 1);
  await writeFile(join(first.source, 'personal-note.txt'), 'keep');
  const changed = await applyCloudStageRetention(initial);
  assert.deepEqual(changed.removed, []);
  assert.equal(await exists(first.source), true);
  await rm(join(first.source, 'personal-note.txt'));
  const archive = join(root, '.local/releases', `problemforge-caddy-pm2-${first.manifest.buildId}.tar.gz`);
  await writeFile(archive, 'partial');
  assert.deepEqual((await inspectCloudStages(root)).candidates, []);
  await rm(archive);
  const plan = await inspectCloudStages(root);
  await writeFile(join(first.source, 'deploy.sh'), 'changed');
  assert.deepEqual((await applyCloudStageRetention(plan)).removed, []);
  assert.equal(await exists(first.source), true);
});

test('stage cleanup rejects linked parent directories and retains linked stages without touching targets', async t => {
  const { root } = await repository(t);
  const outside = join(root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'unrelated');
  await mkdir(join(root, '.local/releases'), { recursive: true });
  await symlink(outside, join(root, '.local/releases/cloud-linked-release'), process.platform === 'win32' ? 'junction' : 'dir');
  const plan = await inspectCloudStages(root);
  assert.deepEqual(plan.candidates, []);
  await applyCloudStageRetention(plan);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'unrelated');
  await rm(join(root, '.local/releases/cloud-linked-release'));
  await rmdir(join(root, '.local/releases'));
  await symlink(outside, join(root, '.local/releases'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectCloudStages(root), /普通目录/);
  await rm(join(root, '.local/releases'));
});
