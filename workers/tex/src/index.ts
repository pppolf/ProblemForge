import { Worker } from 'bullmq';
import { db } from '@problemforge/database';
import { config, redisConnection, hashObject, sha256 } from '@problemforge/domain';
import { PrivateFileStorage } from '@problemforge/storage';
import { render, templateImage, POLICY_VERSION, TEX_PROFILE, ContentPolicyError, type TemplateFiles } from '@problemforge/template-engine';
import type { DocumentKind } from '@problemforge/contracts';
import { SandboxClient, InfrastructureError, GO_JUDGE_VERSION, type SandboxCommand } from '@problemforge/judge-adapter';

const sandbox = new SandboxClient(config.sandboxUrl, config.sandboxToken);
const storage = new PrivateFileStorage(config.storageRoot);
type Input = { kind: DocumentKind; body: string; mode?: 'single' | 'booklet'; metadata: { title: string; author: string }; files: TemplateFiles; templateHash: string; policy: string; toolchain: string; sandboxVersion: string; assets?: { path: string; key: string; hash: string; bytes: number }[] };
const worker = new Worker('tex', async job => {
  const id = (job.data as { buildId: string }).buildId;
  const build = await db.build.findUnique({ where: { id } });
  if (!build || ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(build.state)) return;
  // BullMQ owns the lease. A redelivered stalled job can resume its immutable input.
  const claimed = await db.build.updateMany({ where: { id, state: { in: ['QUEUED', 'RUNNING'] } }, data: { state: 'RUNNING', startedAt: new Date(), log: '' } });
  if (!claimed.count) return;
  const abort = new AbortController();
  const monitor = setInterval(async () => {
    try {
      const current = await db.build.findUnique({ where: { id }, select: { cancelRequested: true } });
      if (current?.cancelRequested) abort.abort();
    } catch { abort.abort(); }
  }, 500);
  let cacheIds: string[] = [];
  try {
    if (build.cancelRequested) { abort.abort(); throw new Error('任务已取消'); }
    const version = await db.templateVersion.findUnique({ where: { id: build.templateVersionId } });
    if (!version || version.state === 'REVOKED') throw new Error(`模板已撤回：${version?.reason ?? '版本不可用'}`);
    const input = build.input as unknown as Input;
    if (hashObject(build.input) !== build.inputHash || hashObject(input.files) !== input.templateHash) throw new Error('构建快照哈希不匹配');
    if (input.policy !== POLICY_VERSION || input.toolchain !== TEX_PROFILE || input.sandboxVersion !== GO_JUDGE_VERSION) throw new Error('构建策略或工具链与当前 Worker 不一致，需创建新构建');
    const assets = input.assets ?? [];
    const sources = render(input.files, input.kind, input.body, input.metadata, assets.map(a => a.path), input.mode);
    const copyIn: SandboxCommand['copyIn'] = Object.fromEntries(Object.entries(sources).map(([name, content]) => [name, { content }]));
    for (const [name, encoded] of Object.entries(input.files)) if (/\.(png|jpe?g)$/.test(name)) {
      const fileId = await sandbox.upload(name.split('/').at(-1)!, templateImage(encoded, name));
      cacheIds.push(fileId); copyIn[name] = { fileId };
    }
    for (const asset of assets) {
      const bytes = await storage.get(asset.key);
      if (bytes.length !== asset.bytes || sha256(bytes) !== asset.hash) throw new Error('资源快照哈希不匹配');
      const fileId = await sandbox.upload(asset.path.split('/').at(-1)!, bytes);
      cacheIds.push(fileId); copyIn[asset.path] = { fileId };
    }
    const cmd: SandboxCommand = {
      args: ['/usr/bin/latexmk', '-norc', '-xelatex', '-no-shell-escape', '-halt-on-error', '-interaction=nonstopmode', '-file-line-error', 'main.tex'],
      env: ['PATH=/usr/bin:/bin', 'HOME=/w', 'TMPDIR=/tmp', 'LANG=C.UTF-8', 'openin_any=p', 'openout_any=p', 'TEXMFOUTPUT=/w', 'TZ=UTC'],
      files: [{ content: '' }, { name: 'stdout', max: 262144 }, { name: 'stderr', max: 262144 }],
      cpuLimit: 30e9, clockLimit: 60e9, memoryLimit: 768 * 1024 * 1024, stackLimit: 64 * 1024 * 1024, procLimit: 32,
      copyIn,
      copyOut: ['main.log?'], copyOutCached: ['main.pdf?'], copyOutMax: 16 * 1024 * 1024,
    };
    const [result] = await sandbox.execute(cmd, abort.signal);
    cacheIds.push(...Object.values(result.fileIds ?? {}));
    const log = [result.files?.stdout, result.files?.stderr, result.files?.['main.log'], result.error, JSON.stringify(result.fileError ?? [])].filter(Boolean).join('\n').slice(0, 800000);
    const diagnostics = log.split('\n').filter(line => /Warning:|Overfull|Underfull|Missing character|Undefined control sequence|^\.\/.*:\d+:/.test(line)).slice(0, 100);
    const current = await db.build.findUniqueOrThrow({ where: { id } });
    if (current.cancelRequested || abort.signal.aborted) {
      await db.build.update({ where: { id }, data: { state: 'CANCELED', log, finishedAt: new Date() } }); return;
    }
    if (result.status === 'Internal Error') throw new InfrastructureError(`${result.error ?? '沙箱初始化失败'}\n${log}`);
    if (result.status !== 'Accepted' || result.exitStatus !== 0 || !result.fileIds?.['main.pdf']) {
      await db.build.update({ where: { id }, data: { state: 'FAILED', errorCode: 'TEX_COMPILE_FAILED', log: `go-judge: ${result.status}, exit=${result.exitStatus}\n${log}`, diagnostics, finishedAt: new Date() } }); return;
    }
    const pdf = await sandbox.download(result.fileIds['main.pdf']);
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('编译产物不是有效 PDF');
    const hash = sha256(pdf); const key = `builds/${id}/${hash}.pdf`;
    await storage.put(key, pdf);
    await db.$transaction(async tx => {
      const final = await tx.build.findUniqueOrThrow({ where: { id } });
      if (final.cancelRequested) { await tx.build.update({ where: { id }, data: { state: 'CANCELED', log, finishedAt: new Date() } }); return; }
      await tx.artifact.upsert({ where: { key }, create: { key, buildId: id, bytes: pdf.length, hash, mediaType: 'application/pdf' }, update: {} });
      await tx.build.update({ where: { id }, data: { state: 'SUCCEEDED', errorCode: null, log: `go-judge: ${result.status}; CPU ${Math.round(result.time / 1e6)} ms; 内存 ${Math.ceil(result.memory / 1048576)} MiB\n${log}`, diagnostics, finishedAt: new Date() } });
      if (build.purpose === 'TEMPLATE_VALIDATION') await tx.templateVersion.updateMany({
        where: { id: build.templateVersionId, hash: input.templateHash, state: { in: ['DRAFT', 'VALIDATED'] } },
        data: { state: 'VALIDATED', validationBuildId: id, validationBuildHash: input.templateHash },
      });
    });
  } catch (error) {
    const canceled = abort.signal.aborted;
    await db.build.update({ where: { id }, data: { state: canceled ? 'CANCELED' : 'FAILED', errorCode: canceled ? null : error instanceof InfrastructureError ? error.code : error instanceof ContentPolicyError ? 'CONTENT_POLICY' : 'BUILD_FAILED', log: (error as Error).message.slice(0, 800000), diagnostics: error instanceof ContentPolicyError ? error.issues : [], finishedAt: new Date() } });
  } finally {
    clearInterval(monitor);
    await Promise.allSettled(cacheIds.map(id => sandbox.delete(id)));
  }
}, { connection: redisConnection(true), prefix: 'problemforge', concurrency: Number(process.env.TEX_CONCURRENCY ?? 1), lockDuration: 90000, maxStalledCount: 1 });
worker.on('error', e => console.error('TeX Worker:', e.message));
worker.on('failed', async (job, error) => {
  if (job) await db.build.updateMany({ where: { id: job.data.buildId, state: { in: ['QUEUED', 'RUNNING'] } }, data: { state: 'FAILED', errorCode: 'WORKER_FAILED', log: error.message, finishedAt: new Date() } }).catch(console.error);
});
console.log('ProblemForge TeX Worker started; execution through Linux go-judge only.');
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, async () => { await worker.close(); await db.$disconnect(); process.exit(0); });
