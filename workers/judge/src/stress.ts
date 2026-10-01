import { db, Prisma } from '@problemforge/database';
import { compareOutput, type JudgeSnapshot } from '@problemforge/judge-core';
import { defaultJudgeSettings } from '@problemforge/contracts';
import { Executor, JudgeFailure, type Compiled } from './executor.ts';
import type { Report } from './pipeline.ts';

export async function stressPipeline(runId: string, input: JudgeSnapshot, executor: Executor, compiled: Map<string, Compiled>, report: Report) {
  const config = input.stress!.data, settings = { ...defaultJudgeSettings, ...input.settings };
  const generator = compiled.get(config.generatorId)!, reference = compiled.get(config.referenceId)!, candidate = compiled.get(config.candidateId)!;
  const checker = config.checkerId ? compiled.get(config.checkerId)! : undefined;
  if (!reference || !candidate) throw new JudgeFailure('STRESS_COMPILE_FAILED', '参考解或被测解编译失败，不能作为反例');
  const stress = report.stress = { outcome: 'RUNNING', completedIterations: 0, counterexamples: 0, lastSeed: null as string | null, iterations: [] as { seed: string; verdict: string; inputHash: string; caseId: string | null; reproduced?: boolean }[] };
  const persist = async () => executor.progress({ data: { report: report as unknown as Prisma.InputJsonValue, stage: `对拍已完成 ${stress.completedIterations} 次 · seed=${stress.lastSeed ?? '—'}` } });
  const judge = async (bytes: Buffer, answer: Buffer, output: Buffer, caseRef: string) => {
    if (!checker) return compareOutput(answer, output, settings);
    const result = await executor.check(checker, bytes, answer, output, { caseRef });
    if (result.verdict === 'TOOL_ERROR') throw new JudgeFailure('CHECKER_TOOL_ERROR', result.diagnostic);
    return result;
  };
  for (let i = 0; i < (input.replay ? 1 : config.iterations); i++) {
    executor.checkCanceled();
    const seed = input.replay?.seed ?? (BigInt(config.seed) + BigInt(i)).toString(), ref = `stress:${i}:${seed}`;
    stress.lastSeed = seed;
    let bytes: Buffer;
    if (input.replay) {
      bytes = await executor.blob(input.replay.input);
      if (input.replay.regenerate) {
        const generated = await executor.generate(generator, config.argv, seed, ref, true);
        if (generated.verdict !== 'AC' || generated.outputRef?.hash !== input.replay.input.hash) report.warnings.push(`确定性检查：重新生成 ${generated.verdict}，与保存输入${generated.outputRef?.hash === input.replay.input.hash ? '相同' : '不同'}；仍使用保存的输入复现`);
      }
    } else {
      const generated = await executor.generate(generator, config.argv, seed, ref);
      if (generated.verdict !== 'AC' || !generated.output) throw new JudgeFailure('GENERATOR_FAILED', `seed=${seed}: ${generated.verdict}\n${generated.diagnostic}`);
      bytes = generated.output;
    }
    for (const p of input.programs.filter(p => p.enabled && ['VALIDATOR', 'EXTRA_VALIDATOR'].includes(p.role))) {
      const validated = await executor.validate(compiled.get(p.id)!, bytes, { caseRef: ref });
      if (validated.verdict !== 'ACCEPT') throw new JudgeFailure(validated.verdict === 'REJECT' ? 'INVALID_INPUT' : 'VALIDATOR_TOOL_ERROR', `${p.name}: ${validated.verdict}\n${validated.diagnostic}`);
    }
    const jury = await executor.solution(reference, bytes, settings, ref, true);
    if (jury.verdict !== 'AC' || !jury.output || !jury.outputRef) throw new JudgeFailure('REFERENCE_FAILED', `${reference.program.name}: ${jury.verdict}\n${jury.diagnostic}`);
    const savedAnswer = input.replay ? await executor.blob(input.replay.answer) : jury.output;
    const juryCheck = await judge(bytes, savedAnswer, jury.output, ref);
    if (juryCheck.verdict !== 'AC') throw new JudgeFailure('REFERENCE_REJECTED', `参考解未通过 Checker / 保存答案：${juryCheck.verdict}`);
    const tested = await executor.solution(candidate, bytes, settings, ref);
    const judged = tested.verdict === 'AC' ? await judge(bytes, savedAnswer, tested.output!, ref) : tested;
    await db.invocation.update({ where: { id: tested.id }, data: { verdict: judged.verdict, diagnostic: judged.diagnostic, detail: { judgedOutput: tested.outputRef, checkerMode: settings.checkerMode, checkerInvocationId: 'id' in judged ? judged.id : null } } });
    const blob = await executor.save(bytes, 'stress-input');
    let caseId: string | null = null;
    if (judged.verdict !== 'AC') {
      if (!['WA', 'PE', 'TLE', 'MLE', 'OLE', 'RE'].includes(judged.verdict)) throw new JudgeFailure('STRESS_TOOL_ERROR', judged.diagnostic);
      const c = await db.runCase.create({ data: {
        runId, ref, number: i + 1, groupName: 'stress', validation: 'ACCEPT', inputKey: blob.key, inputHash: blob.hash, inputBytes: blob.bytes,
        answerKey: jury.outputRef.key, answerHash: jury.outputRef.hash, answerBytes: jury.outputRef.bytes,
        origin: { type: 'COUNTEREXAMPLE', seed, argv: config.argv, verdict: judged.verdict, diagnostic: judged.diagnostic,
          referenceInvocationId: jury.id, candidateInvocationId: tested.id, sourceRunId: input.replay?.sourceRunId ?? null, sourceCaseId: input.replay?.sourceCaseId ?? null },
      } });
      caseId = c.id; stress.counterexamples++;
    }
    stress.completedIterations++;
    stress.iterations.push({ seed, verdict: judged.verdict, inputHash: blob.hash, caseId, ...(input.replay ? { reproduced: judged.verdict === input.replay.verdict } : {}) });
    await persist();
    if (caseId && config.stop === 'FIRST_COUNTEREXAMPLE') break;
  }
  stress.outcome = input.replay ? (stress.iterations[0]?.reproduced ? 'REPRODUCED' : 'NOT_REPRODUCED') : stress.counterexamples ? 'COUNTEREXAMPLE_FOUND' : 'ITERATION_LIMIT';
  await persist(); return { accepted: null };
}
