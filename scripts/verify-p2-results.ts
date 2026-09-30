import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root } from '@problemforge/domain';
import { Client } from './http-client.ts';

// Explicit follow-up integration. Requires verify:p2 fixtures and a published
// administrator statement template, inspected through the real PDF preview.
// It never runs as part of test / test:quick and never executes author code here.
const fixture = JSON.parse(await readFile(resolve(root, '.local/verify-p2-fixture.json'), 'utf8'));
const author = new Client();
await author.login(fixture.authorEmail, fixture.authorPassword);
const profiles = await author.call('/compile-profiles');
const b64 = (bytes: string | Buffer) => Buffer.from(bytes).toString('base64');
const source = (file: string) => readFile(resolve(root, 'fixtures/judge', file), 'utf8');
const program = async (problemId: string, name: string, file: string, role: string, language = 'PYTHON3') => author.call(`/problems/${problemId}/programs`, 'POST', {
  name, role, source: await source(file), profileId: profiles.find((p: any) => p.language === language && p.enabled).id,
  expectedVerdicts: [role === 'WRONG_SOLUTION' ? 'WA' : 'AC'], notes: '', enabled: true,
});
const submit = (problemId: string, purpose: string) => author.call(`/problems/${problemId}/test-runs`, 'POST', { purpose, requestKey: randomUUID() });
const succeeded = (task: any) => assert.equal(task.state, 'SUCCEEDED', `${task.errorCode}: ${task.log}`);

const problem = await author.call('/problems', 'POST', { title: `取消与文件 I/O · ${Date.now()}`, language: 'zh-CN' });
const busy = await program(problem.id, '可取消生成器', 'busy-generator.py', 'GENERATOR');
const planData = { name: '取消检查', programId: busy.id, argv: [], seed: '1', count: 1, numberStart: 1, groupName: 'main', isSample: false, enabled: true };
const plan = await author.call(`/problems/${problem.id}/generator-plans`, 'POST', planData);
const queued = await submit(problem.id, 'GENERATE');
const deadline = Date.now() + 30000;
let running: any;
while (Date.now() < deadline) {
  running = await author.call(`/test-runs/${queued.id}`);
  if (running.state === 'RUNNING' && running.invocations.some((i: any) => i.phase === 'COMPILE' && i.verdict === 'COMPILED')) break;
  assert(!['SUCCEEDED', 'FAILED', 'CANCELED'].includes(running.state), '取消前任务意外结束');
  await new Promise(resolve => setTimeout(resolve, 50));
}
assert.equal(running?.state, 'RUNNING');
await new Promise(resolve => setTimeout(resolve, 150));
const cancelAt = Date.now();
await author.call(`/test-runs/${queued.id}/cancel`, 'POST');
const canceled = await author.waitRun(queued.id, 15000);
assert.equal(canceled.state, 'CANCELED');
assert(canceled.invocations.some((i: any) => i.phase === 'GENERATOR' && i.verdict === 'CANCELED'), '保留真实中止的生成器执行记录');
const cancelElapsedMs = Date.now() - cancelAt;
await author.call(`/generator-plans/${plan.id}`, 'PUT', { ...planData, enabled: false, expectedVersion: plan.version });
console.log('PASS running Linux generator canceled; actual sandbox execution record retained.');

const main = await program(problem.id, '文件主标程', 'files-main.py', 'MAIN_SOLUTION');
const wrong = await program(problem.id, '文件错误解', 'files-wrong.py', 'WRONG_SOLUTION');
await program(problem.id, '输入 Validator', 'sum-validator.cpp', 'VALIDATOR', 'CPP17');
const settings = await author.call(`/problems/${problem.id}/judge-settings`);
await author.call(`/problems/${problem.id}/judge-settings`, 'PUT', { expectedVersion: settings.version, settings: { ...settings.settings, ioMode: 'FILES', inputFile: '../unsafe' } }, 400);
await author.call(`/problems/${problem.id}/judge-settings`, 'PUT', { expectedVersion: settings.version, settings: { ...settings.settings, ioMode: 'FILES' } });
await author.call(`/problems/${problem.id}/tests`, 'POST', { number: 1, groupName: 'main', isSample: true, enabled: true, notes: '', inputBase64: b64('1 2\n'), answerBase64: null });
const fileRun = await author.waitRun((await submit(problem.id, 'ACCEPTANCE')).id);
succeeded(fileRun); assert.equal(fileRun.currentValid, true);
assert.equal(fileRun.report.matrix.find((m: any) => m.programId === main.id).verdict, 'AC');
assert.equal(fileRun.report.matrix.find((m: any) => m.programId === wrong.id).verdict, 'WA');
const mainExecution = fileRun.invocations.find((i: any) => i.programId === main.id && i.phase === 'MAIN_SOLUTION');
assert.equal(mainExecution.stdoutBytes, 0);
assert.equal(mainExecution.detail.output.bytes, 2);
assert.deepEqual(await author.bytes(`/invocations/${mainExecution.id}/output`), Buffer.from('3\n'));
assert.deepEqual(await author.bytes(`/test-runs/${fileRun.id}/cases/${fileRun.cases[0].id}/answer`), Buffer.from('3\n'));
console.log('PASS safe file I/O: judged output.txt is separate from empty stdout; next real task succeeds after cancellation.');

const answers = await author.waitRun((await submit(fixture.sumId, 'ANSWERS')).id);
succeeded(answers);
const sampleCase = answers.cases.find((c: any) => c.number === 1 && c.isSample);
await author.call(`/test-runs/${answers.id}/apply-data`, 'POST', { caseIds: [sampleCase.id] });
const sample = (await author.call(`/problems/${fixture.sumId}/tests`)).find((t: any) => t.number === 1);
assert.deepEqual(await author.bytes(`/test-revisions/${sample.currentRevision.id}/input`), Buffer.from('1 2\n'));
assert.deepEqual(await author.bytes(`/test-revisions/${sample.currentRevision.id}/answer`), Buffer.from('3\n'));
assert.equal(sample.currentRevision.provenance.answerRunId, answers.id);
const templates = await author.call('/templates');
const template = templates.find((t: any) => t.template.kind === 'STATEMENT' && t.languages.includes('zh-CN'));
assert(template, '需要已检查真实 PDF 的已发布中文题面模板');
const documents = (await author.call(`/problems/${fixture.sumId}`)).documents;
const doc = documents.find((d: any) => d.kind === 'STATEMENT');
const body = '给定两个整数 $a,b$，输出它们的和。\n\n\\InputFile\n一行两个整数，范围为 $-1000 \\leq a,b \\leq 1000$。\n\n\\OutputFile\n输出一个整数 $a+b$。\n';
const save = { expectedVersion: doc.version, body, enabled: true, metadata: doc.currentRevision.metadata, templateVersionId: template.id, sampleRevisionIds: [sample.currentRevision.id] };
const foreign = (await author.call(`/problems/${fixture.strictId}/tests`))[0];
await author.call(`/documents/${doc.id}`, 'PUT', { ...save, sampleRevisionIds: [foreign.currentRevision.id] }, 422);
await author.call(`/documents/${documents.find((d: any) => d.kind === 'EDITORIAL_DOCUMENT').id}`, 'PUT', { ...save, expectedVersion: 1, templateVersionId: null }, 422);
await author.call(`/documents/${doc.id}`, 'PUT', save);
const build = await author.call('/builds', 'POST', { documentId: doc.id });
const buildDeadline = Date.now() + 150000;
let built: any;
while (Date.now() < buildDeadline) {
  built = await author.call(`/builds/${build.id}`);
  if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(built.state)) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
succeeded(built);
assert.equal(built.input.samples[0].revisionId, sample.currentRevision.id);
assert.equal(built.input.samples[0].input.hash, sample.currentRevision.inputHash);
assert.equal(built.input.samples[0].answer.hash, sample.currentRevision.answerHash);
const pdf = await author.bytes(`/artifacts/${built.artifacts[0].id}/pdf`);
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
await writeFile(resolve(root, '.local/verify-p2-sample.pdf'), pdf);

// An edit creates another data version. The selected statement version remains
// immutable, and its historical input/answer remain readable under current auth.
const changed = await author.call(`/tests/${sample.id}`, 'PUT', { number: sample.number, groupName: sample.groupName, isSample: true, enabled: true, notes: '新数据版本；题面保留显式所选样例', expectedVersion: sample.version, inputBase64: b64('2 4\n'), answerBase64: b64('6\n') });
assert.notEqual(changed.currentRevision.id, sample.currentRevision.id);
const currentDoc = (await author.call(`/problems/${fixture.sumId}`)).documents.find((d: any) => d.id === doc.id);
assert.deepEqual(currentDoc.currentRevision.sampleRevisionIds, [sample.currentRevision.id]);
assert.equal((await author.call(`/builds/${build.id}`)).stale, false);
assert.deepEqual(await author.bytes(`/test-revisions/${sample.currentRevision.id}/input`), Buffer.from('1 2\n'));
console.log('PASS answer adoption, authorized immutable sample binding, real XeLaTeX PDF, data revision does not silently replace the selected sample.');
const spj = await author.waitRun((await submit(fixture.splitId, 'ACCEPTANCE')).id);
succeeded(spj); assert.equal(spj.currentValid, true);
await writeFile(resolve(root, '.local/verify-p2-results.json'), JSON.stringify({ checkedAt: new Date().toISOString(), checks: ['running task cancellation with actual sandbox termination', 'next task succeeds after cancel', 'safe file I/O and output/stdout separation', 'generated answer adopted as a new data revision', 'cross-problem and editorial sample bindings rejected', 'real sample PDF built with immutable raw input and answer', 'data edit preserves selected sample revision', 'restored SPJ currently valid'], runs: { canceled: canceled.id, fileIO: fileRun.id, answers: answers.id, spj: spj.id }, cancelElapsedMs, fileProblemId: problem.id, sample: { problemId: fixture.sumId, documentId: doc.id, revisionId: sample.currentRevision.id, newRevisionId: changed.currentRevision.id, buildId: built.id, artifactId: built.artifacts[0].id, pdfBytes: pdf.length } }, null, 2));
console.log('PASS P2 results integration. Evidence .local/verify-p2-results.json; inspect sample PDF in the browser and run current ordinary acceptance there.');
