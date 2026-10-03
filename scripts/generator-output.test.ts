import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TEST_BYTES, defaultJudgeSettings } from '@problemforge/contracts';
import { Executor, type Compiled } from '../workers/judge/src/executor.ts';
import { readTestArchive, ArchiveError } from '../packages/judge-core/src/archive.ts';
import { makeTestZip } from '../fixtures/judge/zip.ts';
import type { SandboxCommand } from '../packages/judge-adapter/src/index.ts';

test('generator commands allow large input while solution and diagnostic limits stay independent', async () => {
  const executor = new Executor('fixture', null as any, null as any, new AbortController().signal, '', { problemId: 'fixture', leaseToken: 'fixture' });
  const captured: SandboxCommand[] = [];
  (executor as any).capture = async (_program: unknown, command: SandboxCommand) => { captured.push(command); return {}; };
  executor.upload = async () => 'input-file';
  const compiled = { program: { profile: { language: 'CPP20' } }, executable: 'fixture-file', fileName: 'program' } as Compiled;
  await executor.generate(compiled, ['max'], '3003', 'case');
  await executor.generate(compiled, ['max'], '3003', 'case', true);
  await executor.solution(compiled, Buffer.from('test'), { ...defaultJudgeSettings, outputLimitBytes: 4096 }, 'case');
  for (const command of captured.slice(0, 2)) {
    assert.deepEqual(command.files[1], { name: 'stdout', max: MAX_TEST_BYTES });
    assert.equal(command.copyOutMax, MAX_TEST_BYTES);
    assert.deepEqual(command.files[2], { name: 'stderr', max: 65536 });
    assert.deepEqual(command.args.slice(-2), ['max', '3003']);
  }
  assert.deepEqual(captured[2].files[1], { name: 'stdout', max: 4096 });
});

test('ZIP imports preserve a 200000-number input larger than 1 MiB', async () => {
  const input = Buffer.from(`1\n200000\n${Array(200000).fill('1000000000').join(' ')}\n`);
  assert(input.length > 1_048_576);
  const result = await readTestArchive(makeTestZip([{ name: '4.in', bytes: input }, { name: '4.ans', bytes: Buffer.from('1\r\n') }]));
  assert.deepEqual(result[0].input, input);
  assert.deepEqual(result[0].answer, Buffer.from('1\r\n'));
  // A declared oversize entry is rejected before attempting inflation.
  const oversized = makeTestZip([{ name: '4.in', bytes: Buffer.from('x') }]);
  oversized.writeUInt32LE(MAX_TEST_BYTES + 1, oversized.indexOf(Buffer.from('504b0102', 'hex')) + 24);
  await assert.rejects(readTestArchive(oversized), ArchiveError);
});
