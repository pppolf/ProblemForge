import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareOutput, checkerVerdict, validatorVerdict, checkExpectation } from './index.ts';
import { readTestArchive, ArchiveError } from './archive.ts';
import { makeTestZip } from '../../../fixtures/judge/zip.ts';
import type { SandboxResult } from '@problemforge/judge-adapter';

test('comparison semantics keep bytes, reject trailing tokens and non-finite floats', () => {
  const compare = (answer: string, output: string, mode: 'EXACT' | 'TOKENS' | 'FLOAT') => compareOutput(Buffer.from(answer), Buffer.from(output), { checkerMode: mode, absoluteTolerance: 1e-6, relativeTolerance: 1e-6 }).verdict;
  assert.equal(compare('3\r\n', '3\n', 'EXACT'), 'WA');
  assert.equal(compare('3\n', ' 3 \t\r\n', 'TOKENS'), 'AC');
  assert.equal(compare('3', '3 4', 'TOKENS'), 'WA');
  assert.equal(compare('2.0 label', '2.000001 label', 'FLOAT'), 'AC');
  assert.equal(compare('nan', 'nan', 'FLOAT'), 'WA');
});
test('testlib normal rejection, tool failure, and compile errors have distinct meaning', () => {
  const result = (status: string, exitStatus: number): SandboxResult => ({ status, exitStatus, time: 1, runTime: 1, memory: 1 });
  assert.equal(checkerVerdict(result('Nonzero Exit Status', 1)), 'WA');
  assert.equal(checkerVerdict(result('Nonzero Exit Status', 3)), 'TOOL_ERROR');
  assert.equal(checkerVerdict(result('Signalled', 11)), 'TOOL_ERROR');
  assert.equal(validatorVerdict(result('Nonzero Exit Status', 3)), 'REJECT');
  assert.equal(checkExpectation({ role: 'WRONG_SOLUTION', expectedVerdicts: ['WA'] }, ['CE']).passed, false);
});
test('bounded ZIP import preserves bytes and rejects traversal', async () => {
  const input = Buffer.from([0, 255, 13, 10]);
  const valid = await readTestArchive(makeTestZip([{ name: 'tests/001.in', bytes: input }, { name: 'tests/001.ans', bytes: Buffer.from('x\r\n') }]));
  assert.deepEqual(valid[0].input, input);
  await assert.rejects(readTestArchive(makeTestZip([{ name: '../001.in', bytes: input }])), ArchiveError);
});
