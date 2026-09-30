import { db, Prisma } from '@problemforge/database';
import { defaultJudgeSettings, type JudgePurpose, type JudgeSettingsValue, type GeneratorPlanSave } from '@problemforge/contracts';
import { hashObject, HttpError } from '@problemforge/domain';
import { GO_JUDGE_VERSION } from '@problemforge/judge-adapter';
import { JUDGE_POLICY, JUDGE_TOOLCHAIN, solutionRoles, type JudgeSnapshot, type ProgramSnapshot, type CaseSnapshot, type SelfTestSnapshot, type ProfileSnapshot } from '@problemforge/judge-core';

export async function judgeSnapshot(tx: Prisma.TransactionClient, problemId: string, purpose: JudgePurpose, programId?: string, budgetMs = 300000): Promise<JudgeSnapshot> {
  const problem = await tx.problem.findUniqueOrThrow({ where: { id: problemId } });
  const settings = (problem.judgeSettings ?? defaultJudgeSettings) as JudgeSettingsValue;
  const allPrograms = await tx.program.findMany({ where: { problemId }, include: { currentRevision: true, profile: true }, orderBy: { id: 'asc' } });
  const plans = ['GENERATE', 'VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(purpose)
    ? await tx.generatorPlan.findMany({ where: { problemId, enabled: true }, orderBy: { id: 'asc' } }) : [];
  const selfTests = ['SELF_TEST', 'ACCEPTANCE'].includes(purpose)
    ? await tx.toolSelfTest.findMany({ where: { problemId, enabled: true }, orderBy: { id: 'asc' } }) : [];
  const tests = ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(purpose)
    ? await tx.testCase.findMany({ where: { problemId, enabled: true }, include: { currentRevision: true }, orderBy: [{ number: 'asc' }, { id: 'asc' }] }) : [];
  const include = (p: typeof allPrograms[number]) => {
    if (purpose === 'COMPILE') return p.id === programId;
    if (selfTests.some(s => s.programId === p.id)) return true;
    if (p.role === 'GENERATOR') return plans.some(plan => plan.programId === p.id);
    if (!p.enabled) return false;
    if (['VALIDATOR', 'EXTRA_VALIDATOR'].includes(p.role)) return ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(purpose);
    if (p.role === 'CHECKER') return ['SELF_TEST', 'ANSWERS', 'ACCEPTANCE'].includes(purpose) && settings.checkerMode === 'CUSTOM';
    if (p.role === 'MAIN_SOLUTION') return ['ANSWERS', 'ACCEPTANCE'].includes(purpose);
    return purpose === 'ACCEPTANCE' && solutionRoles.has(p.role);
  };
  const programSnapshots = allPrograms.filter(include).filter(p => p.currentRevision).map(p => ({
    id: p.id, revisionId: p.currentRevisionId!, version: p.version, name: p.name, role: p.role, enabled: p.enabled,
    source: p.currentRevision!.source, sourceHash: p.currentRevision!.hash, expectedVerdicts: p.expectedVerdicts,
    profile: { id: p.profile.id, name: p.profile.name, version: p.profile.version, language: p.profile.language, config: p.profile.config, hash: p.profile.hash, enabled: p.profile.enabled },
  })) as ProgramSnapshot[];
  const caseSnapshots = tests.filter(t => t.currentRevision).map(t => ({
    ref: `test:${t.id}:${t.currentRevisionId}`, id: t.id, revisionId: t.currentRevisionId!, version: t.version, number: t.number, groupName: t.groupName, isSample: t.isSample,
    input: { key: t.currentRevision!.inputKey, hash: t.currentRevision!.inputHash, bytes: t.currentRevision!.inputBytes },
    answer: t.currentRevision!.answerKey ? { key: t.currentRevision!.answerKey, hash: t.currentRevision!.answerHash!, bytes: t.currentRevision!.answerBytes! } : null,
    provenance: t.currentRevision!.provenance,
  })) as CaseSnapshot[];
  const scopedSettings: Partial<JudgeSettingsValue> = {};
  if (['ANSWERS', 'ACCEPTANCE'].includes(purpose)) Object.assign(scopedSettings, settings);
  else if (purpose === 'SELF_TEST') Object.assign(scopedSettings, { checkerMode: settings.checkerMode, absoluteTolerance: settings.absoluteTolerance, relativeTolerance: settings.relativeTolerance });
  return {
    problemId, purpose, ...(programId ? { programId } : {}), budgetMs, policy: JUDGE_POLICY, toolchain: JUDGE_TOOLCHAIN, sandboxVersion: GO_JUDGE_VERSION,
    programs: programSnapshots, tests: caseSnapshots, settings: scopedSettings,
    plans: plans.map(p => ({ ...p.data as GeneratorPlanSave, id: p.id, version: p.version, hash: p.hash })),
    selfTests: selfTests.map(t => ({ ...t.data as object, id: t.id, version: t.version, hash: t.hash })) as SelfTestSnapshot[],
  };
}
export function dependencyHash(snapshot: JudgeSnapshot) {
  // Budget controls execution, not whether the completed content report is current.
  const { budgetMs: _budget, ...dependencies } = snapshot;
  return hashObject(dependencies);
}
export function validateJudgeSnapshot(input: JudgeSnapshot) {
  if (input.purpose === 'COMPILE' && (!input.programId || input.programs.length !== 1)) throw new HttpError(422, '编译任务需要选择本题程序');
  if (input.programs.some(p => !p.profile.enabled)) throw new HttpError(422, '所选程序的编译 profile 已停用，请选择管理员提供的启用版本');
  if (['ANSWERS', 'ACCEPTANCE'].includes(input.purpose)) {
    if (input.settings.interactionMode !== 'BATCH' || input.settings.scoringMode !== 'ACM') throw new HttpError(422, '当前验收支持普通题 / SPJ；交互执行与部分分按 P3 接入');
    if (input.programs.filter(p => p.role === 'MAIN_SOLUTION' && p.enabled).length !== 1) throw new HttpError(422, '必须恰好启用一个主标程');
  }
  if (['VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(input.purpose)) {
    if (!input.tests.length && !input.plans.length) throw new HttpError(422, '至少需要一组启用的数据或生成计划');
    if (input.programs.filter(p => p.role === 'VALIDATOR' && p.enabled).length !== 1) throw new HttpError(422, '必须恰好启用一个主 Validator');
    if (input.tests.length + input.plans.reduce((n, p) => n + p.count, 0) > 200) throw new HttpError(422, '一次任务最多 200 组数据');
  }
  if (input.purpose === 'GENERATE' && !input.plans.length) throw new HttpError(422, '没有启用的生成计划');
  for (const plan of input.plans) {
    const generator = input.programs.find(p => p.id === plan.programId);
    if (!generator || !generator.enabled || generator.role !== 'GENERATOR') throw new HttpError(422, `生成计划 ${plan.name} 的生成器不可用`);
  }
  if (['ANSWERS', 'SELF_TEST', 'ACCEPTANCE'].includes(input.purpose) && input.settings.checkerMode === 'CUSTOM' && input.programs.filter(p => p.role === 'CHECKER' && p.enabled).length > 1) throw new HttpError(422, '只能启用一个判题 Checker');
  if (['ANSWERS', 'ACCEPTANCE'].includes(input.purpose) && input.settings.checkerMode === 'CUSTOM' && !input.programs.some(p => p.role === 'CHECKER' && p.enabled)) throw new HttpError(422, '自定义比较需要启用 testlib Checker');
  if (input.purpose === 'SELF_TEST' && !input.selfTests.length) throw new HttpError(422, '没有启用的工具自测');
  for (const t of input.selfTests) {
    if (t.programId) {
      const p = input.programs.find(p => p.id === t.programId);
      if (!p || !(t.kind === 'VALIDATOR' ? ['VALIDATOR', 'EXTRA_VALIDATOR'] : ['CHECKER']).includes(p.role)) throw new HttpError(422, `自测 ${t.name} 的工具角色已改变`);
    } else if (t.kind !== 'CHECKER' || input.settings.checkerMode === 'CUSTOM') throw new HttpError(422, '自定义工具自测必须指定本题程序');
  }
}
export const builtinProfiles: Omit<ProfileSnapshot, 'version'>[] = (['CPP17', 'CPP20', 'PYTHON3'] as const).map(language => {
  const config = { optimization: 'O2' as const, warnings: true, compileTimeMs: 10000, compileMemoryMb: 512 };
  return { id: `builtin-${language.toLowerCase()}`, name: language === 'PYTHON3' ? 'Python 3.11' : `GNU C++${language === 'CPP17' ? '17' : '20'}`, language, config, hash: hashObject({ language, config }), enabled: true };
});
