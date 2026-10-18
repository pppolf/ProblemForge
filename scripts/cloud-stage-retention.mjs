import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, rm, unlink } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { digest, verifyRelease } from './cloud-config.mjs';

const buildIdPattern = /^[a-z0-9][a-z0-9.-]{2,80}$/;
const optionalStat = async path => {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
async function plainDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error('目录不是原位普通目录');
}
async function plainFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error('文件不是原位普通文件');
  return stat;
}
async function fileDigest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function stageRoot(sourceRoot) {
  const source = resolve(sourceRoot);
  await plainDirectory(source);
  const local = resolve(source, '.local'), directory = resolve(local, 'releases');
  if (!await optionalStat(local)) return { sourceRoot: source, directory, exists: false };
  await plainDirectory(local);
  if (!await optionalStat(directory)) return { sourceRoot: source, directory, exists: false };
  await plainDirectory(directory);
  return { sourceRoot: source, directory, exists: true };
}

async function inspectStage(directory, name) {
  const buildId = name.slice('cloud-'.length), path = resolve(directory, name);
  if (!name.startsWith('cloud-') || !buildIdPattern.test(buildId) || dirname(path) !== directory) throw new Error('不是可识别的构建目录');
  await plainDirectory(path);
  const release = resolve(path, 'problemforge');
  await plainDirectory(release);
  const manifestPath = resolve(release, 'cloud-release.json');
  await plainFile(manifestPath);
  const manifest = await verifyRelease(release);
  if (manifest.buildId !== buildId) throw new Error('目录与部署包构建标识不一致');
  const releaseMetadata = JSON.parse(await readFile(resolve(release, 'release.json'), 'utf8'));
  if (releaseMetadata.buildId !== buildId || releaseMetadata.gitCommit !== manifest.gitCommit) throw new Error('部署包清单不一致');
  // verifyRelease checks every declared file. Also reject undeclared files,
  // directories and links so cleanup never absorbs someone else's additions.
  const files = new Set(['cloud-release.json', ...manifest.files.map(file => file.path)]), directories = new Set();
  for (const file of files) {
    const parts = file.split('/');
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  let bytes = 0;
  async function inventory(folder, prefix = '') {
    await plainDirectory(folder);
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const relative = prefix + entry.name, absolute = resolve(folder, entry.name);
      if (entry.isDirectory() && directories.has(relative)) await inventory(absolute, `${relative}/`);
      else if (entry.isFile() && files.has(relative)) bytes += (await plainFile(absolute)).size;
      else throw new Error('部署包包含清单外文件、目录或链接');
    }
  }
  await inventory(release);
  const fingerprints = [digest(await readFile(manifestPath))];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === 'problemforge') continue;
    if (entry.name !== 'source.tar' || !entry.isFile()) throw new Error('暂存目录包含未知内容');
    const archive = resolve(path, entry.name);
    bytes += (await plainFile(archive)).size;
    fingerprints.push(await fileDigest(archive));
  }
  const archiveName = `problemforge-caddy-pm2-${buildId}.tar.gz`;
  const archive = resolve(directory, archiveName), checksum = `${archive}.sha256`;
  const archives = [], archiveStat = await optionalStat(archive), checksumStat = await optionalStat(checksum);
  if (archiveStat || checksumStat) {
    if (!archiveStat || !checksumStat) throw new Error('运输压缩包或校验文件不完整');
    const size = (await plainFile(archive)).size + (await plainFile(checksum)).size;
    const checksumText = await readFile(checksum, 'utf8'), sha256 = await fileDigest(archive);
    if (checksumText !== `${sha256}  ${archiveName}\n`) throw new Error('运输压缩包校验失败');
    archives.push(archive, checksum);
    fingerprints.push(sha256, checksumText);
    bytes += size;
  }
  return { buildId, path, archives, bytes, fingerprint: digest(JSON.stringify(fingerprints)) };
}

export async function inspectCloudStages(sourceRoot, { protectedBuildIds = [] } = {}) {
  const root = await stageRoot(sourceRoot), candidates = [], retained = [], recognized = new Set();
  const protectedIds = new Set(protectedBuildIds);
  if (root.exists) {
    const entries = await readdir(root.directory, { withFileTypes: true });
    for (const entry of entries.filter(entry => entry.name.startsWith('cloud-'))) {
      const path = resolve(root.directory, entry.name), buildId = entry.name.slice('cloud-'.length);
      recognized.add(entry.name);
      if (protectedIds.has(buildId)) {
        retained.push({ path, reason: '受保护的当前或待完成构建' });
        for (const suffix of ['.tar.gz', '.tar.gz.sha256']) recognized.add(`problemforge-caddy-pm2-${buildId}${suffix}`);
        continue;
      }
      try {
        const candidate = await inspectStage(root.directory, entry.name);
        candidates.push(candidate);
        for (const archive of candidate.archives) recognized.add(basename(archive));
      } catch (error) { retained.push({ path, reason: error.message }); }
    }
    for (const entry of entries) if (!recognized.has(entry.name)) retained.push({ path: resolve(root.directory, entry.name), reason: '没有对应的可信完整暂存目录' });
  }
  return { sourceRoot: root.sourceRoot, directory: root.directory, candidates, retained };
}

export async function applyCloudStageRetention(plan, { protectedBuildIds = [] } = {}) {
  const latest = await inspectCloudStages(plan.sourceRoot, { protectedBuildIds });
  if (latest.directory !== plan.directory) throw new Error('暂存目录位置已变化');
  const requested = new Map(plan.candidates.map(candidate => [candidate.path, candidate]));
  const removed = [], retained = [...latest.retained];
  let reclaimedBytes = 0;
  for (const candidate of latest.candidates) {
    const prior = requested.get(candidate.path);
    if (!prior) continue;
    if (prior.fingerprint !== candidate.fingerprint) {
      retained.push({ path: candidate.path, reason: '扫描后内容已变化' });
      continue;
    }
    // Called while the deployment lock is held. Revalidate all parent paths
    // and the direct-child boundary immediately before recursive deletion.
    const root = await stageRoot(plan.sourceRoot);
    if (!root.exists || dirname(candidate.path) !== root.directory) throw new Error('暂存清理路径越界');
    await plainDirectory(candidate.path);
    for (const archive of candidate.archives) {
      if (dirname(archive) !== root.directory) throw new Error('运输压缩包清理路径越界');
      await plainFile(archive);
    }
    await rm(candidate.path, { recursive: true });
    for (const archive of candidate.archives) await unlink(archive);
    removed.push(candidate);
    reclaimedBytes += candidate.bytes;
  }
  return { removed, retained, reclaimedBytes };
}
