import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { db, Prisma } from '@problemforge/database';
import type { Queue } from 'bullmq';
import { config, HttpError, audit } from './index.ts';

export type TaskKind = 'tex' | 'judge';
export async function taskQuota(tx: Prisma.TransactionClient, userId: string, kind: TaskKind, count = 1) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
  const where = { requestedById: userId, state: { in: ['QUEUED', 'RUNNING'] as ('QUEUED' | 'RUNNING')[] } };
  const active = kind === 'tex' ? await tx.build.count({ where }) : await tx.testRun.count({ where });
  const limit = kind === 'tex' ? config.buildQuota : config.judgeQuota;
  if (active + count > limit) throw new HttpError(429, `每个用户同时排队/执行的 ${kind} 任务最多 ${limit} 个`, 'TASK_QUOTA');
}
export function checkRetry(count: number) {
  if (count + 1 >= config.maxAttempts) throw new HttpError(409, `同一快照最多执行 ${config.maxAttempts} 次；请修正原因后新建任务`, 'RETRY_LIMIT');
}
export async function claimTask(kind: TaskKind, id: string) {
  const leaseToken = randomUUID(), where = { id, state: 'QUEUED' as const, cancelRequested: false };
  const data = { state: 'RUNNING' as const, leaseToken, heartbeatAt: new Date(), startedAt: new Date() };
  const result = kind === 'tex' ? await db.build.updateMany({ where, data }) : await db.testRun.updateMany({ where, data });
  return result.count ? leaseToken : null;
}
export async function renewLease(kind: TaskKind, id: string, leaseToken: string) {
  // Cancellation is a request, not loss of ownership. The next monitor tick aborts
  // the sandbox; a request racing this heartbeat must not become LEASE_LOST.
  const where = { id, leaseToken, state: 'RUNNING' as const }, data = { heartbeatAt: new Date() };
  return (kind === 'tex' ? await db.build.updateMany({ where, data }) : await db.testRun.updateMany({ where, data })).count === 1;
}
// DB state is authoritative. Even a duplicate Redis delivery cannot own a running task.
export async function recoverTasks(kind: TaskKind, queue: Queue) {
  const cutoff = new Date(Date.now() - config.leaseMs);
  const where = { state: 'RUNNING' as const, OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, startedAt: { lt: cutoff } }] };
  const lost = kind === 'tex' ? await db.build.findMany({ where, take: 100 }) : await db.testRun.findMany({ where, take: 100 });
  for (const task of lost) {
    const guard = { id: task.id, state: 'RUNNING' as const, leaseToken: task.leaseToken, heartbeatAt: task.heartbeatAt };
    const data = { state: task.cancelRequested ? 'CANCELED' as const : 'FAILED' as const, leaseToken: null, finishedAt: new Date(), errorCode: task.cancelRequested ? null : 'WORKER_INTERRUPTED', log: `${task.log}\nWorker 租约到期；保留部分证据，请显式重试固定快照。`.slice(0, 800000) };
    const changed = kind === 'tex' ? await db.build.updateMany({ where: guard, data }) : await db.testRun.updateMany({ where: guard, data: { ...data, accepted: false, stage: 'Worker 失联，需显式重试' } });
    if (changed.count) await audit(null, 'TASK_LEASE_EXPIRED', task.id, { kind });
  }
  // Rotate by last reconciliation time, so a long offline queue cannot starve later jobs.
  const queued = kind === 'tex' ? await db.build.findMany({ where: { state: 'QUEUED' }, orderBy: { queuedAt: { sort: 'asc', nulls: 'first' } }, take: 50 }) : await db.testRun.findMany({ where: { state: 'QUEUED' }, orderBy: { queuedAt: { sort: 'asc', nulls: 'first' } }, take: 50 });
  for (const task of queued) {
    if (task.cancelRequested) {
      const data = { state: 'CANCELED' as const, finishedAt: new Date() };
      if (kind === 'tex') await db.build.updateMany({ where: { id: task.id, state: 'QUEUED' }, data });
      else await db.testRun.updateMany({ where: { id: task.id, state: 'QUEUED' }, data });
      continue;
    }
    const job = await queue.getJob(task.id), state = job ? await job.getState() : null;
    if (job && (state === 'completed' || state === 'failed')) await job.remove();
    if (!job || state === 'completed' || state === 'failed') await queue.add(kind, kind === 'tex' ? { buildId: task.id } : { runId: task.id }, { jobId: task.id });
    if (kind === 'tex') await db.build.updateMany({ where: { id: task.id, state: 'QUEUED' }, data: { queuedAt: new Date() } });
    else await db.testRun.updateMany({ where: { id: task.id, state: 'QUEUED' }, data: { queuedAt: new Date() } });
  }
}
export async function workerHeartbeat(kind: TaskKind) {
  const id = `${kind}-${hostname()}-${randomUUID()}`;
  const pulse = () => db.workerHeartbeat.upsert({ where: { id }, create: { id, kind }, update: { heartbeatAt: new Date() } });
  await pulse();
  const timer = setInterval(() => { pulse().catch(e => console.error('Worker heartbeat:', e.message)); }, Math.min(5000, config.leaseMs / 3)); timer.unref();
  return async () => { clearInterval(timer); await db.workerHeartbeat.deleteMany({ where: { id } }); };
}
