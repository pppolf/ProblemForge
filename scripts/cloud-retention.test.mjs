import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, symlink, rm, lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { digest } from './cloud-config.mjs';
import { inspectCloudRetention, applyCloudRetention, retiredCloudImages } from './cloud-retention.mjs';

const commit = 'a'.repeat(40);
const present = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
async function write(path, content) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, content); }
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pf-retention-')));
  t.after(async () => {
    assert.equal(dirname(root), await realpath(tmpdir()));
    assert.ok(basename(root).startsWith('pf-retention-'));
    await rm(root, { recursive: true, force: true });
  });
  await write(join(root, '.problemforge-managed'), 'ProblemForge Caddy PM2 deployment v1\n');
  await mkdir(join(root, 'shared/backups'), { recursive: true });
  await write(join(root, 'shared/storage/private.txt'), 'business data');
  async function release(id, { prepared = true, deployed = true } = {}) {
    const buildId = `release-${id}`, path = join(root, 'releases', buildId);
    const content = {
      'package.json': '{}', 'pnpm-lock.yaml': 'lockfileVersion: 9', 'deploy.sh': '#!/bin/bash\n',
      'scripts/cloud-deploy.mjs': '// fixture', 'infra/compose.pm2.yml': 'name: problemforge-cloud',
      'release.json': JSON.stringify({ buildId, gitCommit: commit, builtAt: `2026-10-${String(id + 1).padStart(2, '0')}T00:00:00.000Z` }),
    };
    for (const [name, value] of Object.entries(content)) await write(join(path, name), value);
    await write(join(path, 'cloud-release.json'), JSON.stringify({ format: 1, buildId, gitCommit: commit,
      files: Object.entries(content).map(([name, value]) => ({ path: name, sha256: digest(value) })) }));
    if (prepared) await write(join(path, '.prepared'), 'ready\n');
    if (deployed) await write(join(path, '.deployed.json'), JSON.stringify({ buildId, gitCommit: commit, httpsVerified: true }));
    await write(join(path, 'node_modules/example/index.js'), 'dependency');
    await write(join(path, '.sandbox-images.json'), JSON.stringify({ format: 1, buildId, images: { tex: { imageId: `sha256:${'1'.repeat(64)}`, recipe: 'fixture' } } }));
    return path;
  }
  async function backup(id, build = id, purpose = 'automatic') {
    const name = `202610${String(id + 1).padStart(2, '0')}000000000`, path = join(root, 'shared/backups', name), buildId = `release-${build}`;
    const members = { 'state.json': '{}', 'database.dump': 'db', 'storage.tar': 'private files',
      'configuration/previous-release.txt': `${join(root, 'releases', buildId)}\n` };
    for (const [name, value] of Object.entries(members)) await write(join(path, name), value);
    const manifest = { format: 1, kind: 'problemforge-pm2', buildId, files: Object.fromEntries(Object.entries(members).map(([name, value]) => [name, digest(value)])) };
    if (purpose) manifest.purpose = purpose;
    await write(join(path, 'manifest.json'), JSON.stringify(manifest));
    return path;
  }
  async function activate(id) {
    const current = join(root, 'current');
    if (await present(current)) await rm(current);
    await symlink(join(root, 'releases', `release-${id}`), current, process.platform === 'win32' ? 'junction' : 'dir');
    await write(join(root, 'shared/last-deploy.json'), JSON.stringify({ buildId: `release-${id}`, gitCommit: commit, httpsVerified: true }));
  }
  for (let id = 0; id < 5; id++) await release(id);
  await activate(4);
  return { root, release, backup, activate, options: { root } };
}

test('rotation keeps two complete backups and their code; real deletion is repeatable and leaves business data untouched', async t => {
  const f = await fixture(t);
  const backups = [];
  for (let id = 0; id < 4; id++) backups.push(await f.backup(id));
  const plan = await inspectCloudRetention(f.options);
  assert.deepEqual(plan.blocked, []);
  assert.deepEqual(plan.candidates.filter(row => row.type === 'release').map(row => row.buildId).sort(), ['release-0', 'release-1']);
  assert.deepEqual(plan.candidates.filter(row => row.type === 'backup').map(row => row.path).sort(), backups.slice(0, 2));
  assert.ok(plan.protectedBuildIds.includes('release-2'), 'backup source is older than the two newest releases');
  assert.equal(await present(backups[0]), true, 'preview does not delete');
  const removed = await applyCloudRetention(plan, f.options);
  assert.equal(removed.length, 4);
  assert.equal(await present(backups[0]), false);
  assert.equal(await readFile(join(f.root, 'shared/storage/private.txt'), 'utf8'), 'business data');
  assert.equal(await realpath(join(f.root, 'current')), join(f.root, 'releases/release-4'));
  const next = await inspectCloudRetention(f.options);
  assert.deepEqual(next.candidates, []);
  assert.deepEqual(await applyCloudRetention(next, f.options), []);
  assert.deepEqual((await retiredCloudImages(f.root)).map(row => row.buildId).sort(), ['release-0', 'release-1']);
});

test('legacy rotation requires explicit apply once, persists that choice, and never rotates marked manual backups', async t => {
  const f = await fixture(t);
  const legacy = [];
  for (let id = 0; id < 4; id++) legacy.push(await f.backup(id, id, null));
  const manual = await f.backup(5, 0, 'manual');
  const automatic = await inspectCloudRetention(f.options);
  assert.equal(automatic.candidates.filter(row => row.type === 'backup').length, 0);
  const options = { ...f.options, includeLegacyBackups: true };
  const plan = await inspectCloudRetention(options);
  assert.equal(await present(join(f.root, 'shared/cloud-retention.json')), false);
  assert.deepEqual(plan.candidates.filter(row => row.type === 'backup').map(row => row.path), legacy.slice(0, 2));
  assert.ok(plan.protectedBuildIds.includes('release-0'));
  await applyCloudRetention(plan, options);
  assert.equal(await present(manual), true);
  await f.backup(6, 4);
  const later = await inspectCloudRetention(f.options);
  assert.equal(later.includeLegacyBackups, true);
  assert.deepEqual(later.candidates.filter(row => row.type === 'backup').map(row => row.path), [legacy[2]]);
});

test('active and saved-process versions are protected; pending and mismatched success prevent all deletion', async t => {
  const f = await fixture(t);
  let plan = await inspectCloudRetention({ ...f.options, processReleasePaths: [join(f.root, 'releases/release-0')] });
  assert.ok(!plan.candidates.some(row => row.buildId === 'release-0'));
  await write(join(f.root, 'shared/pending-deploy.json'), '{"buildId":"release-3"}');
  plan = await inspectCloudRetention(f.options);
  assert.deepEqual(plan.candidates, []);
  await assert.rejects(applyCloudRetention(plan, f.options), /未完成部署/);
  await rm(join(f.root, 'shared/pending-deploy.json'));
  await write(join(f.root, 'shared/last-deploy.json'), JSON.stringify({ buildId: 'release-3', gitCommit: commit, httpsVerified: true }));
  assert.ok((await inspectCloudRetention(f.options)).blocked.length);
  await assert.rejects(inspectCloudRetention({ ...f.options, processReleasePaths: [resolve(f.root, '..', 'foreign')] }), /非托管版本/);
});

test('unknown, unprepared, unconfirmed and corrupt releases survive; corrupt backups preserve their source', async t => {
  const f = await fixture(t);
  await f.release(0, { prepared: true, deployed: false });
  await rm(join(f.root, 'releases/release-0/.deployed.json'));
  await rm(join(f.root, 'releases/release-1/.prepared'));
  await write(join(f.root, 'releases/release-2/deploy.sh'), 'changed');
  const broken = await f.backup(0, 3);
  await write(join(broken, 'storage.tar'), 'corrupt');
  await write(join(f.root, 'releases/unmanaged/note.txt'), 'keep');
  const plan = await inspectCloudRetention(f.options);
  for (const id of [0, 1, 2, 3]) assert.ok(!plan.candidates.some(row => row.buildId === `release-${id}`));
  assert.ok(!plan.candidates.some(row => row.path === broken));
  assert.ok(plan.kept.some(row => row.path.endsWith('unmanaged')));
});

test('incomplete backup with unknown source retains all releases for recovery', async t => {
  const f = await fixture(t);
  await write(join(f.root, 'shared/backups/20260901000000000/storage.tar'), 'partial');
  const plan = await inspectCloudRetention(f.options);
  assert.equal(plan.candidates.filter(row => row.type === 'release').length, 0);
  assert.ok(plan.warnings.length);
});

test('root and child symlinks never traverse or delete external directories', async t => {
  const f = await fixture(t), outside = join(f.root, 'outside');
  await write(join(outside, 'sentinel'), 'untouched');
  await symlink(outside, join(f.root, 'releases/linked-release'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(outside, join(f.root, 'shared/backups/20260901000000000'), process.platform === 'win32' ? 'junction' : 'dir');
  const plan = await inspectCloudRetention(f.options);
  assert.ok(plan.kept.some(row => row.path.endsWith('linked-release')));
  await applyCloudRetention(plan, f.options);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'untouched');
  const alias = join(f.root, 'alias');
  await symlink(f.root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectCloudRetention({ root: alias }), /可信托管目录/);
  await rm(alias);
});

test('source, backup or pending changes after preview reject apply before any deletion', async t => {
  const f = await fixture(t);
  const plan = await inspectCloudRetention(f.options);
  await write(join(f.root, 'releases/release-0/deploy.sh'), 'changed');
  await assert.rejects(applyCloudRetention(plan, f.options), /状态已变化/);
  assert.equal(await present(join(f.root, 'releases/release-1')), true);
  const second = await inspectCloudRetention(f.options);
  await write(join(f.root, 'shared/pending-deploy.json'), '{}');
  await assert.rejects(applyCloudRetention(second, f.options), /状态已变化/);
});

test('backup extra files and false previous-release references are preserved', async t => {
  const f = await fixture(t);
  const path = await f.backup(0, 0);
  await write(join(path, 'personal-notes.txt'), 'do not remove');
  const plan = await inspectCloudRetention(f.options);
  assert.ok(!plan.candidates.some(row => row.path === path));
  assert.ok(plan.protectedBuildIds.includes('release-0'));
  const other = await f.backup(1, 1);
  const manifest = JSON.parse(await readFile(join(other, 'manifest.json'), 'utf8'));
  const value = `${join(f.root, 'releases/release-2')}\n`;
  await write(join(other, 'configuration/previous-release.txt'), value);
  manifest.files['configuration/previous-release.txt'] = digest(value);
  await write(join(other, 'manifest.json'), JSON.stringify(manifest));
  const changed = await inspectCloudRetention(f.options);
  assert.ok(!changed.candidates.some(row => row.path === other));
  assert.ok(changed.protectedBuildIds.includes('release-1'));
  assert.ok(changed.protectedBuildIds.includes('release-2'));
});

test('retired-image queue ignores still-existing versions and refuses malformed identities', async t => {
  const f = await fixture(t);
  const path = join(f.root, 'shared/retired-sandbox-images.json');
  await write(path, JSON.stringify({ format: 1, releases: [{ buildId: 'release-0' }, { buildId: 'removed-version' }] }));
  assert.deepEqual((await retiredCloudImages(f.root)).map(row => row.buildId), ['removed-version']);
  await write(path, JSON.stringify({ format: 1, releases: [{ receipt: {} }] }));
  await assert.rejects(retiredCloudImages(f.root), /记录无效/);
  const plan = await inspectCloudRetention(f.options);
  await assert.rejects(applyCloudRetention(plan, f.options), /记录无效/);
  assert.equal((await readdir(join(f.root, 'releases'))).length, 5);
});
