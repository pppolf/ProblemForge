import { randomUUID } from 'node:crypto';
import { db, Prisma } from '@problemforge/database';
import { sha256 } from '@problemforge/domain';
import type { PrivateFileStorage } from '@problemforge/storage';
import { SandboxClient, InfrastructureError, type SandboxCommand, type SandboxResult } from '@problemforge/judge-adapter';
import { checkerVerdict, executionVerdict, validatorVerdict, type BlobRef, type ProgramSnapshot } from '@problemforge/judge-core';
import type { JudgeSettingsValue } from '@problemforge/contracts';

export class JudgeFailure extends Error { constructor(public code: string, message: string) { super(message); } }
type Context = { caseRef?: string; selfTestId?: string };
export type Captured = { id: string; result: SandboxResult; verdict: string; stdout: Buffer; stderr: Buffer; output: Buffer | null; outputRef: BlobRef | null; diagnostic: string };
export type Compiled = { program: ProgramSnapshot; executable: string; fileName: string };
const env = ['PATH=/usr/bin:/bin', 'HOME=/w', 'TMPDIR=/tmp', 'LANG=C.UTF-8', 'TZ=UTC'];

export class Executor {
  private cacheIds = new Set<string>(); private blobCache = new Map<string, string>();
  constructor(private runId: string, private sandbox: SandboxClient, private storage: PrivateFileStorage, private signal: AbortSignal, private testlib: string) {}
  checkCanceled() { if (this.signal.aborted) throw new JudgeFailure('EXECUTION_ABORTED', String(this.signal.reason ?? '执行已取消')); }
  async blob(ref: BlobRef) {
    const bytes = await this.storage.get(ref.key);
    if (bytes.length !== ref.bytes || sha256(bytes) !== ref.hash) throw new JudgeFailure('INPUT_HASH_MISMATCH', '任务私有数据快照的字节/哈希不匹配');
    return bytes;
  }
  async upload(bytes: Buffer) {
    this.checkCanceled(); const hash = sha256(bytes);
    const old = this.blobCache.get(hash); if (old) return old;
    const id = await this.sandbox.upload('input.bin', bytes); this.cacheIds.add(id); this.blobCache.set(hash, id); return id;
  }
  async save(bytes: Buffer, label = 'data'): Promise<BlobRef> {
    const hash = sha256(bytes), key = `judge/${this.runId}/${label}/${hash}.bin`;
    await this.storage.put(key, bytes); return { key, hash, bytes: bytes.length };
  }
  private command(args: string[], copyIn: SandboxCommand['copyIn'], cpuMs = 2000, memoryMb = 256, outputMax = 1_048_576, clockMs = Math.max(5000, cpuMs * 3)): SandboxCommand {
    return {
      args, env, copyIn, files: [{ content: '' }, { name: 'stdout', max: outputMax }, { name: 'stderr', max: 65536 }],
      cpuLimit: cpuMs * 1e6, clockLimit: clockMs * 1e6, memoryLimit: memoryMb * 1_048_576,
      stackLimit: Math.min(memoryMb, 64) * 1_048_576, procLimit: 16,
      copyOutCached: ['stdout', 'stderr'], copyOutMax: Math.max(outputMax, 65536),
    };
  }
  private async capture(program: ProgramSnapshot, command: SandboxCommand, phase: string, context: Context = {}, outputFile = 'stdout'): Promise<Captured> {
    this.checkCanceled();
    const [result] = await this.sandbox.execute(command, this.signal);
    for (const id of Object.values(result.fileIds ?? {})) this.cacheIds.add(id);
    // Raw streams are cached files: JSON's UTF-8 strings cannot preserve binary output.
    const get = async (name: string) => result.fileIds?.[name] ? this.sandbox.download(result.fileIds[name]) : Buffer.alloc(0);
    const stdout = await get('stdout'), stderr = await get('stderr');
    const output = result.fileIds?.[outputFile] ? (outputFile === 'stdout' ? stdout : await get(outputFile)) : null;
    if (result.status === 'Accepted' && (!result.fileIds?.stdout || !result.fileIds?.stderr)) throw new InfrastructureError('沙箱没有返回可保留原始字节的 stdout/stderr 文件');
    const stdoutRef = await this.save(stdout, 'stdout'), stderrRef = await this.save(stderr, 'stderr');
    const outputRef = output === null ? null : outputFile === 'stdout' ? stdoutRef : await this.save(output, 'file-output');
    let verdict: string = phase === 'COMPILE' ? executionVerdict(result) === 'AC' ? 'COMPILED' : 'CE'
      : phase.includes('VALIDATOR') ? validatorVerdict(result)
      : phase.includes('CHECKER') ? checkerVerdict(result) : executionVerdict(result);
    if (executionVerdict(result) === 'INFRA_ERROR') verdict = 'INFRA_ERROR';
    if (outputFile !== 'stdout' && output === null && verdict === 'AC') verdict = 'RE';
    if (this.signal.aborted) verdict = 'CANCELED';
    const diagnostic = [stderr.toString('utf8'), result.error, (result.fileError?.length ? JSON.stringify(result.fileError) : ''), outputFile !== 'stdout' && output === null ? `缺少输出文件 ${outputFile}` : ''].filter(Boolean).join('\n').slice(0, 16384);
    const invocation = await db.invocation.create({ data: {
      runId: this.runId, programId: program.id, programRevisionId: program.revisionId, ...context, phase, verdict, status: result.status, exitStatus: result.exitStatus ?? -1,
      timeMs: (result.time ?? 0) / 1e6, wallTimeMs: (result.runTime ?? 0) / 1e6, memoryBytes: result.memory ?? 0,
      stdoutKey: stdoutRef.key, stdoutHash: stdoutRef.hash, stdoutBytes: stdout.length, stderrKey: stderrRef.key, stderrBytes: stderr.length,
      diagnostic, detail: { output: outputRef, sandboxError: result.error ?? null, fileErrors: result.fileError ?? [] } as unknown as Prisma.InputJsonValue,
    } });
    await db.testRun.update({ where: { id: this.runId }, data: { completed: { increment: 1 }, stage: `${phase} · ${program.name}${context.caseRef ? ` · ${context.caseRef}` : ''}` } });
    this.checkCanceled();
    if (verdict === 'INFRA_ERROR') throw new InfrastructureError(diagnostic || 'Linux 沙箱初始化/输入复制失败');
    return { id: invocation.id, result, verdict, stdout, stderr, output, outputRef, diagnostic };
  }
  async compile(program: ProgramSnapshot): Promise<{ compiled: Compiled | null; execution: Captured }> {
    const profile = program.profile.config;
    const isPython = program.profile.language === 'PYTHON3', fileName = isPython ? 'source.py' : 'source.cpp';
    const sourceId = await this.upload(Buffer.from(program.source));
    const args = isPython ? ['/usr/bin/python3', '-I', '-m', 'py_compile', fileName]
      : ['/usr/bin/g++', `-std=${program.profile.language === 'CPP20' ? 'c++20' : 'c++17'}`, `-${profile.optimization}`, '-pipe', ...(profile.warnings ? ['-Wall', '-Wextra'] : []), fileName, '-o', 'program'];
    const command = this.command(args, { [fileName]: { fileId: sourceId }, ...(!isPython ? { 'testlib.h': { content: this.testlib } } : {}) }, profile.compileTimeMs, profile.compileMemoryMb, 262144, 30000);
    command.procLimit = 64; command.copyOutMax = 8_388_608;
    if (!isPython) command.copyOutCached!.push('program?');
    const execution = await this.capture(program, command, 'COMPILE');
    const executable = isPython ? sourceId : execution.result.fileIds?.program;
    if (execution.verdict !== 'COMPILED' || !executable) {
      await db.invocation.update({ where: { id: execution.id }, data: { verdict: 'CE' } }); return { compiled: null, execution: { ...execution, verdict: 'CE' } };
    }
    return { compiled: { program, executable, fileName: isPython ? fileName : 'program' }, execution };
  }
  private runArgs(compiled: Compiled, argv: string[]) {
    return compiled.program.profile.language === 'PYTHON3' ? ['/usr/bin/python3', '-I', '-B', `/w/${compiled.fileName}`, ...argv] : [`/w/${compiled.fileName}`, ...argv];
  }
  async generate(compiled: Compiled, argv: string[], seed: string, caseRef: string, repeat = false) {
    const cmd = this.command(this.runArgs(compiled, [...argv, seed]), { [compiled.fileName]: { fileId: compiled.executable } });
    cmd.env = [...env, `PF_SEED=${seed}`];
    return this.capture(compiled.program, cmd, repeat ? 'GENERATOR_REPEAT' : 'GENERATOR', { caseRef });
  }
  async validate(compiled: Compiled, input: Buffer, context: Context) {
    const cmd = this.command(this.runArgs(compiled, []), { [compiled.fileName]: { fileId: compiled.executable } });
    cmd.files[0] = { fileId: await this.upload(input) };
    return this.capture(compiled.program, cmd, 'VALIDATOR', context);
  }
  async solution(compiled: Compiled, input: Buffer, settings: JudgeSettingsValue, caseRef: string, main = false) {
    const cmd = this.command(this.runArgs(compiled, []), { [compiled.fileName]: { fileId: compiled.executable } }, settings.timeLimitMs, settings.memoryLimitMb, settings.outputLimitBytes);
    let outputFile = 'stdout';
    if (settings.ioMode === 'FILES') {
      cmd.copyIn[settings.inputFile] = { fileId: await this.upload(input) };
      outputFile = settings.outputFile; cmd.copyOutCached!.push(`${outputFile}?`);
    } else cmd.files[0] = { fileId: await this.upload(input) };
    return this.capture(compiled.program, cmd, main ? 'MAIN_SOLUTION' : 'SOLUTION', { caseRef }, outputFile);
  }
  async check(compiled: Compiled, input: Buffer, answer: Buffer, output: Buffer, context: Context, phase = 'CHECKER') {
    const copyIn: SandboxCommand['copyIn'] = { [compiled.fileName]: { fileId: compiled.executable },
      'checker-input': { fileId: await this.upload(input) }, 'checker-answer': { fileId: await this.upload(answer) }, 'checker-output': { fileId: await this.upload(output) } };
    // Fixed testlib ordering is input, contestant output, jury answer.
    return this.capture(compiled.program, this.command(this.runArgs(compiled, ['checker-input', 'checker-output', 'checker-answer']), copyIn), phase, context);
  }
  async cleanup() { await Promise.allSettled([...this.cacheIds].map(id => this.sandbox.delete(id))); }
}
