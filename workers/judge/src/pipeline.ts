import { db, Prisma } from '@problemforge/database';
import { hashObject, sha256 } from '@problemforge/domain';
import { GO_JUDGE_VERSION } from '@problemforge/judge-adapter';
import { JUDGE_POLICY, GENERATOR_DEDUP_POLICY, JUDGE_TOOLCHAIN, INTERACTION_POLICY, scoreGroups, scoreExpectation, type ScoreReport, checkExpectation, compareOutput, solutionRoles, type JudgeSnapshot, type ProgramSnapshot, type BlobRef } from '@problemforge/judge-core';
import { defaultJudgeSettings, generatorPlanCommands, type JudgeSettingsValue } from '@problemforge/contracts';
import { Executor, JudgeFailure, type Captured, type Compiled } from './executor.ts';
import { stressPipeline } from './stress.ts';

type MatrixCell = { programId: string; programName: string; programRevisionId: string; caseRef: string; number: number; groupName: string; verdict: string; timeMs: number; memoryBytes: number; invocationId: string; diagnostic: string };
export type Report = {
  scores: ScoreReport[];
  stress?: { outcome: string; completedIterations: number; counterexamples: number; lastSeed: string | null; iterations: { seed: string; verdict: string; inputHash: string; caseId: string | null; reproduced?: boolean }[] };
  warnings: string[];
  skippedGeneratedInputs?: { ref: string; number: number; retainedRef: string; retainedNumber: number }[];
  compilations: { programId: string; name: string; version: number; verdict: string; invocationId: string; diagnostic: string }[];
  selfTests: { id: string; name: string; expected: string; actual: string; passed: boolean; invocationId?: string; diagnostic: string }[];
  matrix: MatrixCell[];
  expectations: { programId: string; name: string; expected: string[]; passed: boolean; diagnostic: string }[];
};
export async function pipeline(runId: string, input: JudgeSnapshot, executor: Executor, report: Report) {
  const settings = { ...defaultJudgeSettings, ...input.settings } as JudgeSettingsValue;
  const policy = input.plans.length || input.stress ? GENERATOR_DEDUP_POLICY : JUDGE_POLICY;
  if (input.policy !== policy || input.toolchain !== JUDGE_TOOLCHAIN || input.sandboxVersion !== GO_JUDGE_VERSION) throw new JudgeFailure('TOOLCHAIN_MISMATCH', '任务策略/工具链已改变，请创建新任务');
  if (settings.interactionMode === 'INTERACTIVE' && input.interactionPolicy !== INTERACTION_POLICY) throw new JudgeFailure('INTERACTION_POLICY_MISMATCH', '交互策略已改变，请创建新任务');
  for (const p of input.programs) if (sha256(p.source) !== p.sourceHash || hashObject({ language: p.profile.language, config: p.profile.config }) !== p.profile.hash) throw new JudgeFailure('SOURCE_HASH_MISMATCH', '源码或编译 profile 快照哈希不匹配');
  const compiled = new Map<string, Compiled>(), failedCompile = new Map<string, Captured>();
  const casesCount = input.tests.length + input.plans.reduce((n, p) => n + p.count, 0);
  const validators = input.programs.filter(p => p.enabled && ['VALIDATOR', 'EXTRA_VALIDATOR'].includes(p.role));
  const main = input.programs.find(p => p.role === 'MAIN_SOLUTION' && p.enabled);
  const checkerProgram = input.programs.find(p => p.role === 'CHECKER' && p.enabled);
  const interactor = input.programs.find(p => p.role === 'INTERACTOR' && p.enabled);
  const directInteraction = settings.interactionMode === 'INTERACTIVE' && (settings.interaction?.verdictMode ?? 'DIRECT') === 'DIRECT';
  const solutions = input.programs.filter(p => p.enabled && solutionRoles.has(p.role));
  let caseSteps = ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(input.purpose) ? validators.length : 0;
  if (['ANSWERS', 'ACCEPTANCE'].includes(input.purpose)) caseSteps += 1 + (settings.checkerMode === 'CUSTOM' ? 1 : 0);
  if (input.purpose === 'ACCEPTANCE') caseSteps += (solutions.length - 1) * (1 + (settings.checkerMode === 'CUSTOM' ? 1 : 0));
  let total = input.programs.length + (input.purpose === 'GENERATE' ? 0 : input.tests.length) + input.plans.reduce((n, p) => n + p.count + 1, 0) + casesCount * caseSteps;
  total += input.selfTests.length;
  if (input.stress) total = input.programs.length + (input.replay ? 1 : input.stress.data.iterations) * (validators.length + 3 + (settings.checkerMode === 'CUSTOM' ? 2 : 0)) + (input.replay?.regenerate ? 1 : 0);
  await executor.progress({ data: { total, stage: '编译固定源码快照' } });
  const persist = async (stage?: string) => {
    executor.checkCanceled();
    await executor.progress({ data: { report: report as unknown as Prisma.InputJsonValue, ...(stage ? { stage } : {}), log: [
      ...report.compilations.map(c => `${c.name} v${c.version}: ${c.verdict}${c.diagnostic ? `\n${c.diagnostic}` : ''}`),
      ...report.warnings.map(w => `提醒：${w}`),
      ...(report.skippedGeneratedInputs?.length ? [`已跳过 ${report.skippedGeneratedInputs.length} 份重复生成输入，沿用相同输入的已有数据。`] : []),
      ...report.selfTests.map(t => `自测 ${t.name}: ${t.actual} / 预期 ${t.expected}`),
      ...report.expectations.map(e => `${e.name}: ${e.passed ? '符合预期' : '未符合预期'} · ${e.diagnostic}`),
    ].join('\n').slice(0, 200000) } });
  };
  for (const p of input.programs) {
    const result = await executor.compile(p);
    report.compilations.push({ programId: p.id, name: p.name, version: p.version, verdict: result.execution.verdict, invocationId: result.execution.id, diagnostic: result.execution.diagnostic });
    if (result.compiled) compiled.set(p.id, result.compiled);
    else {
      failedCompile.set(p.id, result.execution);
      await persist();
      if (input.purpose === 'COMPILE' || p.role === 'MAIN_SOLUTION' || !solutionRoles.has(p.role)) throw new JudgeFailure(p.role === 'MAIN_SOLUTION' ? 'MAIN_COMPILE_FAILED' : input.purpose === 'COMPILE' ? 'COMPILE_FAILED' : 'TOOL_COMPILE_FAILED', `${p.name} 编译失败\n${result.execution.diagnostic}`);
    }
  }
  await persist();
  if (input.purpose === 'COMPILE') return { accepted: null };
  if (input.stress) return stressPipeline(runId, input, executor, compiled, report);
  const caseData: { ref: string; id: string; number: number; groupName: string; input: Buffer; suppliedAnswer: Buffer | null; answer?: Buffer; mainRun?: Captured }[] = [];
  const hashes = new Map<string, { number: number; ref: string }>(), numbers = new Set<number>();
  const duplicates = (hash: string, number: number, ref: string) => {
    const prior = hashes.get(hash);
    if (prior) report.warnings.push(`重复输入：#${number} 与 #${prior.number} (${prior.ref}) 的 SHA-256 相同；均保留`);
    else hashes.set(hash, { number, ref });
    if (numbers.has(number)) report.warnings.push(`数据编号 #${number} 重复，矩阵用不可变来源引用区分；收集前需调整编号`);
    numbers.add(number);
  };
  for (const t of input.tests) {
    // Standalone generation uses saved inputs only as a deduplication index;
    // it must not offer those existing records for input-only collection again.
    if (input.purpose === 'GENERATE') {
      if (!hashes.has(t.input.hash)) hashes.set(t.input.hash, { number: t.number, ref: t.ref });
      numbers.add(t.number); continue;
    }
    const groupName = input.groups?.data.groups.find(g=>g.members.some(m=>m.revisionId===t.revisionId))?.id ?? t.groupName;
    const bytes = await executor.blob(t.input), suppliedAnswer = t.answer ? await executor.blob(t.answer) : null;
    const c = await db.runCase.create({ data: { runId, ref: t.ref, number: t.number, groupName, isSample: t.isSample,
      inputKey: t.input.key, inputHash: t.input.hash, inputBytes: t.input.bytes,
      origin: { type: 'TEST', testId: t.id, testRevisionId: t.revisionId, testVersion: t.version, inputProvenance: t.provenance } as Prisma.InputJsonValue } });
    caseData.push({ ref: t.ref, id: c.id, number: t.number, groupName, input: bytes, suppliedAnswer });
    duplicates(t.input.hash, t.number, t.ref);
    await executor.progress({ data: { completed: { increment: 1 }, stage: `收集输入 #${t.number}` } });
  }
  for (const plan of input.plans) {
    for (const [i, command] of generatorPlanCommands(plan).entries()) {
      const generator = compiled.get(command.programId ?? plan.programId);
      if (!generator) throw new JudgeFailure('GENERATOR_UNAVAILABLE', `生成器 ${plan.name} 不可用`);
      const { argv, seed } = command, ref = `plan:${plan.id}:v${plan.version}:${i}`, number = plan.numberStart + i;
      const execution = await executor.generate(generator, argv, seed, ref);
      if (execution.verdict !== 'AC' || !execution.outputRef) throw new JudgeFailure('GENERATOR_FAILED', `${plan.name} seed=${seed}: ${execution.verdict}\n${execution.diagnostic}`);
      const blob = execution.outputRef;
      if (i === 0) {
        const repeated = await executor.generate(generator, argv, seed, ref, true);
        if (repeated.verdict !== 'AC') throw new JudgeFailure('GENERATOR_FAILED', `${plan.name} 重复生成失败：${repeated.verdict}`);
        if (repeated.outputRef?.hash !== blob.hash) report.warnings.push(`生成器 ${plan.name} 在相同 argv / seed=${seed} 下产生不同输入；本任务保留第一次输入，不承诺确定性`);
      }
      // Prefer the saved test (including its answer and grouping), then the
      // first generated copy. Number collisions alone never discard new input.
      const prior = hashes.get(blob.hash);
      if (prior) {
        (report.skippedGeneratedInputs ??= []).push({ ref, number, retainedRef: prior.ref, retainedNumber: prior.number });
        total -= caseSteps;
        await executor.progress({ data: { total } });
      } else {
        const c = await db.runCase.create({ data: { runId, ref, number, groupName: plan.groupName, isSample: plan.isSample, inputKey: blob.key, inputHash: blob.hash, inputBytes: blob.bytes,
          origin: { type: 'GENERATOR', planId: plan.id, planVersion: plan.version, generatorRevisionId: generator.program.revisionId, profileHash: generator.program.profile.hash, argv, seed, invocationId: execution.id } } });
        caseData.push({ ref, id: c.id, number, groupName: plan.groupName, input: execution.output!, suppliedAnswer: null }); duplicates(blob.hash, number, ref);
      }
      await persist(`生成输入 #${number} · seed=${seed}`);
    }
  }
  if (input.purpose === 'GENERATE') return { accepted: null };
  if (['VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(input.purpose)) for (const c of caseData) {
    for (const p of validators) {
      if (p.validatorScope === 'GROUPS' && !input.groups?.data.groups.find(g=>g.id===c.groupName)?.extraValidatorIds.includes(p.id)) continue;
      const checked = await executor.validate(compiled.get(p.id)!, c.input, { caseRef: c.ref });
      if (checked.verdict !== 'ACCEPT') {
        await db.runCase.update({ where: { id: c.id }, data: { validation: checked.verdict } });
        throw new JudgeFailure(checked.verdict === 'REJECT' ? 'INVALID_INPUT' : 'VALIDATOR_TOOL_ERROR', `${p.name} 对 #${c.number}: ${checked.verdict}\n${checked.diagnostic}`);
      }
    }
    await db.runCase.update({ where: { id: c.id }, data: { validation: 'ACCEPT' } });
  }
  await persist('输入校验完成');
  if (input.purpose === 'VALIDATE') return { accepted: null };
  const check = async (bytes: Buffer, answer: Buffer, output: Buffer, context: { caseRef?: string; selfTestId?: string }, tool?: Compiled) => {
    if (tool) {
      const checked = await executor.check(tool, bytes, answer, output, context);
      if (checked.verdict === 'TOOL_ERROR') throw new JudgeFailure('CHECKER_TOOL_ERROR', `Checker ${tool.program.name} 失败；不能作为击败证据\n${checked.diagnostic}`);
      return { verdict: checked.verdict, diagnostic: checked.diagnostic, checkerInvocationId: checked.id };
    }
    if (settings.checkerMode === 'CUSTOM') throw new JudgeFailure('CHECKER_UNAVAILABLE', '自定义 Checker 未编译成功');
    return { ...compareOutput(answer, output, settings), checkerInvocationId: null };
  };
  const checker = settings.checkerMode === 'CUSTOM' && checkerProgram ? compiled.get(checkerProgram.id) : undefined;
  if (['ANSWERS', 'ACCEPTANCE'].includes(input.purpose)) for (const c of caseData) {
    const execution = settings.interactionMode === 'INTERACTIVE'
      ? await executor.interactive(compiled.get(main!.id)!, compiled.get(interactor!.id)!, c.input, c.suppliedAnswer, settings, c.ref, true)
      : await executor.solution(compiled.get(main!.id)!, c.input, settings, c.ref, true);
    if (execution.verdict !== 'AC' || !execution.outputRef) throw new JudgeFailure('MAIN_EXECUTION_FAILED', `主标程对 #${c.number}: ${execution.verdict}\n${execution.diagnostic}`);
    c.mainRun = execution; c.answer = execution.output!;
    const judged = directInteraction ? { verdict: 'AC', diagnostic: execution.diagnostic } : await check(c.input, c.suppliedAnswer ?? c.answer, c.answer, { caseRef: c.ref }, checker);
    if (judged.verdict !== 'AC') throw new JudgeFailure('ANSWER_MISMATCH', `主标程输出未通过 Checker / 上传答案：#${c.number} ${judged.verdict}\n${judged.diagnostic}`);
    await db.runCase.update({ where: { id: c.id }, data: { answerKey: execution.outputRef.key, answerHash: execution.outputRef.hash, answerBytes: execution.outputRef.bytes } });
    await persist(`生成答案 #${c.number}`);
  }
  for (const t of input.selfTests) {
    const bytes = await executor.blob(t.input), answer = await executor.blob(t.answer), output = await executor.blob(t.output);
    let actual: string, diagnostic: string, invocationId: string | undefined;
    if (t.kind === 'VALIDATOR') {
      const checked = await executor.validate(compiled.get(t.programId!)!, bytes, { selfTestId: t.id });
      actual = checked.verdict; diagnostic = checked.diagnostic; invocationId = checked.id;
    } else if (t.programId) {
      const checked = await executor.check(compiled.get(t.programId)!, bytes, answer, output, { selfTestId: t.id }, 'SELF_TEST_CHECKER');
      actual = checked.verdict; diagnostic = checked.diagnostic; invocationId = checked.id;
    } else {
      const checked = compareOutput(answer, output, settings); actual = checked.verdict; diagnostic = checked.diagnostic;
      await executor.progress({ data: { completed: { increment: 1 }, stage: `内置比较器自测 · ${t.name}` } });
    }
    const passed = actual === t.expected;
    report.selfTests.push({ id: t.id, name: t.name, expected: t.expected, actual, passed, ...(invocationId ? { invocationId } : {}), diagnostic });
    await persist();
    if (['TOOL_ERROR', 'INFRA_ERROR'].includes(actual)) throw new JudgeFailure('SELF_TEST_TOOL_ERROR', `自测工具 ${t.name} 故障：${diagnostic}`);
    if (!passed) throw new JudgeFailure('SELF_TEST_FAILED', `${t.name}：预期 ${t.expected}，实际 ${actual}\n${diagnostic}`);
  }
  if (input.purpose === 'SELF_TEST') return { accepted: true };
  if (input.purpose === 'ANSWERS') return { accepted: null };
  const cell = (p: ProgramSnapshot, c: typeof caseData[number], execution: Captured, verdict: string, diagnostic: string): MatrixCell => ({
    programId: p.id, programName: p.name, programRevisionId: p.revisionId, caseRef: c.ref, number: c.number, groupName: c.groupName,
    verdict, invocationId: execution.id, timeMs: execution.result.time / 1e6, memoryBytes: execution.result.memory, diagnostic,
  });
  for (const p of solutions) {
    for (const c of caseData) {
      if (p.role === 'MAIN_SOLUTION') { report.matrix.push(cell(p, c, c.mainRun!, 'AC', '主标程输出已通过 Checker')); continue; }
      const ce = failedCompile.get(p.id);
      if (ce) { report.matrix.push({ ...cell(p, c, ce, 'CE', ce.diagnostic), timeMs: 0, memoryBytes: 0 }); continue; }
      const execution = settings.interactionMode === 'INTERACTIVE'
        ? await executor.interactive(compiled.get(p.id)!, compiled.get(interactor!.id)!, c.input, c.answer ?? null, settings, c.ref)
        : await executor.solution(compiled.get(p.id)!, c.input, settings, c.ref);
      let verdict = execution.verdict, diagnostic = execution.diagnostic;
      if (verdict === 'AC' && !directInteraction) {
        const checked = await check(c.input, c.answer!, execution.output!, { caseRef: c.ref }, checker);
        verdict = checked.verdict; diagnostic = checked.diagnostic;
        const previous = await db.invocation.findUniqueOrThrow({ where: { id: execution.id } });
        await db.invocation.update({ where: { id: execution.id }, data: { verdict, diagnostic, detail: { ...previous.detail as object, checkerMode: settings.checkerMode, checkerInvocationId: checked.checkerInvocationId, judgedOutput: execution.outputRef } } });
      }
      report.matrix.push(cell(p, c, execution, verdict, diagnostic)); await persist();
    }
    const cells = report.matrix.filter(c => c.programId === p.id), verdicts = cells.map(c=>c.verdict);
    const score = input.groups?.data.groups.length ? scoreGroups(p.id, input.groups.data.groups, cells.map(c=>({revisionId:input.tests.find(t=>t.ref===c.caseRef)!.revisionId,verdict:c.verdict}))) : undefined;
    if (score) report.scores.push(score);
    const expected = score && settings.scoringMode === 'PARTIAL' ? scoreExpectation(p, score, verdicts) : checkExpectation(p, verdicts);
    report.expectations.push({ programId: p.id, name: p.name, expected: p.expectedVerdicts, ...expected }); await persist();
  }
  return { accepted: report.expectations.length > 0 && report.expectations.every(e => e.passed) };
}
export const emptyReport = (): Report => ({ warnings: [], compilations: [], selfTests: [], matrix: [], expectations: [], scores: [] });
