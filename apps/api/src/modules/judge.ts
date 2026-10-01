import { Type } from '@sinclair/typebox';
import { randomUUID } from 'node:crypto';
import {
  JudgeSettingsInput, defaultJudgeSettings, ProfileInput, ProfileUpdateInput, ProgramInput, ProgramUpdateInput,
  TestCaseInput, TestCaseUpdateInput, TestZipInput, GeneratorPlanInput, GeneratorPlanUpdateInput, ToolSelfTestInput, ToolSelfTestUpdateInput, generatorPlanCommands, generatorPlanProgramIds,
  type ProgramSave, type GeneratorPlanSave, type ToolSelfTestSave, type JudgeSettingsValue, type TestGroupsValue,
} from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { audit, hashObject, HttpError, problemAccess, sha256 } from '@problemforge/domain';
import { testlibRoles } from '@problemforge/judge-core';
import { readTestArchive, ArchiveError } from '@problemforge/judge-core/archive';
import { admin, authenticate, storage, type Api } from '../app.ts';
import { builtinProfiles } from './judge-snapshot.ts';
import { appendTest, lockProblem, publicTest, rawBytes, saveBlob, touchProblem } from './judge-data.ts';
import { validateGroups } from './test-groups.ts';

const Id = Type.Object({ id: Type.String() });
async function programInput(problemId: string, data: ProgramSave) {
  const profile = await db.compileProfile.findUnique({ where: { id: data.profileId } });
  if (!profile?.enabled) throw new HttpError(422, '请选择管理员启用的编译 profile');
  if (testlibRoles.has(data.role) && profile.language === 'PYTHON3') throw new HttpError(422, 'Validator / Checker / Interactor 使用固定 testlib 的 C++ profile；Python 可用于解法和生成器');
  if (['MAIN_SOLUTION', 'CORRECT_SOLUTION'].includes(data.role) && (data.expectedVerdicts.length !== 1 || data.expectedVerdicts[0] !== 'AC')) throw new HttpError(422, '主标程与正确解必须声明 AC');
  if (data.role === 'TIME_LIMIT_SOLUTION' && (data.expectedVerdicts.length !== 1 || data.expectedVerdicts[0] !== 'TLE')) throw new HttpError(422, '预期超时解必须声明 TLE');
  if (data.role === 'WRONG_SOLUTION' && data.expectedVerdicts.includes('AC')) throw new HttpError(422, '错误解必须声明非 AC 的预期判定');
  if (data.validatorScope === 'GROUPS' && data.role !== 'EXTRA_VALIDATOR') throw new HttpError(422, '只有额外 Validator 可以设置组级作用范围');
  if (data.expectedScore) {
    if (['MAIN_SOLUTION','CORRECT_SOLUTION'].includes(data.role)) throw new HttpError(422, '主标程与正确解的分数预期固定为满分，无需另行声明');
    const e = data.expectedScore, groups = await db.testGroupConfig.findUnique({ where: { problemId } });
    if (!['MAIN_SOLUTION','CORRECT_SOLUTION','WRONG_SOLUTION','TIME_LIMIT_SOLUTION','BRUTE_FORCE'].includes(data.role) || (!e.total && !e.groups.length) || e.total && e.total.min > e.total.max || e.groups.some(g => g.min > g.max) || new Set(e.groups.map(g=>g.groupId)).size !== e.groups.length) throw new HttpError(422, '分数预期需要有效的解法角色与非空、递增范围');
    const configured = (groups?.data as TestGroupsValue | undefined)?.groups ?? [];
    if (!configured.length || e.groups.some(g => !configured.some(c => c.id === g.groupId))) throw new HttpError(422, '分数预期必须引用本题已保存的数据组');
  }
  const { source: _source, ...configuration } = data;
  return { configuration, source: data.source, hash: sha256(data.source) };
}
async function testView(id: string) {
  const view = await publicTest(id);
  const duplicates = await db.testCase.findMany({ where: { problemId: view.problemId, id: { not: id }, currentRevision: { inputHash: view.currentRevision.inputHash } }, select: { id: true, number: true } });
  return { ...view, duplicates };
}
async function checkPlan(problemId: string, data: GeneratorPlanSave) {
  try { generatorPlanCommands(data); } catch (error) { throw new HttpError(422, (error as Error).message); }
  const ids = generatorPlanProgramIds(data);
  if (await db.program.count({ where: { id: { in: ids }, problemId, role: 'GENERATOR' } }) !== ids.length) throw new HttpError(422, '生成计划的每条命令必须引用本题的生成器');
}
async function selfTestData(problemId: string, data: ToolSelfTestSave) {
  if (data.programId) {
    const p = await db.program.findUnique({ where: { id: data.programId } });
    if (!p || p.problemId !== problemId || !(data.kind === 'VALIDATOR' ? ['VALIDATOR', 'EXTRA_VALIDATOR'] : ['CHECKER']).includes(p.role)) throw new HttpError(422, '自测必须选择本题对应角色的工具');
  } else {
    const problem = await db.problem.findUniqueOrThrow({ where: { id: problemId } });
    if (data.kind !== 'CHECKER' || ((problem.judgeSettings ?? defaultJudgeSettings) as JudgeSettingsValue).checkerMode === 'CUSTOM') throw new HttpError(422, '仅内置比较器自测可以不指定程序');
  }
  if (!(data.kind === 'VALIDATOR' ? ['ACCEPT', 'REJECT'] : ['AC', 'WA', 'PE']).includes(data.expected)) throw new HttpError(422, '预期判定不符合所选自测类型');
  const { inputBase64, answerBase64, outputBase64, ...configuration } = data;
  return { ...configuration, input: await saveBlob(problemId, rawBytes(inputBase64)), answer: await saveBlob(problemId, rawBytes(answerBase64)), output: await saveBlob(problemId, rawBytes(outputBase64)) };
}
export async function judgeRoutes(app: Api) {
  // Initial fixed profiles are metadata; no compiler or author code runs here.
  for (const profile of builtinProfiles) await db.compileProfile.upsert({ where: { id: profile.id }, create: profile, update: {} });
  app.get('/api/compile-profiles', { preHandler: authenticate }, async () => db.compileProfile.findMany({ orderBy: { id: 'asc' } }));
  app.post('/api/admin/compile-profiles', { preHandler: admin, schema: { body: ProfileInput, tags: ['编译配置'] } }, async req => {
    const { language, config } = req.body;
    const p = await db.compileProfile.create({ data: { ...req.body, id: randomUUID(), hash: hashObject({ language, config }) } });
    await audit(req.user.id, 'CREATE_COMPILE_PROFILE', p.id); return p;
  });
  app.put('/api/admin/compile-profiles/:id', { preHandler: admin, schema: { params: Id, body: ProfileUpdateInput } }, async req => {
    const { expectedVersion, ...data } = req.body;
    const changed = await db.compileProfile.updateMany({ where: { id: req.params.id, version: expectedVersion }, data: { ...data, version: { increment: 1 }, hash: hashObject({ language: data.language, config: data.config }) } });
    if (!changed.count) throw new HttpError(409, '编译 profile 版本冲突', 'VERSION_CONFLICT');
    await audit(req.user.id, 'UPDATE_COMPILE_PROFILE', req.params.id); return db.compileProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  });
  app.get('/api/problems/:id/judge-settings', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await problemAccess(req.user, req.params.id);
    const p = await db.problem.findUniqueOrThrow({ where: { id: req.params.id } });
    return { version: p.judgeVersion, settings: p.judgeSettings ?? defaultJudgeSettings };
  });
  app.put('/api/problems/:id/judge-settings', { preHandler: authenticate, schema: { params: Id, body: JudgeSettingsInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    const s = req.body.settings;
    if (s.interactionMode === 'INTERACTIVE' && s.ioMode !== 'STDIO') throw new HttpError(422, '交互执行必须使用标准管道 I/O');
    if (s.interaction && s.interaction.idleTimeMs > s.interaction.wallTimeMs) throw new HttpError(422, '空闲时限不能大于总墙钟时限');
    const reserved = ['source.cpp', 'source.py', 'program', 'stdout', 'stderr', 'testlib.h', 'checker-input', 'checker-answer', 'checker-output'];
    if (s.ioMode === 'FILES' && (s.inputFile === s.outputFile || reserved.includes(s.inputFile) || reserved.includes(s.outputFile))) throw new HttpError(422, '文件 I/O 需要不同文件名，且不能覆盖执行器的保留文件');
    await db.$transaction(async tx => {
      await lockProblem(tx, req.params.id);
      if (s.scoringMode === 'PARTIAL') {
        const groups = await tx.testGroupConfig.findUnique({ where: { problemId: req.params.id } });
        const data = groups?.data as TestGroupsValue | undefined;
        if (!data?.groups.some(g=>g.points>0)) throw new HttpError(422, '部分分需要先保存有正分数的数据组');
        await validateGroups(tx, req.params.id, data);
      }
      const changed = await tx.problem.updateMany({ where: { id: req.params.id, judgeVersion: req.body.expectedVersion }, data: { judgeSettings: s, judgeVersion: { increment: 1 } } });
      if (!changed.count) throw new HttpError(409, '判题配置版本冲突', 'VERSION_CONFLICT');
    });
    await audit(req.user.id, 'UPDATE_JUDGE_SETTINGS', req.params.id); return { version: req.body.expectedVersion + 1, settings: s };
  });
  app.get('/api/problems/:id/programs', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await problemAccess(req.user, req.params.id);
    return db.program.findMany({ where: { problemId: req.params.id }, include: { currentRevision: true, profile: true }, orderBy: { createdAt: 'asc' } });
  });
  app.post('/api/problems/:id/programs', { preHandler: authenticate, schema: { params: Id, body: ProgramInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    const revisionData = await programInput(req.params.id, req.body);
    const result = await db.$transaction(async tx => {
      await lockProblem(tx, req.params.id);
      if (await tx.program.count({ where: { problemId: req.params.id } }) >= 60) throw new HttpError(422, '本题最多保存 60 个程序');
      const p = await tx.program.create({ data: { ...revisionData.configuration, expectedScore: revisionData.configuration.expectedScore ?? Prisma.DbNull, problemId: req.params.id } });
      const revision = await tx.programRevision.create({ data: { ...revisionData, programId: p.id, version: 1 } });
      await touchProblem(tx, req.params.id);
      return tx.program.update({ where: { id: p.id }, data: { currentRevisionId: revision.id }, include: { currentRevision: true, profile: true } });
    });
    await audit(req.user.id, 'CREATE_PROGRAM', result.id, { role: result.role }); return result;
  });
  app.put('/api/programs/:id', { preHandler: authenticate, schema: { params: Id, body: ProgramUpdateInput } }, async req => {
    const p = await db.program.findUnique({ where: { id: req.params.id } });
    if (!p) throw new HttpError(404, '程序不存在'); await problemAccess(req.user, p.problemId, true);
    const { expectedVersion, ...data } = req.body, revisionData = await programInput(p.problemId, data);
    const result = await db.$transaction(async tx => {
      await lockProblem(tx, p.problemId);
      const changed = await tx.program.updateMany({ where: { id: p.id, version: expectedVersion }, data: { ...revisionData.configuration, validatorScope: data.validatorScope ?? 'GLOBAL', expectedScore: data.expectedScore ?? Prisma.DbNull, version: { increment: 1 } } });
      if (!changed.count) throw new HttpError(409, '程序版本冲突，本地源码保留', 'VERSION_CONFLICT');
      const revision = await tx.programRevision.create({ data: { ...revisionData, programId: p.id, version: expectedVersion + 1 } });
      await touchProblem(tx, p.problemId);
      return tx.program.update({ where: { id: p.id }, data: { currentRevisionId: revision.id }, include: { currentRevision: true, profile: true } });
    });
    await audit(req.user.id, 'UPDATE_PROGRAM', p.id); return result;
  });
  app.get('/api/programs/:id/revisions', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const p = await db.program.findUnique({ where: { id: req.params.id } });
    if (!p) throw new HttpError(404, '程序不存在'); await problemAccess(req.user, p.problemId);
    return db.programRevision.findMany({ where: { programId: p.id }, orderBy: { version: 'desc' } });
  });
  app.get('/api/problems/:id/tests', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await problemAccess(req.user, req.params.id);
    const tests = await db.testCase.findMany({ where: { problemId: req.params.id }, select: { id: true }, orderBy: { number: 'asc' } });
    return Promise.all(tests.map(t => testView(t.id)));
  });
  app.post('/api/problems/:id/tests', { preHandler: authenticate, bodyLimit: 3_000_000, schema: { params: Id, body: TestCaseInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    const { inputBase64, answerBase64, ...data } = req.body;
    const input = await saveBlob(req.params.id, rawBytes(inputBase64)), answer = answerBase64 === null ? null : await saveBlob(req.params.id, rawBytes(answerBase64));
    const id = await db.$transaction(async tx => { await lockProblem(tx, req.params.id); return appendTest(tx, req.params.id, data, input, answer, { type: 'MANUAL_OR_UPLOAD' }); });
    await audit(req.user.id, 'CREATE_TEST', id); return testView(id);
  });
  app.put('/api/tests/:id', { preHandler: authenticate, bodyLimit: 3_000_000, schema: { params: Id, body: TestCaseUpdateInput } }, async req => {
    const t = await db.testCase.findUnique({ where: { id: req.params.id } });
    if (!t) throw new HttpError(404, '测试数据不存在'); await problemAccess(req.user, t.problemId, true);
    const { inputBase64, answerBase64, expectedVersion, ...data } = req.body;
    const input = await saveBlob(t.problemId, rawBytes(inputBase64)), answer = answerBase64 === null ? null : await saveBlob(t.problemId, rawBytes(answerBase64));
    const id = await db.$transaction(async tx => { await lockProblem(tx, t.problemId); return appendTest(tx, t.problemId, data, input, answer, { type: 'MANUAL_OR_UPLOAD' }, { id: t.id, version: expectedVersion }); });
    await audit(req.user.id, 'UPDATE_TEST', id); return testView(id);
  });
  app.get('/api/test-revisions/:id', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const revision = await db.testCaseRevision.findUnique({ where: { id: req.params.id }, include: { testCase: true } });
    if (!revision) throw new HttpError(404, '数据版本不存在'); await problemAccess(req.user, revision.testCase.problemId);
    return { id: revision.id, version: revision.version, configuration: revision.configuration, inputHash: revision.inputHash, answerHash: revision.answerHash, inputBytes: revision.inputBytes, answerBytes: revision.answerBytes, current: revision.testCase.currentRevisionId === revision.id };
  });
  app.get('/api/test-revisions/:id/:file', { preHandler: authenticate, schema: { params: Type.Object({ id: Type.String(), file: Type.Union([Type.Literal('input'), Type.Literal('answer')]) }) } }, async (req, reply) => {
    const revision = await db.testCaseRevision.findUnique({ where: { id: req.params.id }, include: { testCase: true } });
    if (!revision) throw new HttpError(404, '数据版本不存在'); await problemAccess(req.user, revision.testCase.problemId);
    const key = req.params.file === 'input' ? revision.inputKey : revision.answerKey;
    if (!key) throw new HttpError(404, '本版本尚无答案');
    const number = (revision.configuration as { number: number }).number;
    return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="${number}.${req.params.file === 'input' ? 'in' : 'ans'}"`).send(await storage.get(key));
  });
  app.post('/api/problems/:id/tests/import-zip', { preHandler: authenticate, bodyLimit: 12_000_000, schema: { params: Id, body: TestZipInput } }, async req => {
    await problemAccess(req.user, req.params.id, true);
    let imported;
    try { imported = await readTestArchive(rawBytes(req.body.base64, 8_000_000)); } catch (e) { if (e instanceof ArchiveError) throw new HttpError(422, e.message, 'ARCHIVE_REJECTED'); throw e; }
    const blobs = await Promise.all(imported.map(async t => ({ ...t, input: await saveBlob(req.params.id, t.input), answer: t.answer ? await saveBlob(req.params.id, t.answer) : null })));
    const ids = await db.$transaction(async tx => {
      await lockProblem(tx, req.params.id); const result: string[] = [];
      for (const test of blobs) result.push(await appendTest(tx, req.params.id, { number: test.number, groupName: req.body.groupName, isSample: false, enabled: true, notes: '' }, test.input, test.answer, { type: 'ZIP', archiveHash: sha256(rawBytes(req.body.base64, 8_000_000)) }));
      return result;
    });
    await audit(req.user.id, 'IMPORT_TEST_ZIP', req.params.id, { count: ids.length }); return Promise.all(ids.map(testView));
  });
  app.get('/api/problems/:id/generator-plans', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await problemAccess(req.user, req.params.id); return db.generatorPlan.findMany({ where: { problemId: req.params.id }, orderBy: { createdAt: 'asc' } });
  });
  app.post('/api/problems/:id/generator-plans', { preHandler: authenticate, schema: { params: Id, body: GeneratorPlanInput } }, async req => {
    await problemAccess(req.user, req.params.id, true); await checkPlan(req.params.id, req.body);
    const result = await db.$transaction(async tx => {
      await lockProblem(tx, req.params.id);
      if (await tx.generatorPlan.count({ where: { problemId: req.params.id } }) >= 30) throw new HttpError(422, '本题最多保存 30 个生成计划');
      const plan = await tx.generatorPlan.create({ data: { problemId: req.params.id, programId: req.body.programId, name: req.body.name, enabled: req.body.enabled, data: req.body, hash: hashObject(req.body) } });
      await tx.generatorPlanRevision.create({ data: { planId: plan.id, version: 1, data: req.body, hash: plan.hash } });
      await touchProblem(tx, req.params.id); return plan;
    });
    await audit(req.user.id, 'CREATE_GENERATOR_PLAN', result.id); return result;
  });
  app.put('/api/generator-plans/:id', { preHandler: authenticate, schema: { params: Id, body: GeneratorPlanUpdateInput } }, async req => {
    const p = await db.generatorPlan.findUnique({ where: { id: req.params.id } });
    if (!p) throw new HttpError(404, '生成计划不存在'); await problemAccess(req.user, p.problemId, true);
    const { expectedVersion, ...data } = req.body; await checkPlan(p.problemId, data);
    const result = await db.$transaction(async tx => {
      await lockProblem(tx, p.problemId);
      const changed = await tx.generatorPlan.updateMany({ where: { id: p.id, version: expectedVersion }, data: { name: data.name, programId: data.programId, enabled: data.enabled, data, hash: hashObject(data), version: { increment: 1 } } });
      if (!changed.count) throw new HttpError(409, '生成计划版本冲突', 'VERSION_CONFLICT');
      await tx.generatorPlanRevision.create({ data: { planId: p.id, version: expectedVersion + 1, data, hash: hashObject(data) } });
      await touchProblem(tx, p.problemId); return tx.generatorPlan.findUniqueOrThrow({ where: { id: p.id } });
    });
    await audit(req.user.id, 'UPDATE_GENERATOR_PLAN', p.id); return result;
  });
  app.get('/api/problems/:id/self-tests', { preHandler: authenticate, schema: { params: Id } }, async req => {
    await problemAccess(req.user, req.params.id); return db.toolSelfTest.findMany({ where: { problemId: req.params.id }, orderBy: { createdAt: 'asc' } });
  });
  app.post('/api/problems/:id/self-tests', { preHandler: authenticate, bodyLimit: 5_000_000, schema: { params: Id, body: ToolSelfTestInput } }, async req => {
    await problemAccess(req.user, req.params.id, true); const data = await selfTestData(req.params.id, req.body);
    const result = await db.$transaction(async tx => {
      await lockProblem(tx, req.params.id);
      if (await tx.toolSelfTest.count({ where: { problemId: req.params.id } }) >= 100) throw new HttpError(422, '本题最多保存 100 个工具自测');
      const t = await tx.toolSelfTest.create({ data: { problemId: req.params.id, programId: data.programId, name: data.name, kind: data.kind, expected: data.expected, enabled: data.enabled, data, hash: hashObject(data) } });
      await tx.toolSelfTestRevision.create({ data: { selfTestId: t.id, version: 1, data, hash: t.hash } });
      await touchProblem(tx, req.params.id); return t;
    });
    await audit(req.user.id, 'CREATE_TOOL_SELF_TEST', result.id); return result;
  });
  app.put('/api/self-tests/:id', { preHandler: authenticate, bodyLimit: 5_000_000, schema: { params: Id, body: ToolSelfTestUpdateInput } }, async req => {
    const t = await db.toolSelfTest.findUnique({ where: { id: req.params.id } });
    if (!t) throw new HttpError(404, '自测不存在'); await problemAccess(req.user, t.problemId, true);
    const { expectedVersion, ...body } = req.body, data = await selfTestData(t.problemId, body);
    const result = await db.$transaction(async tx => {
      await lockProblem(tx, t.problemId);
      const changed = await tx.toolSelfTest.updateMany({ where: { id: t.id, version: expectedVersion }, data: { programId: data.programId, name: data.name, kind: data.kind, expected: data.expected, enabled: data.enabled, data, hash: hashObject(data), version: { increment: 1 } } });
      if (!changed.count) throw new HttpError(409, '工具自测版本冲突', 'VERSION_CONFLICT');
      await tx.toolSelfTestRevision.create({ data: { selfTestId: t.id, version: expectedVersion + 1, data, hash: hashObject(data) } });
      await touchProblem(tx, t.problemId); return tx.toolSelfTest.findUniqueOrThrow({ where: { id: t.id } });
    });
    await audit(req.user.id, 'UPDATE_TOOL_SELF_TEST', t.id); return result;
  });
  app.get('/api/self-tests/:id/files', { preHandler: authenticate, schema: { params: Id } }, async req => {
    const t = await db.toolSelfTest.findUnique({ where: { id: req.params.id } });
    if (!t) throw new HttpError(404, '自测不存在'); await problemAccess(req.user, t.problemId);
    const data = t.data as { input: { key: string }; answer: { key: string }; output: { key: string } };
    return { inputBase64: (await storage.get(data.input.key)).toString('base64'), answerBase64: (await storage.get(data.answer.key)).toString('base64'), outputBase64: (await storage.get(data.output.key)).toString('base64') };
  });
}
