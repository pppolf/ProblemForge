import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath, rm, writeFile, rename } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { verifyRelease } from './cloud-config.mjs';

const buildIdPattern = /^[a-z0-9][a-z0-9.-]{2,80}$/;
const validBuildId = value => typeof value === 'string' && buildIdPattern.test(value);
const backupPattern = /^\d{17}$/;
const hashPattern = /^[a-f0-9]{64}$/;
export const cloudRetentionPolicy = { releases: 2, backups: 2 };
const hash = value => createHash('sha256').update(value).digest('hex');
async function stat(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function directory(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new Error(`不是可信托管目录：${path}`);
  return info;
}
async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`不是普通文件：${path}`);
  return info;
}
async function json(path) { await regular(path); return JSON.parse(await readFile(path, 'utf8')); }
async function fileHash(path) {
  await regular(path);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}
// Apparent bytes are a size indication, not a promise of physical space freed:
// pnpm hardlinks and Docker layers can be shared with retained resources.
async function treeBytes(path) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) return info.size;
  let bytes = 0;
  for (const entry of await readdir(path)) bytes += await treeBytes(join(path, entry));
  return bytes;
}
async function backupEntry(path, name) {
  await directory(path);
  const manifest = await json(join(path, 'manifest.json'));
  if (manifest.format !== 1 || manifest.kind !== 'problemforge-pm2' || !validBuildId(manifest.buildId) ||
      !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object' ||
      !['state.json', 'database.dump', 'storage.tar'].every(key => hashPattern.test(manifest.files[key])) ||
      (manifest.purpose !== undefined && !['automatic', 'manual'].includes(manifest.purpose))) throw new Error('备份清单不受支持');
  const files = Object.keys(manifest.files);
  for (const file of files) {
    if (!/^(?:state\.json|database\.dump|storage\.tar|configuration\/[a-zA-Z0-9.-]+)$/.test(file) || !hashPattern.test(manifest.files[file])) throw new Error('备份清单成员无效');
    if (file.startsWith('configuration/')) await directory(join(path, 'configuration'));
    if (await fileHash(join(path, file)) !== manifest.files[file]) throw new Error('备份内容校验失败');
  }
  // Do not remove extra user files merely because a valid manifest exists.
  const actual = [];
  for (const item of await readdir(path)) {
    if (item === 'manifest.json') continue;
    if (item === 'configuration') {
      await directory(join(path, item));
      for (const child of await readdir(join(path, item))) actual.push(`${item}/${child}`);
    } else actual.push(item);
  }
  if (JSON.stringify(actual.sort()) !== JSON.stringify(files.sort())) throw new Error('备份含清单外文件');
  const previous = manifest.files['configuration/previous-release.txt'];
  if (previous && (await readFile(join(path, 'configuration/previous-release.txt'), 'utf8')).trim() !== join(dirname(dirname(dirname(path))), 'releases', manifest.buildId)) throw new Error('备份引用版本不一致');
  return { type: 'backup', path, name, buildId: manifest.buildId, purpose: manifest.purpose ?? 'legacy', manifestHash: hash(JSON.stringify(manifest)), bytes: await treeBytes(path) };
}

export async function inspectCloudRetention({ root, includeLegacyBackups = false, processReleasePaths = [] }) {
  root = resolve(root);
  await directory(root);
  const marker = join(root, '.problemforge-managed');
  await regular(marker);
  if ((await readFile(marker, 'utf8')).trim() !== 'ProblemForge Caddy PM2 deployment v1') throw new Error('安装目录标记不匹配');
  const shared = join(root, 'shared'), releasesPath = join(root, 'releases'), backupsPath = join(shared, 'backups');
  for (const path of [shared, releasesPath, backupsPath]) await directory(path);
  const policyPath = join(shared, 'cloud-retention.json');
  if (await stat(policyPath)) {
    const policy = await json(policyPath);
    if (policy.format !== 1 || policy.rotateLegacyBackups !== true) throw new Error('历史备份轮转记录无效');
    includeLegacyBackups = true;
  }
  const report = { root, includeLegacyBackups, policy: cloudRetentionPolicy, blocked: [], warnings: [], candidates: [], kept: [], protectedBuildIds: [],
    bytes: { releases: 0, backups: 0, candidates: 0 } };
  const current = join(root, 'current');
  const currentStat = await lstat(current);
  if (!currentStat.isSymbolicLink()) throw new Error('current 不是托管版本链接');
  const active = await realpath(current), activeId = basename(active);
  if (dirname(active) !== releasesPath || !validBuildId(activeId)) throw new Error('current 指向非托管目录');
  const last = await json(join(shared, 'last-deploy.json'));
  if (last.buildId !== activeId || last.httpsVerified !== true || !/^[a-f0-9]{40}$/.test(last.gitCommit)) report.blocked.push('当前版本与最近成功部署记录不一致');
  if (await stat(join(shared, 'pending-deploy.json'))) report.blocked.push('存在未完成部署，保留全部恢复材料');
  const protectedIds = new Set([activeId]);
  for (const path of processReleasePaths) {
    const normalized = resolve(path);
    if (dirname(normalized) !== releasesPath || !validBuildId(basename(normalized))) throw new Error('PM2 引用了非托管版本，停止清理');
    protectedIds.add(basename(normalized));
  }
  const releases = [], backups = [];
  let unresolvedBackupReference = false;
  for (const name of await readdir(releasesPath)) {
    const path = join(releasesPath, name);
    try {
      if (!validBuildId(name)) throw new Error('目录名不受支持');
      await directory(path);
      await regular(join(path, '.prepared'));
      const manifest = await verifyRelease(path);
      if (manifest.buildId !== name) throw new Error('目录与发布清单不一致');
      if (name === activeId && manifest.gitCommit !== last.gitCommit) report.blocked.push('当前版本来源与成功部署记录不一致');
      const release = await json(join(path, 'release.json'));
      if (release.buildId !== name || release.gitCommit !== manifest.gitCommit || !Number.isFinite(Date.parse(release.builtAt))) throw new Error('版本时间或来源无效');
      let receipt = null;
      if (await stat(join(path, '.sandbox-images.json'))) receipt = await json(join(path, '.sandbox-images.json'));
      let deployed = false;
      if (await stat(join(path, '.deployed.json'))) {
        const success = await json(join(path, '.deployed.json'));
        if (success.buildId !== name || success.gitCommit !== manifest.gitCommit || success.httpsVerified !== true) throw new Error('版本成功记录不一致');
        deployed = true;
      }
      releases.push({ type: 'release', path, name, buildId: name, builtAt: release.builtAt, deployed, manifestHash: hash(JSON.stringify(manifest)), receipt, bytes: await treeBytes(path) });
    } catch (error) {
      protectedIds.add(name);
      report.kept.push({ type: 'release', path, reason: `未完成或无法验证：${error.message}` });
      if (name === activeId) report.blocked.push('当前版本校验失败');
    }
  }
  for (const name of await readdir(backupsPath)) {
    const path = join(backupsPath, name);
    try {
      if (!backupPattern.test(name)) throw new Error('不是完整业务备份目录');
      backups.push(await backupEntry(path, name));
    } catch (error) {
      report.kept.push({ type: 'backup', path, reason: `未知、未完成或无法验证：${error.message}` });
      // A damaged backup can still contain usable recovery data. Protect any
      // identifiable source version without trusting the rest of its manifest.
      if (backupPattern.test(name)) {
        try {
          await directory(path);
          const item = await json(join(path, 'manifest.json'));
          if (validBuildId(item.buildId)) protectedIds.add(item.buildId);
          else unresolvedBackupReference = true;
          const configuration = join(path, 'configuration');
          if (await stat(configuration)) {
            await directory(configuration);
            const reference = join(configuration, 'previous-release.txt');
            if (await stat(reference)) {
              await regular(reference);
              const target = (await readFile(reference, 'utf8')).trim();
              if (dirname(target) === releasesPath && validBuildId(basename(target))) protectedIds.add(basename(target));
              else unresolvedBackupReference = true;
            }
          }
        } catch { unresolvedBackupReference = true; }
      }
    }
  }
  const rotating = backups.filter(item => item.purpose === 'automatic' || includeLegacyBackups && item.purpose === 'legacy').sort((a, b) => b.name.localeCompare(a.name));
  const latestBackups = new Set(rotating.slice(0, cloudRetentionPolicy.backups).map(item => item.path));
  for (const item of backups) {
    report.bytes.backups += item.bytes;
    if (item.purpose === 'manual' || item.purpose === 'legacy' && !includeLegacyBackups || latestBackups.has(item.path)) {
      protectedIds.add(item.buildId);
      report.kept.push({ ...item, reason: item.purpose === 'manual' ? '手工备份' : item.purpose === 'legacy' && !includeLegacyBackups ? '历史备份（显式 cleanup --apply 才轮转）' : '最近两份完整备份' });
    } else report.candidates.push(item);
  }
  releases.sort((a, b) => b.builtAt.localeCompare(a.builtAt) || b.name.localeCompare(a.name));
  if (unresolvedBackupReference) {
    report.warnings.push('存在无法确定来源版本的未完成备份，保留全部发布目录供人工核对');
    for (const item of releases) protectedIds.add(item.buildId);
  }
  const successful = new Set([activeId, ...backups.map(item => item.buildId)]);
  for (const item of releases) if (item.deployed) successful.add(item.buildId);
  for (const item of releases.filter(item => successful.has(item.buildId)).slice(0, cloudRetentionPolicy.releases)) protectedIds.add(item.buildId);
  for (const item of releases) {
    report.bytes.releases += item.bytes;
    if (!successful.has(item.buildId)) {
      protectedIds.add(item.buildId);
      report.kept.push({ ...item, reason: '没有成功部署记录，保留失败/准备现场' });
      continue;
    }
    if (protectedIds.has(item.buildId)) report.kept.push({ ...item, reason: '当前/最近版本、PM2 或保留备份引用' });
    else report.candidates.push(item);
  }
  report.protectedBuildIds = [...protectedIds].sort();
  if (report.blocked.length) { report.kept.push(...report.candidates.map(item => ({ ...item, reason: '部署保护：未清理' }))); report.candidates = []; }
  report.bytes.candidates = report.candidates.reduce((sum, item) => sum + item.bytes, 0);
  report.fingerprint = hash(JSON.stringify({ active, last, includeLegacyBackups, blocked: report.blocked, releases, backups, protectedIds: report.protectedBuildIds, candidates: report.candidates.map(item => item.path) }));
  return report;
}

async function saveQueue(shared, rows) {
  const path = join(shared, 'retired-sandbox-images.json'), temp = `${path}.next`;
  if (await stat(path)) await regular(path);
  // Exclusive creation also refuses stale or redirected intermediate files.
  await writeFile(temp, JSON.stringify({ format: 1, releases: rows }, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
export async function retiredCloudImages(root) {
  const path = join(root, 'shared', 'retired-sandbox-images.json');
  if (!await stat(path)) return [];
  const data = await json(path);
  if (data.format !== 1 || !Array.isArray(data.releases) || data.releases.some(item => !validBuildId(item?.buildId))) throw new Error('旧镜像清理记录无效');
  const result = [];
  for (const item of data.releases) if (!await stat(join(root, 'releases', item.buildId))) result.push(item);
  return result;
}
export async function applyCloudRetention(plan, options) {
  if (plan.blocked.length) throw new Error(plan.blocked.join('；'));
  const fresh = await inspectCloudRetention(options);
  if (fresh.fingerprint !== plan.fingerprint || fresh.blocked.length) throw new Error('清理预览后部署/文件状态已变化，请重新预览');
  const removed = [];
  const queuePath = join(plan.root, 'shared', 'retired-sandbox-images.json');
  const queue = await stat(queuePath) ? (await json(queuePath)) : { format: 1, releases: [] };
  if (queue.format !== 1 || !Array.isArray(queue.releases) || queue.releases.some(item => !validBuildId(item?.buildId))) throw new Error('旧镜像清理记录无效');
  const records = new Map(queue.releases.map(item => [item.buildId, item]));
  for (const item of fresh.candidates.filter(item => item.type === 'release')) if (item.receipt) records.set(item.buildId, { buildId: item.buildId, receipt: item.receipt });
  if (records.size) await saveQueue(join(plan.root, 'shared'), [...records.values()]);
  // Backups are removed first: a failure cannot remove a still-kept backup's code.
  for (const item of fresh.candidates) {
    const parent = item.type === 'backup' ? join(plan.root, 'shared', 'backups') : join(plan.root, 'releases');
    if (dirname(item.path) !== parent || resolve(parent, item.name) !== item.path || !item.path.startsWith(plan.root + sep)) throw new Error('清理路径越界');
    for (const path of [plan.root, join(plan.root, 'shared'), parent, item.path]) await directory(path);
    if (await stat(join(plan.root, 'shared', 'pending-deploy.json')) || await realpath(join(plan.root, 'current')) === item.path) throw new Error('部署状态已变化，停止清理');
    await rm(item.path, { recursive: true });
    removed.push(item);
  }
  // Remember the operator's explicit legacy rotation choice, so the two kept
  // historical backups subsequently age out together with new automatic ones.
  const policyPath = join(plan.root, 'shared', 'cloud-retention.json');
  if (fresh.includeLegacyBackups && !await stat(policyPath)) await writeFile(policyPath,
    JSON.stringify({ format: 1, rotateLegacyBackups: true }, null, 2), { flag: 'wx', mode: 0o600 });
  return removed;
}
