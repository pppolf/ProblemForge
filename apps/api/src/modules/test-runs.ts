import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import { TestRunInput } from '@problemforge/contracts';
import { db, Prisma, type TestRun } from '@problemforge/database';
import { audit, hashObject, HttpError, judgeQueue, problemAccess, sha256 } from '@problemforge/domain';
import type { JudgeSnapshot, BlobRef } from '@problemforge/judge-core';
import { authenticate, storage, type Api } from '../app.ts';
import { dependencyHash, judgeSnapshot, validateJudgeSnapshot } from './judge-snapshot.ts';
import { appendTest, lockProblem, touchProblem } from './judge-data.ts';

const Id = Type.Object({ id: Type.String() });
const queue = judgeQueue(); queue.on('error', e => console.error('Judge queue:', e.message));
async function enqueue(id: string) {
  try {
    await queue.add('judge', { runId: id }, { jobId: id });
    await db.testRun.updateMany({ where: { id, state: 'QUEUED' }, data: { queuedAt: new Date() } });
  } catch (e) { await db.testRun.updateMany({ where: { id, state: 'QUEUED' }, data: { log: `入队暂未完成：${(e as Error).message}\n数据库保留任务，后台会重试入队。` } }); }
}
async function runAccess(user: { id: string; role: string }, id: string, write = false) {
  const run = await db.testRun.findUnique({ where: { id } });
  if (!run) throw new HttpError(404, '验收任务不存在'); await problemAccess(user, run.problemId, write); return run;
}
async function currentDependency(run: TestRun, tx: Prisma.TransactionClient = db) {
  const input = run.input as unknown as JudgeSnapshot;
  return dependencyHash(await judgeSnapshot(tx, run.problemId, run.purpose, input.programId, input.budgetMs));
}
async function view(run: TestRun, includeInput = false) {
  const stale = await db.$transaction(tx => currentDependency(run, tx).then(hash => hash !== run.dependencyHash), { isolationLevel: 'RepeatableRead' });
  const input = run.input as unknown as JudgeSnapshot;
  return { ...run, input: includeInput ? input : {
    programs: input.programs.map(p => ({ id: p.id, name: p.name, version: p.version, role: p.role, revisionId: p.revisionId, profile: { name: p.profile.name, version: p.profile.version } })),
    tests: input.tests.map(t => ({ ref: t.ref, number: t.number, groupName: t.groupName, version: t.version })),
    plans: input.plans.map(p => ({ id: p.id, name: p.name, version: p.version, count: p.count, seed: p.seed })), policy: input.policy, toolchain: input.toolchain,
  }, stale, currentValid: !stale && run.state === 'SUCCEEDED' && run.accepted === true };
}
async function quota(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  if (await tx.testRun.count({ where: { requestedById: userId, state: { in: ['QUEUED', 'RUNNING'] } } }) >= 3) throw new HttpError(429, '每个用户最多同时排队/执行三个 Judge 任务');
}
function sameSubmission(run: TestRun, problemId: string, request: { purpose: string; programId?: string; budgetMs?: number }) {
  const input = run.input as unknown as JudgeSnapshot;
  if (run.problemId !== problemId || run.purpose !== request.purpose || input.programId !== request.programId || input.budgetMs !== (request.budgetMs ?? 300000)) throw new HttpError(409, '同一提交键已用于另一个任务');
  return run;
}
export async function testRunRoutes(app: Api) {
  const reconcile = setInterval(async () => {
    try { for (const run of await db.testRun.findMany({ where: { state: 'QUEUED', queuedAt: null }, take: 20 })) await enqueue(run.id); } catch (e) { app.log.error(e); }
  }, 5000); reconcile.unref();
  app.addHook('onClose', async () => { clearInterval(reconcile); await queue.close(); });
  app.post('/api/problems/:id/test-runs', { preHandler: authenticate, schema: { params: Id, body: TestRunInput, tags: ['Judge 任务'] } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    if (req.body.purpose !== 'COMPILE' && req.body.programId) throw new HttpError(422, '仅编译任务接受单个 programId，验收按本题启用程序快照执行');
    const requestKey = sha256(`${req.user.id}:${req.body.requestKey}`);
    const old = await db.testRun.findUnique({ where: { requestKey } });
    if (old) return view(sameSubmission(old, req.params.id, req.body));
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.id} FOR UPDATE`;
      const existing = await tx.testRun.findUnique({ where: { requestKey } }); if (existing) return sameSubmission(existing, req.params.id, req.body);
      await quota(tx, req.user.id); await lockProblem(tx, req.params.id);
      const input = await judgeSnapshot(tx, req.params.id, req.body.purpose, req.body.programId, req.body.budgetMs);
      validateJudgeSnapshot(input);
      return tx.testRun.create({ data: { requestedById: req.user.id, problemId: req.params.id, purpose: req.body.purpose, requestKey, input: input as unknown as Prisma.InputJsonValue, inputHash: hashObject(input), dependencyHash: dependencyHash(input) } });
    });
    await enqueue(result.id); await audit(req.user.id, 'CREATE_TEST_RUN', result.id, { purpose: result.purpose }); return view(result);
  });
  app.get('/api/test-runs', { preHandler: authenticate, schema: { querystring: Type.Object({ problemId: Type.Optional(Type.String()) }, { additionalProperties: false }) } }, async req => {
    if (req.query.problemId) await problemAccess(req.user, req.query.problemId);
    const runs = await db.testRun.findMany({ where: req.query.problemId ? { problemId: req.query.problemId } : { requestedById: req.user.id }, orderBy: { createdAt: 'desc' }, take: 50 });
    const visible = [];
    for (const run of runs) { try { await problemAccess(req.user, run.problemId); visible.push(await view(run)); } catch (e) { if (!(e instanceof HttpError)) throw e; } }
    return visible;
  });
  app.get('/api/test-runs/:id', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const run = await runAccess(req.user, req.params.id);
    const cases = await db.runCase.findMany({ where: { runId: run.id }, orderBy: [{ number: 'asc' }, { id: 'asc' }] });
    const invocations = await db.invocation.findMany({ where: { runId: run.id }, orderBy: { createdAt: 'asc' } });
    return { ...await view(run, true), cases: cases.map(c => ({ ...c, inputKey: undefined, answerKey: undefined })), invocations: invocations.map(i => ({ ...i, stdoutKey: undefined, stderrKey: undefined })) };
  });
  app.post('/api/test-runs/:id/cancel', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const run = await runAccess(req.user, req.params.id, true);
    await db.testRun.updateMany({ where: { id: run.id, state: 'QUEUED' }, data: { state: 'CANCELED', cancelRequested: true, finishedAt: new Date(), stage: '已取消' } });
    await db.testRun.updateMany({ where: { id: run.id, state: 'RUNNING' }, data: { cancelRequested: true } });
    await audit(req.user.id, 'CANCEL_TEST_RUN', run.id); return { ok: true };
  });
  app.post('/api/test-runs/:id/retry', { preHandler: authenticate, schema: { params: Id, body: Type.Object({ requestKey: TestRunInput.properties.requestKey }, { additionalProperties: false }) } }, async req => {
    const old = await runAccess(req.user, req.params.id, true);
    if (!['FAILED', 'CANCELED'].includes(old.state)) throw new HttpError(409, '只有失败或取消任务可以重试；当前数据验收请新建任务');
    const input = old.input as unknown as JudgeSnapshot;
    for (const p of input.programs) if (!(await db.compileProfile.findUnique({ where: { id: p.profile.id } }))?.enabled) throw new HttpError(409, '原任务 profile 已停用，请更新配置后新建任务');
    const requestKey = sha256(`${req.user.id}:retry:${req.body.requestKey}`);
    const result = await db.$transaction(async tx => {
      const existing = await tx.testRun.findUnique({ where: { requestKey } });
      if (existing) { if (existing.inputHash !== old.inputHash || existing.problemId !== old.problemId) throw new HttpError(409, '同一提交键已用于另一个重试'); return existing; }
      await quota(tx, req.user.id);
      return tx.testRun.create({ data: { problemId: old.problemId, requestedById: req.user.id, purpose: old.purpose, input: old.input!, inputHash: old.inputHash, dependencyHash: old.dependencyHash, requestKey } });
    });
    await enqueue(result.id); return view(result);
  });
  app.get('/api/test-runs/:id/cases/:caseId/:file', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String(), caseId: Type.String(), file: Type.Union([Type.Literal('input'), Type.Literal('answer')]) }) } }, async (req, reply) => {
    const run = await runAccess(req.user, req.params.id);
    const c = await db.runCase.findFirst({ where: { id: req.params.caseId, runId: run.id } });
    const key = c && (req.params.file === 'input' ? c.inputKey : c.answerKey);
    if (!key) throw new HttpError(404, '该任务数据/答案不存在');
    return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="${c!.number}.${req.params.file === 'input' ? 'in' : 'ans'}"`).send(await storage.get(key));
  });
  app.get('/api/invocations/:id/:file', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String(), file: Type.Union([Type.Literal('stdout'), Type.Literal('stderr'), Type.Literal('output')]) }) } }, async (req, reply) => {
    const invocation = await db.invocation.findUnique({ where: { id: req.params.id }, include: { run: true } });
    if (!invocation) throw new HttpError(404, '执行记录不存在'); await problemAccess(req.user, invocation.run.problemId);
    const detail = invocation.detail as { output?: { key: string } | null; judgedOutput?: { key: string } | null };
    const key = req.params.file === 'output' ? (detail.judgedOutput ?? detail.output)?.key : req.params.file === 'stdout' ? invocation.stdoutKey : invocation.stderrKey;
    if (!key) throw new HttpError(404, '输出不存在');
    return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="${invocation.id}.${req.params.file}.txt"`).send(await storage.get(key));
  });
  app.post('/api/test-runs/:id/apply-data', { preHandler: authenticate, schema: { params: Id, body: Type.Object({ caseIds: Type.Array(Type.String(), { minItems: 1, maxItems: 200, uniqueItems: true }) }, { additionalProperties: false }) } }, async req => {
    const run = await runAccess(req.user, req.params.id, true);
    if (run.state !== 'SUCCEEDED' || !['GENERATE', 'ANSWERS', 'ACCEPTANCE'].includes(run.purpose)) throw new HttpError(409, '只能从成功的生成/答案/验收任务显式收集数据');
    const selected = await db.runCase.findMany({ where: { runId: run.id, id: { in: req.body.caseIds } } });
    if (selected.length !== req.body.caseIds.length) throw new HttpError(422, '所选数据不属于此任务');
    const ids = await db.$transaction(async tx => {
      await lockProblem(tx, run.problemId);
      if (await currentDependency(run, tx) !== run.dependencyHash) throw new HttpError(409, '任务快照已过期，请按当前版本重新执行后收集数据');
      const result: string[] = [];
      for (const c of selected) {
        const origin = c.origin as { type: string; testId?: string; testRevisionId?: string };
        const input: BlobRef = { key: c.inputKey, hash: c.inputHash, bytes: c.inputBytes };
        const answer: BlobRef | null = c.answerKey ? { key: c.answerKey, hash: c.answerHash!, bytes: c.answerBytes! } : null;
        if (origin.type === 'TEST') {
          const current = await tx.testCase.findUnique({ where: { id: origin.testId! } });
          if (!current || current.currentRevisionId !== origin.testRevisionId || !answer) throw new HttpError(409, '原始数据版本已改变或此任务未生成答案');
          result.push(await appendTest(tx, run.problemId, { number: current.number, groupName: current.groupName, isSample: current.isSample, enabled: current.enabled, notes: current.notes }, input, answer, { ...c.origin as object, answerRunId: run.id }, { id: current.id, version: current.version }));
        } else if (origin.type === 'GENERATOR') {
          result.push(await appendTest(tx, run.problemId, { number: c.number, groupName: c.groupName, isSample: c.isSample, enabled: true, notes: '从生成快照显式收集' }, input, answer, { ...c.origin as object, runId: run.id }));
        } else throw new HttpError(422, '不支持的数据来源');
      }
      await touchProblem(tx, run.problemId); return result;
    }, { timeout: 15000 });
    await audit(req.user.id, 'APPLY_RUN_DATA', run.id, { testIds: ids }); return { testIds: ids };
  });
}
