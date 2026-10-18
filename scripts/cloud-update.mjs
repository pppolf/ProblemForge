import { access, lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyRelease } from './cloud-config.mjs';

const exists = async path => { try { await access(path); return true; } catch { return false; } };

export async function cloudSourceRevision(source, run) {
  const git = args => run('git', args, { cwd: source, capture: true, timeout: 10000 });
  const top = await git(['rev-parse', '--show-toplevel']);
  if (await realpath(resolve(top)) !== await realpath(source)) throw new Error('请在 Git 源码根目录运行 bash deploy.sh update');
  if (await git(['status', '--porcelain'])) throw new Error('源码目录有未提交改动；请先处理后再更新，脚本不会覆盖');
  const commit = await git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('无法确定当前 Git 提交');
  return commit;
}

export async function stageCloudUpdate(source, commit, run, node) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('无效 Git 提交');
  const buildId = `git-${commit}`;
  const stage = resolve(source, '.local', 'releases', `cloud-${buildId}`);
  const release = resolve(stage, 'problemforge');
  if (await exists(stage)) {
    if ((await lstat(stage)).isSymbolicLink() || await realpath(stage) !== stage) throw new Error('发布包目录不能为符号链接');
    if (!await exists(`${release}/cloud-release.json`)) throw new Error(`发现未完成的打包目录：${stage}；保留现场，尚未停止原站`);
  } else {
    await run(node, ['scripts/package-cloud.mjs', buildId, '--stage-only'], { cwd: source, timeout: 300000 });
  }
  if (await realpath(release) !== release) throw new Error('发布包目录不能为符号链接');
  const manifest = await verifyRelease(release);
  if (manifest.gitCommit !== commit || manifest.buildId !== buildId) throw new Error('发布包不对应当前 Git 提交');
  return { source: release, manifest };
}
