import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { db } from '@problemforge/database';
import { sha256 } from '@problemforge/domain';
import { defaultJudgeSettings, type ProgramLanguage, type ProgramRole } from '@problemforge/contracts';
import { Executor, type Compiled } from '../workers/judge/src/executor.ts';
import { SandboxFiles } from '../workers/judge/src/sandbox-files.ts';
import type { ProgramSnapshot } from '../packages/judge-core/src/index.ts';
import type { SandboxClient, SandboxCommand, SandboxResult } from '../packages/judge-adapter/src/index.ts';

// Real Executor + file ownership logic; no socket, database connection, queue or
// author execution. The fake file service enforces a finite byte capacity.
class FileService {
  files = new Map<string, Buffer>();
  serial = 0; uploads = 0; peakBytes = 0; capacity = 12 * 1024 * 1024;
  failUploadAt = 0; failDownload = false; failExecute = false; compileFails = false;
  failedDeletes = 0; afterExecute?: () => void;
  output = Buffer.from([0, 255, 1, 128, 10]);
  commands: SandboxCommand[] = [];
  deleted: string[] = [];
  get bytes() { return [...this.files.values()].reduce((sum, bytes) => sum + bytes.length, 0); }
  add(bytes: Buffer) {
    assert(this.bytes + bytes.length <= this.capacity, 'simulated /dev/shm capacity exceeded');
    const id = `file-${++this.serial}`; this.files.set(id, Buffer.from(bytes));
    this.peakBytes = Math.max(this.peakBytes, this.bytes); return id;
  }
  async upload(_name: string, bytes: Buffer) {
    if (++this.uploads === this.failUploadAt) throw new Error('upload failed');
    return this.add(bytes);
  }
  async delete(id: string) {
    if (this.failedDeletes > 0) { this.failedDeletes--; throw new Error('temporary delete failure'); }
    assert(this.files.delete(id), `already deleted or unknown: ${id}`); this.deleted.push(id);
  }
  async download(id: string) {
    if (this.failDownload) throw new Error('download failed');
    assert(this.files.has(id), `file released before download: ${id}`);
    return Buffer.from(this.files.get(id)!);
  }
  inspect(command: SandboxCommand) {
    this.commands.push(command);
    for (const file of [...Object.values(command.copyIn), ...command.files]) {
      if (file && 'fileId' in file) assert(this.files.has(file.fileId), `pending command lost file: ${file.fileId}`);
    }
  }
  result(command: SandboxCommand): SandboxResult {
    const fileIds: Record<string, string> = {};
    for (const raw of command.copyOutCached ?? []) {
      const name = raw.replace(/\?$/, '');
      if (this.compileFails && ['program', 'program.jar'].includes(name)) continue;
      fileIds[name] = this.add(name === 'stderr' ? Buffer.from('diagnostic') : name === 'transcript.jsonl' ? Buffer.from('{"kind":"INTERACTOR_EXIT","exitCode":0}\n') : this.output);
    }
    return { status: this.compileFails ? 'Nonzero Exit Status' : 'Accepted', exitStatus: this.compileFails ? 1 : 0, time: 1, memory: 1, runTime: 1, fileIds };
  }
  async execute(command: SandboxCommand) {
    this.inspect(command); if (this.failExecute) throw new Error('execution failed');
    const result = this.result(command); this.afterExecute?.(); return [result];
  }
  async executeInteractive(commands: SandboxCommand[]) {
    commands.forEach(command => this.inspect(command));
    if (this.failExecute) throw new Error('execution failed');
    const results = commands.map(command => this.result(command));
    // The real proxy collects each peer's stdout independently of copyOutCached.
    for (const result of results.slice(0, 2)) result.fileIds!.stdout ??= this.add(this.output);
    this.afterExecute?.(); return { results };
  }
}

function program(language: ProgramLanguage = 'CPP20', role: ProgramRole = 'MAIN_SOLUTION'): ProgramSnapshot {
  const source = language === 'PYTHON3' ? 'print(1)' : 'int main(){}';
  return { id: `program-${language}-${role}`, revisionId: 'revision', version: 1, name: 'fixture', role, enabled: true, source, sourceHash: sha256(Buffer.from(source)), expectedVerdicts: ['AC'],
    profile: { id: 'profile', name: 'fixture', version: 1, language, hash: `profile-${language}`, enabled: true, config: { optimization: 'O2', warnings: true, compileTimeMs: 1000, compileMemoryMb: 128 } } };
}
function fixture(t: TestContext) {
  const sandbox = new FileService(), stored = new Map<string, Buffer>(), invocations: any[] = [], abort = new AbortController();
  const state = { failSave: false, failInvocation: false, failProgress: false, cache: null as any };
  const stub = (target: any, method: string, implementation: (...args: any[]) => any) => {
    const saved = target[method]; target[method] = implementation;
    t.after(() => { target[method] = saved; });
  };
  stub(db.invocation, 'create', async ({ data }: any) => { if (state.failInvocation) throw new Error('invocation failed'); invocations.push(data); return { id: `invocation-${invocations.length}` }; });
  stub(db.invocation, 'update', async () => ({}));
  stub(db.compileProfile, 'findUnique', async () => ({ enabled: true }));
  stub(db.compileCache, 'findUnique', async () => state.cache);
  stub(db.compileCache, 'deleteMany', async () => ({ count: 1 }));
  stub(db.compileCache, 'upsert', async ({ create }: any) => { state.cache = create; return create; });
  const storage = {
    put: async (key: string, bytes: Buffer) => { if (state.failSave) throw new Error('storage failed'); stored.set(key, Buffer.from(bytes)); },
    get: async (key: string) => { assert(stored.has(key)); return Buffer.from(stored.get(key)!); },
  };
  const executor = new Executor('fixture', sandbox as unknown as SandboxClient, storage as any, abort.signal, '', { problemId: 'fixture', leaseToken: 'fixture' });
  executor.progress = async () => { if (state.failProgress) throw new Error('progress failed'); return { count: 1 }; };
  const compiled = async (role: ProgramRole = 'MAIN_SOLUTION'): Promise<Compiled> => ({ program: program('CPP20', role), executable: await executor.upload(Buffer.from(role)), fileName: 'program' });
  t.after(async () => { await executor.cleanup(); assert.equal(sandbox.files.size, 0); });
  return { sandbox, executor, stored, state, abort, invocations, compiled };
}

test('repeated large inputs and outputs stay bounded while executable survives every case', async t => {
  const f = fixture(t), compiled = await f.compiled();
  f.sandbox.output = Buffer.alloc(1024 * 1024, 255);
  for (let i = 0; i < 16; i++) {
    const bytes = Buffer.alloc(4 * 1024 * 1024, i);
    const generated = await f.executor.generate(compiled, [], String(i), `case-${i}`);
    assert.deepEqual(generated.output, f.sandbox.output);
    await f.executor.validate(compiled, bytes, { caseRef: `case-${i}` });
    const result = await f.executor.solution(compiled, bytes, defaultJudgeSettings, `case-${i}`);
    await f.executor.check(compiled, bytes, result.output!, result.output!, { caseRef: `case-${i}` });
    assert.deepEqual([...f.sandbox.files.keys()], [compiled.executable]);
    assert.deepEqual(f.stored.get(result.outputRef!.key), f.sandbox.output);
  }
  assert(f.sandbox.peakBytes < 8 * 1024 * 1024);
  assert.equal(f.sandbox.uploads, 1 + 16 * 4, 'fresh input scope for each invocation; checker answer/output deduplicate only within that scope');
});

test('file-mode outputs are persisted intact and all temporary files are released before return', async t => {
  const f = fixture(t), compiled = await f.compiled();
  const result = await f.executor.solution(compiled, Buffer.from('file input'), { ...defaultJudgeSettings, ioMode: 'FILES' }, 'file-case');
  assert.deepEqual(result.output, f.sandbox.output);
  assert.deepEqual(f.stored.get(result.outputRef!.key), f.sandbox.output);
  assert.deepEqual([...f.sandbox.files.keys()], [compiled.executable]);
  assert(f.sandbox.commands.at(-1)!.copyIn['input.txt']);
});

for (const language of ['CPP20', 'JAVA17', 'PYTHON3'] as const) {
  test(`${language} compile retains only its executable and reuses it across cases`, async t => {
    const f = fixture(t), result = await f.executor.compile(program(language));
    assert(result.compiled);
    assert.deepEqual([...f.sandbox.files.keys()], [result.compiled.executable]);
    for (let i = 0; i < 3; i++) await f.executor.solution(result.compiled, Buffer.from(String(i)), defaultJudgeSettings, `case-${i}`);
    assert.deepEqual([...f.sandbox.files.keys()], [result.compiled.executable]);
    if (language === 'PYTHON3') assert.deepEqual(f.sandbox.files.get(result.compiled.executable), Buffer.from(program(language).source));
    // The same verified storage cache takes a new task-lifetime file ID.
    const cached = await f.executor.compile(program(language));
    assert(cached.compiled); assert.equal(cached.execution.result.status, 'Cached');
    assert.notEqual(cached.compiled.executable, result.compiled.executable);
    assert.equal(f.sandbox.files.size, 2);
  });
}

test('failed compile does not pin source or partial output files', async t => {
  const f = fixture(t); f.sandbox.compileFails = true;
  const result = await f.executor.compile(program());
  assert.equal(result.compiled, null); assert.equal(result.execution.verdict, 'CE');
  assert.equal(f.sandbox.files.size, 0);
});

for (const failure of ['invocation', 'progress'] as const) {
  test(`compile ${failure} persistence failure does not promote its executable`, async t => {
    const f = fixture(t);
    if (failure === 'invocation') f.state.failInvocation = true; else f.state.failProgress = true;
    await assert.rejects(f.executor.compile(program()), /failed/);
    assert.equal(f.sandbox.files.size, 0);
  });
}

test('compile cache progress failure releases the newly uploaded cache artifact', async t => {
  const f = fixture(t), first = await f.executor.compile(program());
  assert(first.compiled); f.state.failProgress = true;
  await assert.rejects(f.executor.compile(program()), /progress failed/);
  assert.deepEqual([...f.sandbox.files.keys()], [first.compiled.executable]);
});

test('partial checker upload failure releases previous inputs without deleting executable', async t => {
  const f = fixture(t), compiled = await f.compiled('CHECKER');
  f.sandbox.failUploadAt = f.sandbox.uploads + 3;
  await assert.rejects(f.executor.check(compiled, Buffer.from('input'), Buffer.from('answer'), Buffer.from('output'), {}), /upload failed/);
  assert.equal(f.sandbox.commands.length, 0);
  assert.deepEqual([...f.sandbox.files.keys()], [compiled.executable]);
});

for (const failure of ['execute', 'download', 'save', 'cancel'] as const) {
  test(`${failure} failure releases scope files and retains executable for final cleanup`, async t => {
    const f = fixture(t), compiled = await f.compiled();
    if (failure === 'execute') f.sandbox.failExecute = true;
    if (failure === 'download') f.sandbox.failDownload = true;
    if (failure === 'save') f.state.failSave = true;
    if (failure === 'cancel') f.sandbox.afterExecute = () => f.abort.abort('fixture cancellation');
    await assert.rejects(f.executor.solution(compiled, Buffer.from('input'), defaultJudgeSettings, 'case'), failure === 'cancel' ? /fixture cancellation/ : /failed/);
    assert.deepEqual([...f.sandbox.files.keys()], [compiled.executable]);
  });
}

test('three-process interaction keeps pending inputs then releases transcript and both peer outputs', async t => {
  const f = fixture(t), player = await f.compiled(), interactor = await f.compiled('INTERACTOR');
  for (let i = 0; i < 4; i++) {
    const result = await f.executor.interactive(player, interactor, Buffer.from(`input-${i}`), Buffer.from(`answer-${i}`), defaultJudgeSettings, `case-${i}`);
    assert.equal(result.verdict, 'AC');
    assert.deepEqual(result.output, f.sandbox.output);
    assert.deepEqual([...f.sandbox.files.keys()], [player.executable, interactor.executable]);
  }
  assert.equal(f.invocations.length, 8);
  assert([...f.stored.keys()].some(key => key.includes('interaction-transcript')));
  const tool = f.sandbox.commands[1], playerCommand = f.sandbox.commands[0];
  assert(tool.copyIn['hidden-input']); assert(!playerCommand.copyIn['hidden-input']);
});

test('failed interaction persistence cleans all three result sets, not just first captured peer', async t => {
  const f = fixture(t), player = await f.compiled(), interactor = await f.compiled('INTERACTOR');
  f.state.failSave = true;
  await assert.rejects(f.executor.interactive(player, interactor, Buffer.from('input'), null, defaultJudgeSettings, 'case'), /storage failed/);
  assert.deepEqual([...f.sandbox.files.keys()], [player.executable, interactor.executable]);
});

test('interaction cancellation still captures both peers and releases all temporary IDs', async t => {
  const f = fixture(t), player = await f.compiled(), interactor = await f.compiled('INTERACTOR');
  f.sandbox.afterExecute = () => f.abort.abort('interaction canceled');
  await assert.rejects(f.executor.interactive(player, interactor, Buffer.from('input'), null, defaultJudgeSettings, 'case'), /interaction canceled/);
  assert.deepEqual(f.invocations.map(invocation => [invocation.phase, invocation.verdict]), [['SOLUTION', 'CANCELED'], ['INTERACTOR', 'CANCELED']]);
  assert.deepEqual([...f.sandbox.files.keys()], [player.executable, interactor.executable]);
});

test('scope upload deduplication never invalidates pending aliases; failed deletion is retried by task cleanup', async () => {
  const sandbox = new FileService(), files = new SandboxFiles(sandbox as unknown as SandboxClient);
  await files.using(async scope => {
    const id = await scope.upload(Buffer.from('same input'));
    assert.equal(await scope.upload(Buffer.from('same input')), id);
    assert(sandbox.files.has(id));
    sandbox.failedDeletes = 1;
  });
  assert.equal(sandbox.files.size, 1);
  await files.cleanup();
  assert.equal(sandbox.files.size, 0);
  await files.cleanup();
  assert.equal(sandbox.deleted.length, 1);
});
