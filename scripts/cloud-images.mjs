import { readFile } from 'node:fs/promises';
import { digest, safeReleasePath } from './cloud-config.mjs';

const kinds = ['tex', 'judge'];
const imageId = value => /^sha256:[a-f0-9]{64}$/.test(value);
const tag = (kind, buildId) => `problemforge-${kind}:${buildId}`;

export async function sandboxRecipe(directory, manifest, kind) {
  if (!kinds.includes(kind)) throw new Error('未知沙箱类型');
  const files = new Map(manifest.files.map(file => [file.path, file.sha256]));
  const inputs = new Set([`infra/${kind}-sandbox.Dockerfile`, '.dockerignore']);
  const dockerfile = await readFile(`${directory}/infra/${kind}-sandbox.Dockerfile`, 'utf8');
  for (const line of dockerfile.split(/\r?\n/)) {
    const copy = /^\s*(?:COPY|ADD)\s+(.+)$/i.exec(line);
    if (!copy) continue;
    if (/\\\s*$/.test(line) || /--from=/.test(copy[1])) throw new Error('沙箱 COPY 输入需要明确的单行仓库路径');
    const parts = copy[1].replace(/^(?:--[\w-]+=\S+\s+)+/, '').trim().split(/\s+/);
    if (parts.length < 2) throw new Error('沙箱 COPY 输入不完整');
    for (const path of parts.slice(0, -1)) {
      if (!safeReleasePath(path) || /[\[\]"'$*?]/.test(path)) throw new Error('沙箱 COPY 输入需要明确的仓库路径');
      if (files.has(path)) inputs.add(path);
      else {
        const members = [...files.keys()].filter(file => file.startsWith(path.replace(/\/$/, '') + '/'));
        if (!members.length) throw new Error(`沙箱构建输入不在发布清单：${path}`);
        for (const member of members) inputs.add(member);
      }
    }
  }
  const hashes = [];
  for (const path of [...inputs].sort()) {
    const actual = digest(await readFile(`${directory}/${path}`));
    if (files.get(path) !== actual) throw new Error(`沙箱构建输入校验失败：${path}`);
    hashes.push([path, actual]);
  }
  return digest(JSON.stringify(hashes));
}

async function inspectImage(docker, name) {
  const found = (await docker(['image', 'ls', '--quiet', '--no-trunc', name])).trim();
  if (!found) return null;
  if (!imageId(found)) throw new Error(`无法确认镜像：${name}`);
  const id = (await docker(['image', 'inspect', name, '--format', '{{.Id}}'])).trim();
  if (!imageId(id) || id !== found) throw new Error(`镜像在检查期间变化：${name}`);
  return id;
}

async function runningSandboxImage(docker, kind, buildId) {
  const service = `${kind}-sandbox`;
  const id = (await docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=problemforge-cloud',
    '--filter', `label=com.docker.compose.service=${service}`])).trim();
  if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error(`${service} 必须恰有一个原站容器，停止复用镜像`);
  const format = '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"state":{{json .State.Status}},"image":{{json .Config.Image}},"imageId":{{json .Image}}}';
  const row = JSON.parse(await docker(['inspect', '--format', format, id]));
  if (row.project !== 'problemforge-cloud' || row.service !== service || row.state !== 'running' ||
      row.image !== tag(kind, buildId) || !imageId(row.imageId) || await inspectImage(docker, row.image) !== row.imageId) {
    throw new Error(`${service} 的归属或镜像与原站版本不一致，停止复用`);
  }
  return row.imageId;
}

// A receipt pins the actual image bytes, including dependencies installed by APT.
// Keep release tags for compatibility with the existing Compose/network checks.
export async function prepareCloudSandboxes({ directory, manifest, previous, receipt, docker, build, save, say }) {
  if (receipt && (receipt.format !== 1 || receipt.buildId !== manifest.buildId || !receipt.images || typeof receipt.images !== 'object' || Array.isArray(receipt.images) ||
      Object.keys(receipt.images).some(kind => !kinds.includes(kind)))) throw new Error('沙箱镜像记录无效');
  const result = receipt ? structuredClone(receipt) : { format: 1, buildId: manifest.buildId, images: {} };
  for (const kind of kinds) {
    const recipe = await sandboxRecipe(directory, manifest, kind);
    const target = tag(kind, manifest.buildId);
    const existing = await inspectImage(docker, target);
    if (result.images[kind]) {
      const recorded = result.images[kind];
      if (recorded.recipe !== recipe || !imageId(recorded.imageId) || existing !== recorded.imageId) throw new Error(`${kind} 已记录镜像发生变化，停止部署`);
      say(`复用本次已准备的 ${kind} 沙箱镜像。`);
      continue;
    }
    if (existing) throw new Error(`${target} 已存在但没有本次构建记录，停止覆盖`);
    let selected;
    if (previous && await sandboxRecipe(previous.path, previous.manifest, kind) === recipe) {
      selected = await runningSandboxImage(docker, kind, previous.manifest.buildId);
      await docker(['image', 'tag', selected, target]);
      if (await inspectImage(docker, target) !== selected) throw new Error(`${kind} 复用镜像校验失败`);
      say(`${kind} 沙箱构建输入未变，复用原站镜像。`);
    } else {
      say(`${kind} 沙箱构建输入有变化，构建该镜像。`);
      await build(`${kind}-sandbox`);
      selected = await inspectImage(docker, target);
      if (!selected) throw new Error(`${kind} 构建后没有生成目标镜像`);
    }
    result.images[kind] = { recipe, imageId: selected };
    await save(result);
  }
  return result;
}

// The caller supplies only releases it has already removed under the deployment
// lock. Never discover deletion candidates by a broad Docker name filter.
export async function cleanupCloudSandboxImages({ removedReleases, docker, say = () => {}, apply = false }) {
  const result = { removed: [], skipped: [], errors: [] };
  const warn = (entry, message) => {
    result.errors.push({ ...entry, message });
    say(`警告：旧沙箱镜像清理未完成${entry.tag ? `（${entry.tag}）` : ''}：${message}`);
  };
  if (!Array.isArray(removedReleases)) {
    warn({}, '已删除版本清单无效');
    return result;
  }
  const seen = new Set();
  for (const release of removedReleases) {
    const buildId = release?.buildId;
    if (typeof buildId !== 'string' || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(buildId)) {
      warn({}, '版本标识无效，保留镜像');
      continue;
    }
    const receipt = release.receipt;
    if (!receipt) {
      result.skipped.push({ buildId, reason: 'missing-receipt' });
      say(`保留 ${buildId} 的沙箱镜像：没有原镜像记录。`);
      continue;
    }
    if (receipt.format !== 1 || receipt.buildId !== buildId || !receipt.images || typeof receipt.images !== 'object' ||
        Array.isArray(receipt.images) || Object.entries(receipt.images).some(([kind, entry]) =>
          !kinds.includes(kind) || !entry || typeof entry !== 'object' || Array.isArray(entry) || !imageId(entry.imageId))) {
      warn({ buildId }, '原镜像记录无效，保留镜像');
      continue;
    }
    for (const kind of kinds) {
      const target = tag(kind, buildId);
      const entry = { buildId, kind, tag: target, imageId: receipt.images[kind]?.imageId };
      if (!entry.imageId) {
        result.skipped.push({ buildId, kind, tag: target, reason: 'missing-receipt' });
        continue;
      }
      if (seen.has(target)) continue;
      seen.add(target);
      try {
        const existing = await inspectImage(docker, target);
        if (!existing) {
          result.skipped.push({ ...entry, reason: 'absent' });
          continue;
        }
        if (existing !== entry.imageId) throw new Error('镜像标签与原记录不一致，保留镜像');
        // Include stopped and foreign containers. The ancestor filter may also
        // preserve descendants; retaining too much is safer than removing them.
        const containers = (await docker(['ps', '-aq', '--filter', `ancestor=${entry.imageId}`])).trim();
        if (containers) {
          result.skipped.push({ ...entry, reason: 'container-reference' });
          say(`保留 ${target}：仍有容器引用该镜像。`);
          continue;
        }
        if (apply !== true) {
          result.skipped.push({ ...entry, reason: 'preview' });
          say(`可清理旧沙箱镜像标签：${target}`);
          continue;
        }
        if (await inspectImage(docker, target) !== entry.imageId) throw new Error('镜像标签在清理前变化，保留镜像');
        // Remove the exact tag, never an image ID, --force, volumes or caches.
        await docker(['image', 'rm', target]);
        result.removed.push(entry);
        say(`已清理旧沙箱镜像标签：${target}`);
      } catch (error) {
        warn(entry, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return result;
}
