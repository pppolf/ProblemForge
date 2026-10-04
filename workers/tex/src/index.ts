import { Worker } from 'bullmq';
import { db } from '@problemforge/database';
import { config, redisConnection, hashObject, sha256, ManagedStorage, claimTask, renewLease, workerHeartbeat } from '@problemforge/domain';
import { PrivateFileStorage } from '@problemforge/storage';
import { render, renderContest, CONTEST_RENDERER_VERSION, type ContestRenderInput, templateImage, printableSample, POLICY_VERSION, TEX_PROFILE, SAMPLE_RENDERER_VERSION, STATEMENT_RENDERER_VERSION, type StatementSettings, ContentPolicyError, type TemplateFiles } from '@problemforge/template-engine';
import type { DocumentKind } from '@problemforge/contracts';
import { SandboxClient, InfrastructureError, GO_JUDGE_VERSION, type SandboxCommand } from '@problemforge/judge-adapter';

const sandbox = new SandboxClient(config.sandboxUrl, config.sandboxToken);
const storage = new ManagedStorage(config.storageRoot);
type Input = { kind: DocumentKind; body: string; mode?: 'single' | 'booklet' | 'contest';contest?:ContestRenderInput;contestRendererVersion?:string; metadata: { title: string; author: string }; files: TemplateFiles; templateHash: string; policy: string; toolchain: string; sandboxVersion: string; sampleRendererVersion?: string; statementSettings?: StatementSettings; statementRendererVersion?: string; assets?: { path: string; key: string; hash: string; bytes: number }[]; samples?: { revisionId: string; inputPath: string; answerPath: string; input: { key: string; hash: string; bytes: number }; answer: { key: string; hash: string; bytes: number } }[] };
const stopHeartbeat=await workerHeartbeat('tex');
const active=new Set<AbortController>();
const worker = new Worker('tex', async job => {
  const id = (job.data as { buildId: string }).buildId;
  const build = await db.build.findUnique({ where: { id } });
  if (!build || ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(build.state)) return;
  const leaseToken=await claimTask('tex',id);if(!leaseToken)return;
  const abort = new AbortController(); active.add(abort); let monitoring=false;
  const monitor = setInterval(async () => {
    if(monitoring)return;monitoring=true;
    try {
      const current=await db.build.findUnique({where:{id},select:{cancelRequested:true}});
      if(current?.cancelRequested)abort.abort('USER_CANCEL');
      else if(!await renewLease('tex',id,leaseToken))abort.abort('LEASE_LOST');
    } catch { abort.abort('DATABASE_UNAVAILABLE'); } finally { monitoring=false; }
  }, 1000);
  const finishPdf=async(pdf:Buffer,log:string,diagnostics:string[],cacheSourceId:string|null=null)=>{
    const hash=sha256(pdf),key=`builds/${id}/${hash}.pdf`;await storage.put(key,pdf);
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Build" WHERE id=${id} FOR UPDATE`;
      const current=await tx.build.findUniqueOrThrow({where:{id}});
      if(current.state!=='RUNNING'||current.leaseToken!==leaseToken)return;
      if(current.cancelRequested||['USER_CANCEL','WORKER_SHUTDOWN'].includes(String(abort.signal.reason))){await tx.build.update({where:{id},data:{state:'CANCELED',log,finishedAt:new Date()}});return;}
      if(abort.signal.aborted)throw new InfrastructureError(`任务执行中断：${String(abort.signal.reason)}`);
      await tx.artifact.upsert({where:{key},create:{key,buildId:id,bytes:pdf.length,hash,mediaType:'application/pdf'},update:{}});
      await tx.build.update({where:{id},data:{state:'SUCCEEDED',errorCode:null,cacheSourceId,log,diagnostics,finishedAt:new Date()}});
      if(build.purpose==='TEMPLATE_VALIDATION')await tx.templateVersion.updateMany({where:{id:build.templateVersionId,hash:(build.input as Input).templateHash,state:{in:['DRAFT','VALIDATED']}},data:{state:'VALIDATED',validationBuildId:id,validationBuildHash:(build.input as Input).templateHash}});
    });
  };
  let cacheIds: string[] = [];
  try {
    if (build.cancelRequested) { abort.abort('USER_CANCEL'); throw new Error('任务已取消'); }
    const version = await db.templateVersion.findUnique({ where: { id: build.templateVersionId } });
    if (!version || version.state === 'REVOKED') throw new Error(`模板已撤回：${version?.reason ?? '版本不可用'}`);
    const input = build.input as unknown as Input;
    if (hashObject(build.input) !== build.inputHash || hashObject(input.files) !== input.templateHash) throw new Error('构建快照哈希不匹配');
    if (input.policy !== POLICY_VERSION || input.toolchain !== TEX_PROFILE || input.sandboxVersion !== GO_JUDGE_VERSION) throw new Error('构建策略或工具链与当前 Worker 不一致，需创建新构建');
    if (input.kind === 'STATEMENT' && input.mode !== 'contest' && (input.statementRendererVersion !== STATEMENT_RENDERER_VERSION || !input.statementSettings)) throw new Error('题面时空限制渲染版本与当前 Worker 不一致，请创建新构建');
    if (input.samples?.length && input.sampleRendererVersion !== SAMPLE_RENDERER_VERSION) throw new Error('样例渲染版本与当前 Worker 不一致，需创建新构建');
    const assets = input.assets ?? [];
    if(input.mode==='contest'&&(!input.contest||input.contestRendererVersion!==CONTEST_RENDERER_VERSION))throw new Error('比赛渲染版本与当前 Worker 不一致，请新建构建');
    if(build.purpose!=='TEMPLATE_VALIDATION'){
      const cached=await db.build.findFirst({where:{id:{not:id},state:'SUCCEEDED',inputHash:build.inputHash,problemId:build.problemId,contestId:build.contestId,documentId:build.documentId,purpose:build.purpose},include:{artifacts:true},orderBy:{finishedAt:'desc'}});
      const artifact=cached?.artifacts[0];
      if(artifact){let pdf:Buffer|undefined;try{pdf=await storage.get(artifact.key);if(sha256(pdf)!==artifact.hash||pdf.length!==artifact.bytes)pdf=undefined;}catch{}if(pdf){await finishPdf(pdf,`缓存命中：复用固定构建 ${cached!.id}；内容、模板、工具链和渲染策略哈希相同。\n本次未重新编译。`,[],cached!.id);return;}}
    }
    const sources = input.mode==='contest'?renderContest(input.files,input.kind,input.contest!):render(input.files, input.kind, input.body, input.metadata, assets.map(a => a.path), input.mode, input.samples, input.statementSettings);
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
    for (const sample of input.samples ?? []) for (const [path, ref] of [[sample.inputPath, sample.input], [sample.answerPath, sample.answer]] as const) {
      const bytes = await storage.get(ref.key);
      if (bytes.length !== ref.bytes || sha256(bytes) !== ref.hash) throw new Error('样例数据快照哈希不匹配');
      printableSample(bytes);
      const fileId = await sandbox.upload(path.split('/').at(-1)!, bytes);
      cacheIds.push(fileId); copyIn[path] = { fileId };
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
    if (current.cancelRequested || ['USER_CANCEL','WORKER_SHUTDOWN'].includes(String(abort.signal.reason))) {
      await db.build.updateMany({ where: { id,state:'RUNNING',leaseToken }, data: { state: 'CANCELED', log, finishedAt: new Date() } }); return;
    }
    if (abort.signal.aborted) throw new InfrastructureError(`任务执行中断：${String(abort.signal.reason)}`);
    if (result.status === 'Internal Error') throw new InfrastructureError(`${result.error ?? '沙箱初始化失败'}\n${log}`);
    if (result.status !== 'Accepted' || result.exitStatus !== 0 || !result.fileIds?.['main.pdf']) {
      await db.build.updateMany({ where: { id,state:'RUNNING',leaseToken }, data: { state: 'FAILED', errorCode: 'TEX_COMPILE_FAILED', log: `go-judge: ${result.status}, exit=${result.exitStatus}\n${log}`, diagnostics, finishedAt: new Date() } }); return;
    }
    const pdf = await sandbox.download(result.fileIds['main.pdf']);
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('编译产物不是有效 PDF');
    await finishPdf(pdf,`go-judge: ${result.status}; CPU ${Math.round(result.time / 1e6)} ms; 内存 ${Math.ceil(result.memory / 1048576)} MiB\n${log}`,diagnostics);
  } catch (error) {
    const canceled = ['USER_CANCEL','WORKER_SHUTDOWN'].includes(String(abort.signal.reason));
    await db.build.updateMany({ where: { id,state:'RUNNING',leaseToken }, data: { state: canceled ? 'CANCELED' : 'FAILED', errorCode: canceled ? null : error instanceof InfrastructureError ? error.code : error instanceof ContentPolicyError ? 'CONTENT_POLICY' : 'BUILD_FAILED', log: (error as Error).message.slice(0, 800000), diagnostics: error instanceof ContentPolicyError ? error.issues : [], finishedAt: new Date() } });
  } finally {
    clearInterval(monitor); active.delete(abort);
    await Promise.allSettled(cacheIds.map(id => sandbox.delete(id)));
  }
}, { connection: redisConnection(true), prefix: 'problemforge', concurrency: Number(process.env.TEX_CONCURRENCY ?? 1), lockDuration: 90000, maxStalledCount: 1 });
worker.on('error', e => console.error('TeX Worker:', e.message));
worker.on('failed', async (job, error) => {
  console.error('TeX queue delivery failed:',job?.id,error.message); // DB lease recovery owns terminal state.
});
console.log('ProblemForge TeX Worker started; execution through Linux go-judge only.');
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, async () => { for(const abort of active)abort.abort('WORKER_SHUTDOWN'); await worker.close(); await stopHeartbeat(); await db.$disconnect(); process.exit(0); });
