import { readFile } from 'node:fs/promises';
import { db, type Prisma } from '@problemforge/database';
import { sha256 } from '@problemforge/domain';
import { defaultCommunicationSettings, MAX_TEST_BYTES, type JudgeSettingsValue } from '@problemforge/contracts';
import { InfrastructureError, type SandboxPipe, type InteractionStop } from '@problemforge/judge-adapter';
import { interactionVerdict, checkerVerdict, INTERACTION_POLICY } from '@problemforge/judge-core';
import { Executor, type Captured, type Compiled, JudgeFailure } from './executor.ts';

const relay = await readFile(new URL('./interaction-relay.py', import.meta.url));
const runner = await readFile(new URL('./interactor-runner.py', import.meta.url));
if (`interaction-v1-${sha256(Buffer.concat([relay, runner]))}` !== INTERACTION_POLICY) throw new Error('交互中继策略哈希不匹配');

// Lightweight trusted watchdog inside Linux sandbox: reads the Interactor supervisor's
// exit event on fd 3 and echoes it to go-judge's control streamOut without holding any
// author data pipe open (so contestant EOF reaches Interactor's ouf.seekEof() immediately).
const WATCHDOG_PY = [
  'import os, sys',
  'buf = bytearray()',
  'while True:',
  '    chunk = os.read(3, 1024)',
  '    if not chunk: break',
  '    buf.extend(chunk)',
  '    if b"\\n" in buf:',
  '        sys.stdout.write(buf.split(b"\\n", 1)[0].decode("utf-8", "replace") + "\\n")',
  '        sys.stdout.flush()',
  '        break',
].join('\n') + '\n';

function buildCommunicationTranscript(interactorOut: Buffer, contestantOut: Buffer, maxBytes: number, authorExit?: number): Buffer {
  const events: Record<string, unknown>[] = [];
  let seq = 0;
  let remaining = maxBytes;
  const pushData = (direction: string, data: Buffer) => {
    if (!data.length) return;
    const shown = data.subarray(0, Math.max(0, remaining));
    remaining -= shown.length;
    if (shown.length) events.push({ seq: ++seq, kind: 'DATA', direction, base64: shown.toString('base64') });
    if (shown.length < data.length) events.push({ seq: ++seq, kind: 'TRUNCATED', direction });
  };
  pushData('INTERACTOR_TO_CONTESTANT', interactorOut);
  pushData('CONTESTANT_TO_INTERACTOR', contestantOut);
  if (authorExit !== undefined) events.push({ seq: ++seq, kind: 'INTERACTOR_EXIT', exitCode: authorExit });
  events.push({ seq: ++seq, kind: 'END' });
  return Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
}

/**
 * Two-pass communication execution (NovaJudge / Polygon Run-Twice model):
 * - Pass 1 (first): isolated contestant process <-> Interactor via direct go-judge proxy pipes;
 *   contestant EOF immediately reaches Interactor's ouf.seekEof(), and Interactor writes
 *   the second-pass input to `tout` (`interaction-output`).
 * - Pass 2 (second): fresh isolated contestant process receives `tout` on stdin and
 *   produces the final output for Checker / built-in comparison.
 * Both passes enjoy independent CPU time and memory limits.
 */
export async function runCommunication(
  executor: Executor,
  contestant: Compiled,
  interactor: Compiled,
  input: Buffer,
  answer: Buffer | null,
  settings: JudgeSettingsValue,
  caseRef: string,
  main: boolean,
): Promise<Captured> {
  executor.checkCanceled();
  const comm = { ...defaultCommunicationSettings, ...settings.communication };
  const pipeLimit = Math.max(comm.outputLimitBytes, settings.outputLimitBytes);
  const pass1ClockMs = Math.min(comm.wallTimeMs, Math.max(settings.timeLimitMs * 3, comm.idleTimeMs + 1000));

  // First pass runs inside its own SandboxFileScope so temporary files are freed before Pass 2.
  const pass1 = await executor.withFiles(async files => {
    const player = executor.programCommand(contestant, [], settings.timeLimitMs, settings.memoryLimitMb, comm.outputLimitBytes, pass1ClockMs);
    const tool = executor.command(
      ['/usr/bin/python3', '-I', '-B', '/w/interactor-runner.py', ...executor.runArgs(interactor, ['hidden-input', 'interaction-output', 'jury-answer'])],
      {
        'interactor-runner.py': { fileId: await executor.upload(runner, files) },
        [interactor.fileName]: { fileId: interactor.executable },
        'hidden-input': { fileId: await executor.upload(input, files) },
        'jury-answer': { fileId: await executor.upload(answer ?? Buffer.alloc(0), files) },
      },
      comm.interactorTimeMs,
      comm.interactorMemoryMb,
      pipeLimit,
      comm.wallTimeMs,
    );
    for (const command of [player, tool]) { command.files[0] = null; command.files[1] = null; }
    tool.copyOutCached!.push('interaction-output?');
    tool.copyOutMax = Math.max(pipeLimit, 65536);

    const watchdog = executor.command(
      ['/usr/bin/python3', '-I', '-B', '/w/watchdog.py'],
      { 'watchdog.py': { fileId: await executor.upload(Buffer.from(WATCHDOG_PY, 'utf8'), files) } },
      2000,
      64,
      65536,
      comm.wallTimeMs,
    );
    watchdog.files[1] = { streamOut: true };
    watchdog.copyOutCached = ['stderr'];

    const pipeMapping: SandboxPipe[] = [
      { in: { index: 0, fd: 1 }, out: { index: 1, fd: 0 }, proxy: true, name: 'stdout', max: comm.outputLimitBytes + 1 },
      { in: { index: 1, fd: 1 }, out: { index: 0, fd: 0 }, proxy: true, name: 'stdout', max: pipeLimit + 1 },
      { in: { index: 1, fd: 3 }, out: { index: 2, fd: 3 } },
    ];

    const execution = await executor.sandbox.executeInteractive([player, tool, watchdog], pipeMapping, comm.wallTimeMs, executor.signal);
    const results = execution.results;
    for (const result of results) files.trackResult(result);
    await files.releaseInputs();
    await files.release(Object.values(results[2].fileIds ?? {}));

    const stop: InteractionStop | undefined = execution.stop;
    const verdict = interactionVerdict(results[0], results[1], results[2], stop);
    const pass1Succeeded = verdict.verdict === 'AC' && !executor.signal.aborted;

    const playerResult = await executor.captureResult(
      contestant.program,
      results[0],
      pass1Succeeded ? 'COMMUNICATION_PASS1' : main ? 'MAIN_SOLUTION' : 'SOLUTION',
      { caseRef },
      'stdout',
      true,
      files,
    );
    const toolResult = await executor.captureResult(interactor.program, results[1], 'INTERACTOR', { caseRef }, 'interaction-output', true, files);

    const authorExit = stop?.kind === 'INTERACTOR_EXIT' ? stop.exitCode : undefined;
    const transcriptBytes = buildCommunicationTranscript(toolResult.stdout, playerResult.stdout, comm.transcriptBytes, authorExit);
    const transcript = await executor.save(transcriptBytes, 'communication-transcript');

    const pass1Diagnostic = `[第 1 轮 first] ${verdict.diagnostic}\n选手第 1 轮: ${results[0].status} / exit=${results[0].exitStatus} (${(results[0].time / 1e6).toFixed(1)} ms)\nInteractor: ${results[1].status} / exit=${results[1].exitStatus}\n${toolResult.diagnostic}`.trim();
    const forwardedInput = toolResult.output ?? Buffer.alloc(0);
    const forwardedInputRef = toolResult.outputRef ?? await executor.save(forwardedInput, 'communication-second-input');

    const playerDetail = {
      stage: 'PASS1',
      output: playerResult.outputRef,
      forwardedInput: forwardedInputRef,
      interactorInvocationId: toolResult.id,
      transcript,
      stop: stop ?? null,
      watchdogStatus: results[2].status,
    };
    await db.invocation.update({
      where: { id: playerResult.id },
      data: { verdict: executor.signal.aborted ? 'CANCELED' : verdict.verdict, diagnostic: pass1Diagnostic, detail: playerDetail as unknown as Prisma.InputJsonValue },
    });

    const authorVerdict = authorExit === undefined
      ? toolResult.verdict
      : checkerVerdict({ ...results[1], exitStatus: Math.abs(authorExit), status: authorExit === 0 ? 'Accepted' : authorExit < 0 ? 'Signalled' : 'Nonzero Exit Status' });
    await db.invocation.update({
      where: { id: toolResult.id },
      data: {
        verdict: executor.signal.aborted ? 'CANCELED' : authorVerdict,
        diagnostic: `[第 1 轮 Interactor] ${toolResult.diagnostic}${authorExit === undefined ? '' : `\nInteractor 子进程实际退出码：${authorExit}`}`,
        detail: {
          stage: 'PASS1_INTERACTOR',
          output: forwardedInputRef,
          forwardedInput: forwardedInputRef,
          transcript,
          contestantInvocationId: playerResult.id,
          stop: stop ?? null,
          authorExit: authorExit ?? null,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    executor.checkCanceled();
    if (verdict.verdict === 'INFRA_ERROR') throw new InfrastructureError(pass1Diagnostic);
    if (verdict.verdict === 'TOOL_ERROR') throw new JudgeFailure('INTERACTOR_TOOL_ERROR', pass1Diagnostic);
    if (pass1Succeeded && forwardedInput.length > MAX_TEST_BYTES) {
      throw new JudgeFailure('INTERACTOR_TOOL_ERROR', `Interactor 生成的第 2 轮输入超过上限（${MAX_TEST_BYTES} 字节）`);
    }
    return {
      verdict: verdict.verdict,
      diagnostic: pass1Diagnostic,
      playerResult,
      toolResult,
      transcript,
      forwardedInput,
      forwardedInputRef,
    };
  });

  if (pass1.verdict !== 'AC') {
    return { ...pass1.playerResult, verdict: pass1.verdict, diagnostic: pass1.diagnostic };
  }

  // Pass 2 (second): completely fresh isolated process with independent CPU & memory limits.
  const pass2 = await executor.withFiles(async files => {
    const cmd = executor.programCommand(contestant, [], settings.timeLimitMs, settings.memoryLimitMb, settings.outputLimitBytes);
    cmd.files[0] = { fileId: await executor.upload(pass1.forwardedInput, files) };
    const [result] = await executor.sandbox.execute(cmd, executor.signal);
    files.trackResult(result);
    await files.releaseInputs();
    return executor.captureResult(contestant.program, result, main ? 'MAIN_SOLUTION' : 'SOLUTION', { caseRef }, 'stdout', false, files);
  });

  const pass1TimeMs = pass1.playerResult.result.time / 1e6;
  const pass2TimeMs = pass2.result.time / 1e6;
  const pass1MemoryBytes = pass1.playerResult.result.memory;
  const pass2MemoryBytes = pass2.result.memory;
  const summary = `第 1 轮 (first): ${pass1TimeMs.toFixed(1)} ms / ${(pass1MemoryBytes / 1048576).toFixed(1)} MiB · 第 2 轮 (second): ${pass2TimeMs.toFixed(1)} ms / ${(pass2MemoryBytes / 1048576).toFixed(1)} MiB`;
  const combinedDiagnostic = pass2.verdict === 'AC'
    ? [summary, pass2.diagnostic].filter(Boolean).join('\n')
    : [`[第 2 轮 second] 选手第 2 轮判定 ${pass2.verdict}`, summary, pass2.diagnostic].filter(Boolean).join('\n');

  const previous = await db.invocation.findUniqueOrThrow({ where: { id: pass2.id } });
  const detail = {
    ...(previous.detail as object),
    stage: 'PASS2',
    pass1InvocationId: pass1.playerResult.id,
    interactorInvocationId: pass1.toolResult.id,
    pass1TimeMs,
    pass1MemoryBytes,
    pass2TimeMs,
    pass2MemoryBytes,
    forwardedInput: pass1.forwardedInputRef,
    transcript: pass1.transcript,
  };
  await db.invocation.update({
    where: { id: pass2.id },
    data: { diagnostic: combinedDiagnostic, detail: detail as unknown as Prisma.InputJsonValue },
  });

  return {
    ...pass2,
    diagnostic: combinedDiagnostic,
    result: {
      ...pass2.result,
      // Both passes have independent limits; report peak usage in the matrix cell.
      time: Math.max(pass1.playerResult.result.time, pass2.result.time),
      memory: Math.max(pass1MemoryBytes, pass2MemoryBytes),
    },
  };
}
