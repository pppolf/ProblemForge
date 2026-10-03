import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { db, Prisma } from '@problemforge/database';
import { config, sha256, hashObject } from '@problemforge/domain';
import { defaultJudgeSettings, defaultInteractionSettings } from '@problemforge/contracts';
import { readArchive } from '@problemforge/problem-format';
import { SandboxClient } from '../packages/judge-adapter/src/index.ts';
import { createApp, storage } from '../apps/api/src/app.ts';
import { judgeSnapshot, validateJudgeSnapshot, dependencyHash } from '../apps/api/src/modules/judge-snapshot.ts';
import { problemSnapshot } from '../apps/api/src/modules/revision-snapshot.ts';
import { Executor } from '../workers/judge/src/executor.ts';
import { pipeline, emptyReport } from '../workers/judge/src/pipeline.ts';

if (!process.argv.includes('--rollback') || !process.argv.includes('--sandbox')) throw new Error('请显式指定 --rollback --sandbox；夹具回滚，作者程序仅在现有 Linux 沙箱执行');
const rollback = new Error('ROLLBACK_INTERACTIVE_SAMPLES'), userId = randomUUID(), problemId = randomUUID();
const app = await createApp(false), sandbox = new SandboxClient(config.judgeSandboxUrl, config.judgeSandboxToken);
const memory = new Map<string, Buffer>(), savedPut = storage.put, savedGet = storage.get, evidence: object[] = [];
storage.put = async (key, bytes) => { memory.set(key, Buffer.from(bytes)); };
storage.get = async key => { assert(memory.has(key)); return memory.get(key)!; };
try {
  await app.ready(); await sandbox.health();
  const testlib = await readFile('vendor/testlib/testlib.h', 'utf8');
  await db.$transaction(async tx => {
    const saved: { object: any; method: string; original: any }[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      const name = model.name[0].toLowerCase() + model.name.slice(1), object = (db as any)[name], delegate = (tx as any)[name];
      for (const method of ['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'create', 'createMany', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert']) {
        saved.push({ object, method, original: object[method] }); object[method] = delegate[method].bind(delegate);
      }
    }
    saved.push({ object: db, method: '$transaction', original: db.$transaction });
    (db as any).$transaction = (fn: (transaction: Prisma.TransactionClient) => unknown) => fn(tx);
    try {
      await tx.user.create({ data: { id: userId, name: 'Rollback interactive samples', email: `${userId}@example.test`, role: 'USER', passwordHash: 'not-a-login-credential' } });
      await tx.problem.create({ data: { id: problemId, title: 'Rollback interactive samples', members: { create: { userId, role: 'OWNER' } } } });
      const token = randomUUID(), csrf = randomUUID();
      await tx.session.create({ data: { id: sha256(token), userId, csrfToken: csrf, expiresAt: new Date(Date.now() + 180000) } });
      const call = async (method: 'GET' | 'POST' | 'PUT', path: string, payload?: object, expected = 200) => {
        const r = await app.inject({ method, url: '/api' + path, headers: { origin: config.origin, cookie: `pf_session=${token}`, 'x-csrf-token': csrf }, ...(payload ? { payload } : {}) });
        assert.equal(r.statusCode, expected, `${path}: ${r.body.slice(0, 500)}`); return r;
      };
      const profile = await tx.compileProfile.findFirstOrThrow({ where: { language: 'CPP17', enabled: true } });
      const sources = {
        MAIN_SOLUTION: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<2*n<<std::endl;}',
        WRONG_SOLUTION: '#include <iostream>\nint main(){int n;std::cin>>n;std::cout<<0<<std::endl;}',
        VALIDATOR: await readFile('fixtures/judge/sum-validator.cpp', 'utf8'),
        INTERACTOR: await readFile('fixtures/judge/double-interactor.cpp', 'utf8'),
      };
      for (const [role, source] of Object.entries(sources)) await call('POST', `/problems/${problemId}/programs`, { name: role, role, source, profileId: profile.id, enabled: true, expectedVerdicts: [role === 'WRONG_SOLUTION' ? 'WA' : 'AC'], notes: '' });
      await call('PUT', `/problems/${problemId}/judge-settings`, { expectedVersion: 1, settings: { ...defaultJudgeSettings, interactionMode: 'INTERACTIVE', interaction: { ...defaultInteractionSettings } } });
      const sampleBody = { number: 1, groupName: 'sample', isSample: true, enabled: true, notes: '', inputBase64: Buffer.from('Judge: 9\nContestant: 18\n').toString('base64'), answerBase64: Buffer.from('communication example\n').toString('base64') };
      const sample = (await call('POST', `/problems/${problemId}/tests`, sampleBody)).json();
      for (const purpose of ['VALIDATE', 'ANSWERS', 'ACCEPTANCE']) await call('POST', `/problems/${problemId}/test-runs`, { purpose, requestKey: randomUUID() }, 422);
      assert.equal(await tx.testRun.count({ where: { problemId } }), 0);
      for (const target of ['HYDRO', 'NOVAJUDGE']) await call('POST', `/problems/${problemId}/test-data-exports`, { target }, 422);
      const hidden = (await call('POST', `/problems/${problemId}/tests`, { ...sampleBody, number: 2, groupName: 'main', isSample: false, inputBase64: Buffer.from('9 13\n').toString('base64'), answerBase64: null })).json();
      const member = { testId: hidden.id, revisionId: hidden.currentRevision.id, weight: 1 };
      const group = { id: 'g', points: 100, aggregation: 'ALL', members: [member], dependencies: [], extraValidatorIds: [] };
      await call('PUT', `/problems/${problemId}/test-groups`, { expectedVersion: 0, data: { groups: [{ ...group, members: [...group.members, { testId: sample.id, revisionId: sample.currentRevision.id, weight: 1 }] }] } }, 422);
      await call('PUT', `/problems/${problemId}/test-groups`, { expectedVersion: 0, data: { groups: [group] } });
      const casesBefore = await tx.testCase.findMany({ where: { problemId }, include: { currentRevision: true }, orderBy: { number: 'asc' } });
      let acceptanceId = '';
      for (const purpose of ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'] as const) {
        const input = await judgeSnapshot(tx, problemId, purpose); validateJudgeSnapshot(input); assert.deepEqual(input.tests.map(t => t.number), [2]);
        const leaseToken = randomUUID(), run = await tx.testRun.create({ data: { problemId, requestedById: userId, requestKey: randomUUID(), purpose, state: 'RUNNING', leaseToken, input: input as any, inputHash: hashObject(input), dependencyHash: dependencyHash(input) } });
        const executor = new Executor(run.id, sandbox, storage, new AbortController().signal, testlib, { problemId, leaseToken });
        try {
          const report = emptyReport(), result = await pipeline(run.id, input, executor, report);
          if (purpose === 'ACCEPTANCE') { assert.equal(result.accepted, true); assert.deepEqual(report.matrix.map(c => [c.programName, c.number, c.verdict]).sort(), [['MAIN_SOLUTION', 2, 'AC'], ['WRONG_SOLUTION', 2, 'WA']]); acceptanceId = run.id; }
          const cases = await tx.runCase.findMany({ where: { runId: run.id } }); assert.deepEqual(cases.map(c => c.number), [2]);
          assert.equal(await tx.invocation.count({ where: { runId: run.id, caseRef: `test:${sample.id}:${sample.currentRevision.id}` } }), 0);
          await tx.testRun.update({ where: { id: run.id }, data: { state: 'SUCCEEDED', accepted: result.accepted, finishedAt: new Date(), report: report as unknown as Prisma.InputJsonValue } });
          evidence.push({ purpose, linuxSandbox: true, cases: cases.map(c => c.number), matrix: report.matrix.map(c => ({ name: c.programName, number: c.number, verdict: c.verdict })) });
        } finally { await executor.cleanup(); }
      }
      assert.deepEqual(await tx.testCase.findMany({ where: { problemId }, include: { currentRevision: true }, orderBy: { number: 'asc' } }), casesBefore);
      const dependency = dependencyHash(await judgeSnapshot(tx, problemId, 'ACCEPTANCE'));
      await call('PUT', `/tests/${sample.id}`, { ...sampleBody, expectedVersion: 1, inputBase64: Buffer.from('Revised conversation example\n').toString('base64') });
      assert.equal(dependencyHash(await judgeSnapshot(tx, problemId, 'ACCEPTANCE')), dependency);
      assert.equal((await call('GET', `/test-revisions/${sample.currentRevision.id}/input`)).rawPayload.toString(), 'Judge: 9\nContestant: 18\n');
      // Legacy generated sample metadata must not be reintroduced by answer hydration.
      const sampleInput = casesBefore[0].currentRevision!;
      await tx.runCase.create({ data: { runId: acceptanceId, ref: 'legacy-sample', number: 99, groupName: 'sample', isSample: true, inputKey: sampleInput.inputKey, inputHash: sampleInput.inputHash, inputBytes: sampleInput.inputBytes, origin: { type: 'GENERATOR' } } });
      const snapshot = await problemSnapshot(tx, problemId); assert.equal(snapshot.acceptanceRunId, acceptanceId);
      const revision = await tx.problemRevision.create({ data: { problemId, number: 1, label: 'Rollback snapshot', ...snapshot, manifest: snapshot.manifest as unknown as Prisma.InputJsonValue, createdById: userId } });
      for (const target of ['HYDRO', 'NOVAJUDGE']) {
        const artifact = (await call('POST', `/problems/${problemId}/test-data-exports`, { target, revisionId: revision.id })).json();
        const files = await readArchive((await call('GET', `/exports/${artifact.id}/file`)).rawPayload);
        assert.deepEqual([...files.keys()].filter(p => p.endsWith('.in')), ['2.in']);
        assert(![...files.keys()].some(p => p.endsWith('.ans')));
        const interactorName = target === 'HYDRO' ? 'interactor.cc' : 'interactor.cpp';
        assert(files.has(interactorName)); assert(!files.has(target === 'HYDRO' ? 'interactor.cpp' : 'interactor.cc'));
        const config = JSON.parse(files.get(target === 'HYDRO' ? 'config.yaml' : 'problem.yml')!.toString());
        assert.deepEqual(config.interactor, target === 'HYDRO' ? { file: interactorName, lang: 'cc' } : interactorName);
        assert.deepEqual(config.cases, [{ input: '2.in' }]);
        assert(!files.has('1.in')); assert(!files.has('99.in'));
        evidence.push({ target, entries: [...files.keys()], legacySampleExcluded: true });
      }
      const artifact = (await call('POST', `/problems/${problemId}/exports`, { revisionId: revision.id, purpose: 'FULL', format: 'NATIVE' })).json();
      const full = await readArchive((await call('GET', `/exports/${artifact.id}/file`)).rawPayload);
      assert.equal(JSON.parse(full.get('problemforge.json')!.toString()).manifest.tests.length, 2);
      evidence.push({ preflight: 'sample-only tasks/exports rejected before queueing', groups: 'only hidden inputs required', sampleEdit: 'acceptance dependency unchanged', preservation: 'sample history and native FULL kept' });
      throw rollback;
    } finally { for (const item of saved.reverse()) item.object[item.method] = item.original; }
  }, { timeout: 150000 }).catch(error => { if (error !== rollback) throw error; });
  assert.equal(await db.problem.count({ where: { id: problemId } }), 0);
  assert.equal(await db.user.count({ where: { id: userId } }), 0);
  assert.equal(await db.testRun.count({ where: { problemId } }), 0);
  assert.equal(await db.auditLog.count({ where: { actorId: userId } }), 0);
  const result = { passed: true, rolledBack: true, storage: 'in-memory', queuedJobs: 0, evidence };
  await mkdir('.local/interactive-samples', { recursive: true }); await writeFile('.local/interactive-samples/verification.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { storage.put = savedPut; storage.get = savedGet; await app.close(); await db.$disconnect(); }
process.exit(0);
