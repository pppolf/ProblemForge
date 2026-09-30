import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Worker } from 'bullmq';
import { db, Prisma } from '@problemforge/database';
import { config, root, redisConnection, hashObject, sha256 } from '@problemforge/domain';
import { PrivateFileStorage } from '@problemforge/storage';
import { SandboxClient, InfrastructureError } from '@problemforge/judge-adapter';
import { TESTLIB_HASH, type JudgeSnapshot } from '@problemforge/judge-core';
import { Executor, JudgeFailure } from './executor.ts';
import { pipeline, emptyReport } from './pipeline.ts';

if (!config.judgeSandboxToken || config.judgeSandboxToken === 'CHANGE_ME') throw new Error('请配置 JUDGE_SANDBOX_TOKEN；Judge Worker 不会使用宿主机执行');
const sandbox = new SandboxClient(config.judgeSandboxUrl, config.judgeSandboxToken);
const storage = new PrivateFileStorage(config.storageRoot);
const testlib = await readFile(resolve(root, 'vendor/testlib/testlib.h'));
if (sha256(testlib) !== TESTLIB_HASH) throw new Error('固定 testlib 头文件哈希不匹配');
const active = new Set<AbortController>();
const worker = new Worker('judge', async job => {
  const id = (job.data as { runId: string }).runId;
  const run = await db.testRun.findUnique({ where: { id } });
  if (!run || ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(run.state)) return;
  // A lost lease fails the interrupted attempt. Explicit retry creates a new run
  // with the old immutable input, without overwriting its partial evidence.
  if (run.state === 'RUNNING') {
    await db.testRun.updateMany({ where: { id, state: 'RUNNING' }, data: { state: 'FAILED', errorCode: 'WORKER_INTERRUPTED', stage: 'Worker 失联，需显式重试', finishedAt: new Date() } }); return;
  }
  if (!(await db.testRun.updateMany({ where: { id, state: 'QUEUED', cancelRequested: false }, data: { state: 'RUNNING', startedAt: new Date() } })).count) return;
  const input = run.input as unknown as JudgeSnapshot, abort = new AbortController(); active.add(abort);
  const executor = new Executor(id, sandbox, storage, abort.signal, testlib.toString('utf8')), report = emptyReport();
  let monitoring = false;
  const monitor = setInterval(async () => {
    if (monitoring) return; monitoring = true;
    try {
      const current = await db.testRun.findUnique({ where: { id }, select: { cancelRequested: true, state: true } });
      if (current?.cancelRequested || current?.state !== 'RUNNING') abort.abort('USER_CANCEL');
    } catch { abort.abort('DATABASE_UNAVAILABLE'); } finally { monitoring = false; }
  }, 250);
  const deadline = setTimeout(() => abort.abort('TASK_BUDGET'), input.budgetMs);
  try {
    if (hashObject(input) !== run.inputHash) throw new JudgeFailure('INPUT_HASH_MISMATCH', '任务输入清单哈希不匹配');
    await sandbox.health();
    const result = await pipeline(id, input, executor, report);
    await db.$transaction(async tx => {
      const current = await tx.testRun.findUniqueOrThrow({ where: { id } });
      if (current.state !== 'RUNNING') return;
      if (current.cancelRequested || abort.signal.aborted) throw new JudgeFailure('EXECUTION_ABORTED', '任务在提交结果前已取消');
      await tx.testRun.update({ where: { id }, data: { state: 'SUCCEEDED', accepted: result.accepted, report: report as unknown as Prisma.InputJsonValue, total: current.completed, stage: result.accepted === false ? '执行完成，验收未通过' : '执行完成', finishedAt: new Date() } });
    });
  } catch (e) {
    const reason = String(abort.signal.reason ?? ''), canceled = ['USER_CANCEL', 'WORKER_SHUTDOWN'].includes(reason);
    const code = reason === 'TASK_BUDGET' ? 'TASK_BUDGET_EXCEEDED' : reason === 'DATABASE_UNAVAILABLE' ? 'DATABASE_UNAVAILABLE' : e instanceof InfrastructureError ? e.code : e instanceof JudgeFailure ? e.code : 'JUDGE_FAILED';
    const previous = await db.testRun.findUnique({ where: { id }, select: { log: true } });
    await db.testRun.updateMany({ where: { id, state: 'RUNNING' }, data: {
      state: canceled ? 'CANCELED' : 'FAILED', errorCode: canceled ? null : code, accepted: false,
      report: report as unknown as Prisma.InputJsonValue, stage: canceled ? '已取消，沙箱进程已终止' : '执行失败',
      log: `${previous?.log ?? ''}\n${code}: ${(e as Error).message}`.slice(0, 200000), finishedAt: new Date(),
    } });
  } finally { clearInterval(monitor); clearTimeout(deadline); await executor.cleanup(); active.delete(abort); }
}, { connection: redisConnection(true), prefix: 'problemforge', concurrency: Number(process.env.JUDGE_CONCURRENCY ?? 1), lockDuration: 60000, maxStalledCount: 1 });
worker.on('error', e => console.error('Judge Worker:', e.message));
worker.on('failed', async (job, error) => {
  if (job) await db.testRun.updateMany({ where: { id: job.data.runId, state: { in: ['QUEUED', 'RUNNING'] } }, data: { state: 'FAILED', errorCode: 'WORKER_FAILED', log: error.message, stage: 'Worker 失败', finishedAt: new Date() } }).catch(console.error);
});
console.log('ProblemForge Judge Worker started; C++ / Python / testlib execute only through independent Linux go-judge.');
for (const event of ['SIGINT', 'SIGTERM'] as const) process.on(event, async () => {
  for (const controller of active) controller.abort('WORKER_SHUTDOWN');
  await worker.close(); await db.$disconnect(); process.exit(0);
});
