import { access, constants } from 'node:fs/promises';
import { Type } from '@sinclair/typebox';
import { db } from '@problemforge/database';
import { config, hashObject, problemAccess, contestAccess, HttpError, audit } from '@problemforge/domain';
import { SandboxClient } from '@problemforge/judge-adapter';
import type { Redis } from 'ioredis';
import { admin, authenticate, type Api } from '../app.ts';
import { buildAccess } from './builds.ts';

async function readiness(redis: Redis) {
  const checks: Record<string, string> = {};
  for (const [name, check] of Object.entries({ database: () => db.$queryRaw`SELECT 1`, redis: () => redis.ping(), storage: () => access(config.storageRoot, constants.R_OK | constants.W_OK), tex: () => new SandboxClient(config.sandboxUrl, config.sandboxToken).health(), judge: () => new SandboxClient(config.judgeSandboxUrl, config.judgeSandboxToken ?? '').health() })) {
    try { await check(); checks[name] = 'ok'; } catch { checks[name] = 'unavailable'; }
  }
  const workers = await db.workerHeartbeat.findMany({ where: { heartbeatAt: { gt: new Date(Date.now() - config.leaseMs) } }, select: { kind: true, heartbeatAt: true } }).catch(() => []);
  for (const kind of ['tex', 'judge']) checks[`${kind}Worker`] = workers.some(w => w.kind === kind) ? 'ok' : 'unavailable';
  return { status: Object.values(checks).every(v => v === 'ok') ? 'ok' : 'degraded', checks };
}
export async function operationsRoutes(app: Api, redis: Redis) {
  app.get('/api/live', async () => ({ status: 'ok', appName: config.appName }));
  app.get('/api/health', async (_, reply) => { const result = await readiness(redis); return reply.code(result.status === 'ok' ? 200 : 503).send({ status: result.status, appName: config.appName }); });
  app.get('/api/admin/operations', { preHandler: admin }, async () => {
    const health = await readiness(redis), stored = await db.storedObject.aggregate({ _sum: { bytes: true }, _count: true });
    return { ...health, storage: { bytes: Number(stored._sum.bytes ?? 0n), limit: config.storageQuotaBytes, objects: stored._count, pending: await db.storedObject.count({ where: { ready: false } }) }, tasks: { builds: await db.build.count({ where: { state: { in: ['QUEUED', 'RUNNING'] } } }), judge: await db.testRun.count({ where: { state: { in: ['QUEUED', 'RUNNING'] } } }) }, quotas: { buildsPerUser: config.buildQuota, judgePerUser: config.judgeQuota, attempts: config.maxAttempts, leaseSeconds: config.leaseMs / 1000 } };
  });
  app.get('/api/admin/audit', { preHandler: admin, schema: { querystring: Type.Object({ cursor: Type.Optional(Type.String({ maxLength: 100 })), action: Type.Optional(Type.String({ maxLength: 100 })) }, { additionalProperties: false }) } }, async req => {
    const rows = await db.auditLog.findMany({ where: { ...(req.query.action ? { action: req.query.action } : {}) }, ...(req.query.cursor ? { cursor: { id: req.query.cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 });
    return { rows, nextCursor: rows.length === 100 ? rows.at(-1)!.id : null };
  });
  // Store routes/status only. Passwords, CSRF/session tokens, bodies and public URLs stay out of audit records.
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url;
    if (!route || route === '/api/health' || route === '/api/live' || route === '/api/events') return;
    if (reply.statusCode >= 400 || !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      await audit(req.user?.id ?? null, reply.statusCode >= 400 ? 'HTTP_REJECTED' : 'HTTP_MUTATION', undefined, { method: req.method, route, status: reply.statusCode }).catch(e => app.log.error(e, 'Audit persistence failed'));
    }
  });
  const streams = new Map<string, number>(), closers = new Set<() => void>();
  app.addHook('preClose', async () => { for (const close of closers) close(); });
  const watchedIds = Type.Optional(Type.String({ maxLength: 6000, pattern: '^[A-Za-z0-9_-]+(,[A-Za-z0-9_-]+)*$' }));
  app.get('/api/events', { preHandler: authenticate, schema: { querystring: Type.Object({ problemId: Type.Optional(Type.String()), contestId: Type.Optional(Type.String()), buildIds: watchedIds, runIds: watchedIds }, { additionalProperties: false }) } }, async (req, reply) => {
    const { problemId, contestId } = req.query;
    const buildIds = req.query.buildIds?.split(',') ?? [], runIds = req.query.runIds?.split(',') ?? [];
    if (buildIds.length > 50 || runIds.length > 50) throw new HttpError(400, '每类最多关注 50 个历史任务');
    if (problemId && contestId) throw new HttpError(400, '一次只能订阅一个题目或比赛');
    const authorize = async () => { await authenticate(req); if (problemId) await problemAccess(req.user, problemId).catch(async e => { if (e instanceof HttpError && e.statusCode === 403) { const { problemPermission } = await import('@problemforge/domain'); await problemPermission(req.user, problemId); } else throw e; }); if (contestId) await contestAccess(req.user, contestId); };
    await authorize();
    if ((streams.get(req.user.id) ?? 0) >= 5) throw new HttpError(429, '实时连接过多，请关闭多余窗口');
    streams.set(req.user.id, (streams.get(req.user.id) ?? 0) + 1);
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    reply.raw.write('retry: 3000\n\n');
    let previous = String(req.headers['last-event-id'] ?? ''), busy = false, closed = false, ticks = 0;
    const close = () => { if (closed) return; closed = true; clearInterval(timer); closers.delete(close); streams.set(req.user.id, Math.max(0, (streams.get(req.user.id) ?? 1) - 1)); reply.raw.end(); };
    const tick = async () => {
      if (busy || closed) return; busy = true;
      try {
        await authorize();
        const builds = await db.build.findMany({ where: contestId ? { contestId } : problemId ? { problemId } : { requestedById: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
        const runs = contestId ? [] : await db.testRun.findMany({ where: problemId ? { problemId } : { requestedById: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
        const oldBuilds = await db.build.findMany({ where: { id: { in: buildIds.filter(id => !builds.some(b => b.id === id)) }, ...(contestId ? { contestId } : problemId ? { problemId } : { requestedById: req.user.id }) } });
        const oldRuns = contestId ? [] : await db.testRun.findMany({ where: { id: { in: runIds.filter(id => !runs.some(r => r.id === id)) }, ...(problemId ? { problemId } : { requestedById: req.user.id }) } });
        builds.push(...oldBuilds); runs.push(...oldRuns);
        const visibleBuilds = [], visibleRuns = [];
        for (const b of builds) { try { await buildAccess(req, b); visibleBuilds.push({ id: b.id, state: b.state, createdAt: b.createdAt, updatedAt: b.updatedAt, cacheSourceId: b.cacheSourceId }); } catch (e) { if (!(e instanceof HttpError)) throw e; } }
        for (const r of runs) { try { await problemAccess(req.user, r.problemId); visibleRuns.push({ id: r.id, state: r.state, accepted: r.accepted, completed: r.completed, total: r.total, stage: r.stage, createdAt: r.createdAt, updatedAt: r.updatedAt }); } catch (e) { if (!(e instanceof HttpError)) throw e; } }
        const data = { builds: visibleBuilds, runs: visibleRuns }, hash = hashObject(data);
        if (hash !== previous) { previous = hash; if (!reply.raw.write(`id: ${hash}\nevent: tasks\ndata: ${JSON.stringify(data)}\n\n`)) close(); }
        else if (++ticks % 7 === 0 && !reply.raw.write(': keepalive\n\n')) close();
      } catch (e) { reply.raw.write(`event: ${e instanceof HttpError ? 'access-revoked' : 'unavailable'}\ndata: {}\n\n`); close(); }
      finally { busy = false; }
    };
    const timer = setInterval(() => void tick(), 2000); timer.unref(); closers.add(close); reply.raw.on('close', close); await tick();
  });
}
