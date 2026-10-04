import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { config } from '@problemforge/domain';
import { isCppLanguage, type ProgramLanguage } from '@problemforge/contracts';
import { checkerVerdict, validatorVerdict } from '../packages/judge-core/src/index.ts';
import { SandboxClient, type SandboxCommand } from '../packages/judge-adapter/src/index.ts';
import { compilePlan, runtimeArgs } from '../workers/judge/src/languages.ts';
import { programTemplates, templateSource } from '../apps/web/src/program-templates.ts';

if (!process.argv.includes('--sandbox')) throw new Error('请显式指定 --sandbox；仅在原独立 Linux Judge 沙箱执行示例');
const sandbox = new SandboxClient(config.judgeSandboxUrl, config.judgeSandboxToken!);
const testlib = await readFile('vendor/testlib/testlib.h', 'utf8');
const ids: string[] = [], checks: string[] = [];
const compiled = new Map<string, { language: ProgramLanguage; fileId: string; name: string }>();
const command = (args: string[], copyIn: SandboxCommand['copyIn'], input = ''): SandboxCommand => ({
  args, env: ['PATH=/usr/bin:/bin', 'HOME=/w', 'TMPDIR=/tmp', 'LANG=C.UTF-8', 'TZ=UTC'],
  files: [{ content: input }, { name: 'stdout', max: 262144 }, { name: 'stderr', max: 262144 }],
  cpuLimit: 2e9, clockLimit: 5e9, memoryLimit: 256 * 1048576, stackLimit: 64 * 1048576, procLimit: 64,
  copyIn, copyOutMax: 1048576,
});
function runCommand(id: string, language: ProgramLanguage, argv: string[] = [], input = '', extra: SandboxCommand['copyIn'] = {}) {
  const item = compiled.get(`${id}:${language}`)!; assert.ok(item, `not compiled: ${id}:${language}`);
  return command(runtimeArgs(language, item.name, argv, 256), { [item.name]: { fileId: item.fileId }, ...extra }, input);
}
async function run(id: string, language: ProgramLanguage, argv: string[] = [], input = '', extra: SandboxCommand['copyIn'] = {}) {
  const cmd = runCommand(id, language, argv, input, extra);
  if (id.startsWith('generator-')) cmd.env.push(`PF_SEED=${argv.at(-1)}`);
  return (await sandbox.execute(cmd))[0];
}
try {
  for (const template of programTemplates) for (const language of Object.keys(template.sources) as ProgramLanguage[]) {
    const plan = compilePlan(language, { optimization: 'O2', warnings: true, compileTimeMs: 15000, compileMemoryMb: 512 });
    const cmd = command(plan.args, { [plan.source]: { content: templateSource(template, language)! }, ...(isCppLanguage(language) ? { 'testlib.h': { content: testlib } } : {}) });
    const [result] = await sandbox.execute({ ...cmd, cpuLimit: 15e9, clockLimit: 30e9, memoryLimit: 512 * 1048576, copyOutCached: [plan.artifact] });
    ids.push(...Object.values(result.fileIds ?? {}));
    assert.equal(result.status, 'Accepted', `${template.id}:${language}: ${result.files?.stderr}`);
    assert.equal(result.exitStatus, 0); assert.ok(result.fileIds?.[plan.artifact]);
    compiled.set(`${template.id}:${language}`, { language, name: plan.artifact, fileId: result.fileIds[plan.artifact] });
  }
  checks.push(`${compiled.size} source variants compile with fixed platform C++17/C17/Java17/Python3 plans`);
  console.log(checks.at(-1));
  for (const language of ['CPP17', 'C17', 'JAVA17', 'PYTHON3'] as const) {
    const result = await run('solution-basic', language, [], '3 5\n');
    assert.equal(result.status, 'Accepted'); assert.equal(result.files?.stdout, '8\n');
  }
  for (const language of ['CPP17', 'PYTHON3'] as const) {
    const a = await run('generator-array', language, ['10', '100', '42']);
    const b = await run('generator-array', language, ['10', '100', '42']);
    const c = await run('generator-array', language, ['10', '100', '43']);
    for (const result of [a, b, c]) assert.equal(result.status, 'Accepted', result.files?.stderr);
    assert.equal(a.files?.stdout, b.files?.stdout); assert.notEqual(a.files?.stdout, c.files?.stdout);
    const values = a.files!.stdout.trim().split(/\s+/).map(Number);
    assert.equal(values[0], 10); assert.equal(values.length, 11); assert(values.slice(1).every(n => Number.isInteger(n) && n >= 1 && n <= 100));
    assert.equal(validatorVerdict(await run('validator-array', 'CPP17', [], a.files!.stdout)), 'ACCEPT');
    assert.notEqual((await run('generator-array', language, ['0', '100', '42'])).exitStatus, 0);
  }
  const permutation = await run('generator-permutation', 'CPP17', ['10', '42']);
  assert.equal(permutation.status, 'Accepted');
  assert.deepEqual(permutation.files!.stdout.trim().split(/\s+/).map(Number).slice(1).sort((a, b) => a - b), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.equal((await run('generator-permutation', 'CPP17', ['10', '42'])).files?.stdout, permutation.files?.stdout);
  for (const invalid of ['0\n\n', '2\n1 1000000001\n', '2\n1 2', '2\n1 2\nextra\n']) assert.equal(validatorVerdict(await run('validator-array', 'CPP17', [], invalid)), 'REJECT');
  checks.push('four-language I/O, deterministic seeded array/permutation generators, valid generated input and validator range/format/EOF rejections');
  for (const [id, input, answer, outputs] of [
    ['checker-integer', '3 5\n', '8\n', [['8\n', 'AC'], ['9\n', 'WA'], ['8 extra\n', 'PE']]],
    ['checker-construction', '10\n', '5 5\n', [['3 7\n', 'AC'], ['3 6\n', 'WA'], ['3 7 extra\n', 'PE']]],
  ] as const) for (const [output, expected] of outputs) {
    const result = await run(id, 'CPP17', ['input.txt', 'output.txt', 'answer.txt'], '', { 'input.txt': { content: input }, 'output.txt': { content: output }, 'answer.txt': { content: answer } });
    assert.equal(checkerVerdict(result), expected, `${id}: ${result.files?.stderr}`);
  }
  for (const language of ['CPP17', 'PYTHON3'] as const) {
    const player = runCommand('solution-interactive', language);
    const interactor = runCommand('interactor-double', 'CPP17', ['hidden.in', 'result.txt', 'answer.txt'], '', { 'hidden.in': { content: '7\n' }, 'answer.txt': { content: '' } });
    for (const cmd of [player, interactor]) { cmd.files[0] = null; cmd.files[1] = null; }
    interactor.copyOut = ['result.txt'];
    const result = await sandbox.executeInteractive([player, interactor], [
      { in: { index: 0, fd: 1 }, out: { index: 1, fd: 0 } },
      { in: { index: 1, fd: 1 }, out: { index: 0, fd: 0 } },
    ], 5000);
    assert.equal(result.results[0].status, 'Accepted');
    assert.equal(checkerVerdict(result.results[1]), 'AC', result.results[1].files?.stderr);
    assert.equal(result.results[1].files?.['result.txt'], '14\n');
  }
  const rejected = await run('interactor-double', 'CPP17', ['hidden.in', 'result.txt', 'answer.txt'], '15\n', { 'hidden.in': { content: '7\n' }, 'answer.txt': { content: '' } });
  assert.equal(checkerVerdict(rejected), 'WA');
  checks.push('both checker templates return AC/WA/PE; C++ and Python interactive solutions exchange data over real bidirectional pipes, flush, finish AC, and wrong replies are rejected');
} finally { for (const id of ids) await sandbox.delete(id); }
await mkdir('.local/program-templates', { recursive: true });
await writeFile('.local/program-templates/sandbox-verification.json', JSON.stringify({ passed: true, checks, databaseWrites: 0, cachedFilesCleaned: ids.length }, null, 2));
console.log(JSON.stringify({ passed: true, checks, databaseWrites: 0, cachedFilesCleaned: ids.length }, null, 2));
process.exit(0);
