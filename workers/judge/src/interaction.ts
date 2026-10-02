import { readFile } from 'node:fs/promises';
import { db } from '@problemforge/database';
import { sha256 } from '@problemforge/domain';
import { defaultInteractionSettings, type JudgeSettingsValue } from '@problemforge/contracts';
import { InfrastructureError, type SandboxPipe, type InteractionStop } from '@problemforge/judge-adapter';
import { interactionVerdict, checkerVerdict, INTERACTION_POLICY } from '@problemforge/judge-core';
import { Executor, type Compiled, JudgeFailure } from './executor.ts';
const relay = await readFile(new URL('./interaction-relay.py', import.meta.url));
const runner = await readFile(new URL('./interactor-runner.py', import.meta.url));
if (`interaction-v1-${sha256(Buffer.concat([relay, runner]))}` !== INTERACTION_POLICY) throw new Error('交互中继策略哈希不匹配');
export async function runInteraction(executor: Executor, contestant: Compiled, interactor: Compiled, input: Buffer, answer: Buffer | null, settings: JudgeSettingsValue, caseRef: string, main: boolean) {
  executor.checkCanceled();
  const limits = { ...defaultInteractionSettings, ...settings.interaction };
  const player = executor.programCommand(contestant, [], settings.timeLimitMs, settings.memoryLimitMb, settings.outputLimitBytes, limits.wallTimeMs);
  const tool = executor.command(['/usr/bin/python3', '-I', '-B', '/w/interactor-runner.py', ...executor.runArgs(interactor, ['hidden-input', 'interaction-output', 'jury-answer'])], {
    'interactor-runner.py': { fileId: await executor.upload(runner) },
    [interactor.fileName]: { fileId: interactor.executable }, 'hidden-input': { fileId: await executor.upload(input) }, 'jury-answer': { fileId: await executor.upload(answer ?? Buffer.alloc(0)) },
  }, limits.interactorTimeMs, limits.interactorMemoryMb, settings.outputLimitBytes, limits.wallTimeMs);
  // No hidden input, answer or interactor files enter the contestant environment.
  for (const command of [player, tool]) { command.files[0] = null; command.files[1] = null; }
  tool.copyOutCached!.push('interaction-output?');
  const broker = executor.command(['/usr/bin/python3', '-I', '-B', '/w/relay.py', String(limits.idleTimeMs), String(settings.outputLimitBytes), String(limits.transcriptBytes)], { 'relay.py': { fileId: await executor.upload(relay) } }, 2000, 64, 65536, limits.wallTimeMs);
  broker.files[1] = { streamOut: true }; broker.copyOutCached = ['stderr', 'transcript.jsonl?']; broker.copyOutMax = 1_048_576;
  const pipeMapping: SandboxPipe[] = [
    { in: { index: 0, fd: 1 }, out: { index: 2, fd: 3 }, proxy: true, name: 'stdout', max: settings.outputLimitBytes + 1 },
    { in: { index: 2, fd: 4 }, out: { index: 1, fd: 0 } },
    { in: { index: 1, fd: 1 }, out: { index: 2, fd: 5 }, proxy: true, name: 'stdout', max: settings.outputLimitBytes + 1 },
    { in: { index: 2, fd: 6 }, out: { index: 0, fd: 0 } },
    { in: { index: 1, fd: 3 }, out: { index: 2, fd: 7 } },
  ];
  const execution = await executor.sandbox.executeInteractive([player, tool, broker], pipeMapping, limits.wallTimeMs, executor.signal);
  const results = execution.results;
  for (const result of results) executor.trackFiles(result);
  const transcriptId = results[2].fileIds?.['transcript.jsonl'];
  const transcriptBytes = transcriptId ? await executor.sandbox.download(transcriptId) : Buffer.alloc(0);
  const transcript = await executor.save(transcriptBytes, 'interaction-transcript');
  // The persistent control event also covers a final stream frame racing the
  // upstream aggregate response. Only complete, trusted JSONL records are used.
  const events = transcriptBytes.toString('utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line) as InteractionStop]; } catch { return []; } });
  const stop = execution.stop ?? events.find(e=>['IDLE','OUTPUT_LIMIT','INTERACTOR_EXIT'].includes(e.kind));
  // Persist BOTH invocations before surfacing cancellation or infrastructure failure.
  const playerResult = await executor.captureResult(contestant.program, results[0], main ? 'MAIN_SOLUTION' : 'SOLUTION', { caseRef }, 'stdout', true);
  const toolResult = await executor.captureResult(interactor.program, results[1], 'INTERACTOR', { caseRef }, 'interaction-output', true);
  const verdict = interactionVerdict(results[0], results[1], results[2], stop);
  const diagnostic = `${verdict.diagnostic}\n选手: ${results[0].status} / exit=${results[0].exitStatus}\nInteractor: ${results[1].status} / exit=${results[1].exitStatus}\n${toolResult.diagnostic}`;
  const detail = { output: toolResult.outputRef, contestantOutput: playerResult.outputRef, interactorInvocationId: toolResult.id, transcript, stop: stop ?? null, relayStatus: results[2].status };
  await db.invocation.update({ where: { id: playerResult.id }, data: { verdict: executor.signal.aborted ? 'CANCELED' : verdict.verdict, diagnostic, detail } });
  const authorExit = events.find(e=>e.kind === 'INTERACTOR_EXIT')?.exitCode;
  const authorVerdict = authorExit === undefined ? toolResult.verdict : checkerVerdict({ ...results[1], exitStatus: Math.abs(authorExit), status: authorExit === 0 ? 'Accepted' : authorExit < 0 ? 'Signalled' : 'Nonzero Exit Status' });
  await db.invocation.update({ where: { id: toolResult.id }, data: { verdict: executor.signal.aborted ? 'CANCELED' : authorVerdict, diagnostic: `${toolResult.diagnostic}${authorExit === undefined ? '' : `\nInteractor 子进程实际退出码：${authorExit}`}`, detail: { output: toolResult.outputRef, transcript, contestantInvocationId: playerResult.id, stop: stop ?? null, authorExit: authorExit ?? null } } });
  executor.checkCanceled();
  if (verdict.verdict === 'INFRA_ERROR') throw new InfrastructureError(diagnostic);
  if (verdict.verdict === 'TOOL_ERROR') throw new JudgeFailure('INTERACTOR_TOOL_ERROR', diagnostic);
  return { ...playerResult, verdict: verdict.verdict, diagnostic, output: toolResult.output ?? Buffer.alloc(0), outputRef: toolResult.outputRef ?? await executor.save(Buffer.alloc(0), 'interaction-output') };
}
