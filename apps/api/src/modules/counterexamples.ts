import { Type } from '@sinclair/typebox';
import { TestRunInput, TestCaseInput } from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { audit, hashObject, HttpError, sha256 } from '@problemforge/domain';
import type { JudgeSnapshot } from '@problemforge/judge-core';
import { authenticate, type Api } from '../app.ts';
import { currentDependency, enqueue, quota, runAccess, view } from './test-runs.ts';
import { appendTest, lockProblem, publicTest, MAX_TEST_BYTES } from './judge-data.ts';
import { dependencyHash } from './judge-snapshot.ts';
const Params = Type.Object({ id: Type.String(), caseId: Type.String() });
export async function counterexampleRoutes(app: Api) {
  app.post('/api/test-runs/:id/cases/:caseId/reproduce', { preHandler: authenticate, schema: { params: Params, body: Type.Object({ requestKey: TestRunInput.properties.requestKey, regenerate: Type.Boolean() }, { additionalProperties: false }) } }, async req => {
    const old = await runAccess(req.user, req.params.id, true);
    const c = await db.runCase.findFirst({ where: { id: req.params.caseId, runId: old.id } });
    const origin = c?.origin as { type: string; seed: string; verdict: string } | undefined;
    const original = old.input as unknown as JudgeSnapshot;
    if (!c || !c.answerKey || origin?.type !== 'COUNTEREXAMPLE' || !original.stress) throw new HttpError(422, '请选择已保存的反例');
    for (const p of original.programs) if (!(await db.compileProfile.findUnique({ where: { id: p.profile.id } }))?.enabled) throw new HttpError(409, '原执行 profile 已停用');
    const input: JudgeSnapshot = { ...original, purpose: 'REPLAY', replay: { sourceRunId: old.id, sourceCaseId: c.id, input: { key: c.inputKey, hash: c.inputHash, bytes: c.inputBytes }, answer: { key: c.answerKey, hash: c.answerHash!, bytes: c.answerBytes! }, seed: origin.seed, verdict: origin.verdict, regenerate: req.body.regenerate } };
    const requestKey = sha256(`${req.user.id}:replay:${req.body.requestKey}`), inputHash = hashObject(input);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.id} FOR UPDATE`;
      const existing = await tx.testRun.findUnique({ where: { requestKey } });
      if (existing) { if (existing.inputHash !== inputHash) throw new HttpError(409, '同一提交键已用于另一个复现'); return existing; }
      await quota(tx, req.user.id);
      return tx.testRun.create({ data: { problemId: old.problemId, requestedById: req.user.id, purpose: 'REPLAY', input: input as unknown as Prisma.InputJsonValue, inputHash, dependencyHash: dependencyHash(input), requestKey } });
    });
    await enqueue(result.id); await audit(req.user.id, 'REPRODUCE_COUNTEREXAMPLE', c.id, { runId: result.id }); return view(result);
  });
  app.post('/api/test-runs/:id/cases/:caseId/apply-counterexample', { preHandler: authenticate, schema: { params: Params, body: Type.Object({ number: TestCaseInput.properties.number, groupName: TestCaseInput.properties.groupName, allowDuplicate: Type.Boolean() }, { additionalProperties: false }) } }, async req => {
    const run = await runAccess(req.user, req.params.id, true);
    const c = await db.runCase.findFirst({ where: { id: req.params.caseId, runId: run.id } });
    const origin = c?.origin as { type?: string } | undefined;
    if (!c?.answerKey || origin?.type !== 'COUNTEREXAMPLE' || !['STRESS', 'REPLAY'].includes(run.purpose)) throw new HttpError(422, '请选择已完成校验和判定的反例');
    if (c.inputBytes > MAX_TEST_BYTES || c.answerBytes! > MAX_TEST_BYTES) throw new HttpError(422, '反例输入或答案超过正式数据的 1 MiB 限制；原反例保留');
    const id = await db.$transaction(async tx => {
      await lockProblem(tx, run.problemId);
      if (await currentDependency(run, tx) !== run.dependencyHash) throw new HttpError(409, '反例相关程序或判题配置已改变；请按当前版本重新对拍');
      const duplicates = await tx.testCase.findMany({ where: { problemId: run.problemId, currentRevision: { inputHash: c.inputHash } }, select: { number: true } });
      if (duplicates.length && !req.body.allowDuplicate) throw new HttpError(409, '输入与正式数据重复，确认后可保留重复数据', 'DUPLICATE_INPUT', duplicates);
      return appendTest(tx, run.problemId, { number: req.body.number, groupName: req.body.groupName, isSample: false, enabled: true, notes: '由对拍反例显式加入' }, { key: c.inputKey, hash: c.inputHash, bytes: c.inputBytes }, { key: c.answerKey!, hash: c.answerHash!, bytes: c.answerBytes! }, { ...c.origin as object, runId: run.id, sourceCaseId: c.id, inputHash: run.inputHash });
    });
    await audit(req.user.id, 'APPLY_COUNTEREXAMPLE', c.id, { testId: id }); return publicTest(id);
  });
}
