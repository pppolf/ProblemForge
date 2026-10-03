import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from '@problemforge/database';
import { defaultJudgeSettings, defaultInteractionSettings, type JudgePurpose } from '@problemforge/contracts';
import { sha256, hashObject } from '@problemforge/domain';
import { judgeSnapshot, dependencyHash, validateJudgeSnapshot } from '../apps/api/src/modules/judge-snapshot.ts';
import { JUDGING_DATA_POLICY } from '../packages/judge-core/src/index.ts';
import { pipeline, emptyReport } from '../workers/judge/src/pipeline.ts';
import type { Executor } from '../workers/judge/src/executor.ts';

function fixture() {
  const settings = { ...defaultJudgeSettings, interactionMode: 'INTERACTIVE' as 'INTERACTIVE' | 'BATCH', interaction: { ...defaultInteractionSettings } };
  const config = { optimization: 'O2', warnings: true, compileTimeMs: 1000, compileMemoryMb: 256 };
  const profile = { id: 'cpp', name: 'cpp', version: 1, language: 'CPP17', enabled: true, config, hash: hashObject({ language: 'CPP17', config }) };
  const programs = ['MAIN_SOLUTION', 'VALIDATOR', 'INTERACTOR', 'GENERATOR'].map(role => ({ id: role, currentRevisionId: role + 'r', version: 1, name: role, role, enabled: true, expectedVerdicts: ['AC'], profile, currentRevision: { source: 'fixture', hash: sha256('fixture') } }));
  const tests = [true, false].map((isSample, i) => ({ id: `t${i}`, currentRevisionId: `r${i}`, version: 1, number: i + 1, groupName: 'main', isSample, enabled: true, currentRevision: { inputKey: isSample ? 'dialogue' : 'hidden', inputHash: sha256('same input'), inputBytes: 10, answerKey: isSample ? 'demonstration' : null, answerHash: isSample ? sha256('demonstration') : null, answerBytes: isSample ? 13 : null, provenance: {} } }));
  const plans = [true, false].map((isSample, i) => ({ id: `p${i}`, version: 1, hash: `${i}`, data: { name: `plan ${i}`, programId: 'GENERATOR', enabled: true, argv: [], seed: String(i), count: 1, numberStart: i + 3, groupName: 'main', isSample } }));
  const tx = { problem: { findUniqueOrThrow: async () => ({ judgeSettings: settings }) }, program: { findMany: async () => programs }, testCase: { findMany: async () => tests }, generatorPlan: { findMany: async () => plans }, toolSelfTest: { findMany: async () => [] }, testGroupConfig: { findUnique: async () => null } };
  return { settings, programs, tests, plans, snapshot: (purpose: JudgePurpose) => judgeSnapshot(tx as any, 'fixture', purpose) };
}

test('interactive snapshots exclude conversation samples and sample plans from all judging stages', async () => {
  const f = fixture();
  for (const purpose of ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'] as const) {
    const input = await f.snapshot(purpose);
    assert.deepEqual(input.tests.map(t => t.number), [2]); assert.deepEqual(input.plans.map(p => p.id), ['p1']);
    assert.equal(input.dataPolicy, JUDGING_DATA_POLICY); assert.equal(input.settings.interactionMode, 'INTERACTIVE');
    validateJudgeSnapshot(input);
    const before = dependencyHash(input);
    f.tests[0].version++; f.tests[0].currentRevisionId += 'new'; f.tests[0].currentRevision.inputHash = sha256('changed dialogue'); f.plans[0].version++;
    assert.equal(dependencyHash(await f.snapshot(purpose)), before, 'display-only sample edits must not invalidate acceptance');
  }
  // Explicit input-only generation remains available for display examples.
  const generation = await f.snapshot('GENERATE');
  assert.deepEqual(generation.tests.map(t => t.number), [2]); assert.equal(generation.plans.length, 2);
  assert.equal(generation.interactionPolicy, undefined);
});

test('batch samples retain their old behavior; interactive sample-only requests fail before queueing', async () => {
  const f = fixture(); f.settings.interactionMode = 'BATCH';
  for (const purpose of ['GENERATE', 'VALIDATE', 'ANSWERS', 'ACCEPTANCE'] as const) {
    const input = await f.snapshot(purpose); assert.equal(input.tests.length, 2); assert.equal(input.plans.length, 2); assert.equal(input.dataPolicy, undefined);
  }
  f.settings.interactionMode = 'INTERACTIVE'; f.tests.splice(1); f.plans.splice(1);
  for (const purpose of ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'] as const) {
    const input = await f.snapshot(purpose);
    assert.throws(() => validateJudgeSnapshot(input), /非样例测试数据/);
  }
});

test('worker never reads, validates, interacts with or deduplicates against display-only samples', async () => {
  const f = fixture(); f.plans.splice(0);
  const savedCreate = db.runCase.create, savedUpdate = db.runCase.update;
  try {
    for (const purpose of ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'] as const) {
      const input = await f.snapshot(purpose), cases: any[] = [], reads: string[] = [], interactions: string[] = [];
      // Exercise the worker's defensive filter, independently of API selection.
      input.tests.unshift({ ...input.tests[0], id: 'sample', revisionId: 'sample-r', ref: 'sample', number: 1, isSample: true, input: { key: 'DO_NOT_READ', hash: input.tests[0].input.hash, bytes: 1 } });
      const original = structuredClone(input), report = emptyReport(); let total = 0;
      (db.runCase as any).create = async ({ data }: any) => { const c = { ...data, id: `c${cases.length}` }; cases.push(c); return c; };
      (db.runCase as any).update = async ({ where, data }: any) => Object.assign(cases.find(c => c.id === where.id), data);
      const execution = { id: 'inv', verdict: 'AC', diagnostic: '', output: Buffer.from('ok'), outputRef: { key: 'answer', hash: sha256('ok'), bytes: 2 }, result: { time: 1e6, memory: 1024 } };
      const executor = {
        checkCanceled() {}, async progress({ data }: any) { if (data.total !== undefined) total = data.total; },
        async compile(program: any) { return { compiled: { program }, execution: { id: program.id, verdict: 'COMPILED', diagnostic: '' } }; },
        async blob(ref: any) { assert.notEqual(ref.key, 'DO_NOT_READ'); reads.push(ref.key); return Buffer.from('hidden input'); },
        async validate(_program: any, _bytes: Buffer, context: any) { assert.notEqual(context.caseRef, 'sample'); return { verdict: 'ACCEPT' }; },
        async interactive(_program: any, _interactor: any, _bytes: Buffer, _answer: any, _settings: any, ref: string) { interactions.push(ref); return execution; },
      } as unknown as Executor;
      const result = await pipeline('fixture-run', input, executor, report);
      assert.deepEqual(input, original); assert.deepEqual(cases.map(c => c.number), [2]); assert.deepEqual(reads, ['hidden']);
      assert(!interactions.includes('sample')); assert.deepEqual(report.warnings, []);
      assert.equal(total, purpose === 'VALIDATE' ? 3 : 6);
      if (purpose === 'ACCEPTANCE') { assert.equal(result.accepted, true); assert.deepEqual(report.matrix.map(c => c.number), [2]); }
      const legacy = { ...input, dataPolicy: undefined };
      await assert.rejects(pipeline('legacy', legacy, executor, emptyReport()), (e: any) => e.code === 'JUDGING_DATA_POLICY_MISMATCH');
    }
  } finally { db.runCase.create = savedCreate; db.runCase.update = savedUpdate; }
});
