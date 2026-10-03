import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '@problemforge/database';
import { hashObject, sha256 } from '@problemforge/domain';
import { defaultJudgeSettings } from '@problemforge/contracts';
import { GENERATOR_COMMAND_POLICY, GENERATOR_DEDUP_POLICY, JUDGE_POLICY, JUDGE_TOOLCHAIN, type JudgeSnapshot } from '../packages/judge-core/src/index.ts';
import { GO_JUDGE_VERSION } from '../packages/judge-adapter/src/index.ts';
import { pipeline, emptyReport } from '../workers/judge/src/pipeline.ts';
import type { Executor } from '../workers/judge/src/executor.ts';

// Exercise production orchestration without connecting to a DB or executing
// author code. Real sandbox verification is a separate, explicit operation.
const blob = (text: string) => ({ key: text, hash: sha256(Buffer.from(text)), bytes: Buffer.byteLength(text) });
function fixture(purpose: JudgeSnapshot['purpose'] = 'ANSWERS'): JudgeSnapshot {
  const profile = { id: 'profile', name: 'C++20', version: 1, language: 'CPP20' as const, config: { optimization: 'O2' as const, warnings: true, compileTimeMs: 10000, compileMemoryMb: 512 }, enabled: true };
  const program = (id: string, role: any) => ({ id, revisionId: `${id}:v1`, name: id, role, version: 1, enabled: true, source: 'fixture only', sourceHash: sha256('fixture only'), expectedVerdicts: ['AC' as const], profile: { ...profile, hash: hashObject({ language: profile.language, config: profile.config }) } });
  return {
    problemId: 'fixture', purpose, budgetMs: 300000, policy: GENERATOR_DEDUP_POLICY, toolchain: JUDGE_TOOLCHAIN, sandboxVersion: GO_JUDGE_VERSION,
    settings: { ...defaultJudgeSettings, checkerMode: 'EXACT' },
    programs: purpose === 'GENERATE' ? [program('gen', 'GENERATOR')] : [program('gen', 'GENERATOR'), program('std', 'MAIN_SOLUTION'), program('val', 'VALIDATOR')],
    tests: [{ id: 'saved', ref: 'test:saved:v1', revisionId: 'saved:v1', version: 1, number: 1, groupName: 'main', isSample: true, input: blob('1\n'), answer: blob('ok\n'), provenance: {} }],
    plans: [{ id: 'plan', name: 'plan', version: 1, hash: 'fixture', programId: 'gen', enabled: true, argv: [], seed: '0', count: 3, numberStart: 2, groupName: 'main', isSample: false }], selfTests: [],
  };
}
async function execute(input: JudgeSnapshot, generated = ['1\n', '2\n', '2\n'], repeatOutput?: string) {
  const cases: any[] = [], validated: string[] = [], answered: string[] = [], reads: string[] = [];
  const report = emptyReport(); let total = 0, repeated = 0;
  const original = { create: db.runCase.create, update: db.runCase.update };
  (db.runCase as any).create = async ({ data }: any) => { const row = { ...data, id: `case-${cases.length}` }; cases.push(row); return row; };
  (db.runCase as any).update = async ({ where, data }: any) => Object.assign(cases.find(c => c.id === where.id), data);
  const captured = (text: string, id: string) => ({ id, verdict: 'AC', diagnostic: '', output: Buffer.from(text), outputRef: blob(text), result: { time: 1e6, memory: 1024 } });
  const executor = {
    checkCanceled() {},
    async progress({ data }: any) { if (typeof data.total === 'number') total = data.total; },
    async compile(program: any) { return { compiled: { program }, execution: { id: program.id, verdict: 'COMPILED', diagnostic: '' } }; },
    async blob(ref: any) { reads.push(ref.key); return Buffer.from(ref.key); },
    async generate(_program: any, _argv: string[], seed: string, ref: string, repeat = false) {
      if (repeat) repeated++;
      return captured(repeat && repeatOutput !== undefined ? repeatOutput : generated[Number(seed)], ref);
    },
    async validate(_program: any, _bytes: Buffer, context: any) { validated.push(context.caseRef); return { verdict: 'ACCEPT', diagnostic: '' }; },
    async solution(_program: any, _bytes: Buffer, _settings: any, ref: string) { answered.push(ref); return captured('ok\n', `main:${ref}`); },
  } as unknown as Executor;
  try { return { result: await pipeline('unit-fixture', input, executor, report), report, cases, validated, answered, reads, total, repeated }; }
  finally { db.runCase.create = original.create; db.runCase.update = original.update; }
}

test('generated duplicates reuse saved cases and the first new input across Judge tasks', async () => {
  for (const purpose of ['ANSWERS', 'VALIDATE', 'ACCEPTANCE'] as const) {
    const run = await execute(fixture(purpose));
    assert.deepEqual(run.cases.map(c => c.number), [1, 3]);
    assert.equal(run.cases[0].origin.type, 'TEST');
    assert.equal(run.cases[0].origin.testRevisionId, 'saved:v1');
    assert.equal(run.report.skippedGeneratedInputs?.length, 2);
    assert.deepEqual(run.report.skippedGeneratedInputs?.map(s => s.retainedRef), ['test:saved:v1', 'plan:plan:v1:1']);
    assert.deepEqual(run.report.warnings, []);
    assert.equal(run.validated.length, 2);
    assert.equal(run.answered.length, purpose === 'VALIDATE' ? 0 : 2);
    assert.equal(run.total, 3 + 1 + 4 + 2 * (purpose === 'VALIDATE' ? 1 : 2));
    if (purpose === 'ACCEPTANCE') { assert.equal(run.result.accepted, true); assert.equal(run.report.matrix.length, 2); }
  }
});

test('standalone generation skips saved input and duplicates across different plans', async () => {
  const input = fixture('GENERATE');
  input.plans.push({ ...input.plans[0], id: 'other-plan', numberStart: 10 });
  const run = await execute(input);
  assert.deepEqual(run.cases.map(c => c.number), [3]);
  assert.equal(run.report.skippedGeneratedInputs?.length, 5);
  assert.deepEqual(run.reads, []);
  assert.equal(run.repeated, 2);
  assert.deepEqual(run.report.warnings, []);
  const allRepeated = await execute(fixture('GENERATE'), ['1\n', '1\n', '1\n']);
  assert.equal(allRepeated.cases.length, 0);
  assert.equal(allRepeated.report.skippedGeneratedInputs?.length, 3);
  assert.equal(allRepeated.total, 5);
});

test('number collisions and different line endings do not discard distinct inputs', async () => {
  const input = fixture(); input.plans[0].numberStart = 1;
  const run = await execute(input, ['2\n', '1\r\n', '2\n']);
  assert.equal(run.cases.length, 3);
  assert.equal(run.report.skippedGeneratedInputs?.length, 1);
  assert.equal(run.report.warnings.length, 1);
  assert.match(run.report.warnings[0], /数据编号 #1 重复/);
});

test('deduplication retains determinism checks and cannot hide conflicting saved answers', async () => {
  const run = await execute(fixture(), undefined, 'nondeterministic\n');
  assert.equal(run.repeated, 1);
  assert.match(run.report.warnings[0], /相同 argv/);
  const input = fixture();
  input.tests.push({ ...input.tests[0], id: 'second', ref: 'test:second:v1', revisionId: 'second:v1', number: 8, answer: blob('wrong\n') });
  await assert.rejects(execute(input), (error: any) => error.code === 'ANSWER_MISMATCH');
});

test('old generation policy is rejected instead of silently changing a fixed snapshot', async () => {
  for (const policy of [JUDGE_POLICY, GENERATOR_COMMAND_POLICY, 'problemforge-judge-generated-input-dedup-v1']) {
    const input = fixture(); input.policy = policy;
    await assert.rejects(execute(input), (error: any) => error.code === 'TOOLCHAIN_MISMATCH');
  }
});
