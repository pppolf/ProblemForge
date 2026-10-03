import { db, Prisma } from '@problemforge/database';
import { defaultJudgeSettings, defaultInteractionSettings, isJudgingData, generatorPlanCommands, generatorPlanProgramIds, programLanguages, isCppLanguage, type JudgePurpose, type JudgeSettingsValue, type GeneratorPlanSave, type StressConfigValue, type TestGroupsValue } from '@problemforge/contracts';
import { hashObject, HttpError } from '@problemforge/domain';
import { GO_JUDGE_VERSION } from '@problemforge/judge-adapter';
import { JUDGE_POLICY, JUDGING_DATA_POLICY, GENERATOR_DEDUP_POLICY, JUDGE_TOOLCHAIN, INTERACTION_POLICY, groupOrder, GroupError, solutionRoles, testlibRoles, type JudgeSnapshot, type ProgramSnapshot, type CaseSnapshot, type SelfTestSnapshot, type ProfileSnapshot } from '@problemforge/judge-core';

export async function judgeSnapshot(tx: Prisma.TransactionClient, problemId: string, purpose: JudgePurpose, programId?: string, budgetMs = 300000): Promise<JudgeSnapshot> {
  const problem = await tx.problem.findUniqueOrThrow({ where: { id: problemId } });
  const settings = (problem.judgeSettings ?? defaultJudgeSettings) as JudgeSettingsValue;
  const directInteraction = settings.interactionMode === 'INTERACTIVE' && (settings.interaction?.verdictMode ?? defaultInteractionSettings.verdictMode) === 'DIRECT';
  const stress = ['STRESS', 'REPLAY'].includes(purpose) ? await tx.stressConfig.findUnique({ where: { problemId } }) : null;
  const stressData = stress?.data as StressConfigValue | undefined;
  const groupConfig = ['VALIDATE','ANSWERS','ACCEPTANCE','STRESS','REPLAY'].includes(purpose) ? await tx.testGroupConfig.findUnique({ where: { problemId } }) : null;
  const groupData = groupConfig?.data as TestGroupsValue | undefined;
  const stressGroups = stressData?.groupIds?.length ? (groupData?.groups ?? []).filter(g => stressData.groupIds!.includes(g.id)).map(g=>({id:g.id,extraValidatorIds:g.extraValidatorIds})) : undefined;
  const extraIds = new Set((stressData ? stressGroups ?? [] : groupData?.groups ?? []).flatMap(g=>g.extraValidatorIds));
  const allPrograms = await tx.program.findMany({ where: { problemId }, include: { currentRevision: true, profile: true }, orderBy: { id: 'asc' } });
  const plans = ['GENERATE', 'VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(purpose)
    ? (await tx.generatorPlan.findMany({ where: { problemId, enabled: true }, orderBy: { id: 'asc' } }))
      .filter(p => purpose === 'GENERATE' || isJudgingData(settings, p.data as GeneratorPlanSave)) : [];
  const selfTests = ['SELF_TEST', 'ACCEPTANCE'].includes(purpose)
    ? await tx.toolSelfTest.findMany({ where: { problemId, enabled: true }, orderBy: { id: 'asc' } }) : [];
  const tests = ['GENERATE', 'VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(purpose)
    ? await tx.testCase.findMany({ where: { problemId, enabled: true, deletedAt: null }, include: { currentRevision: true }, orderBy: [{ number: 'asc' }, { id: 'asc' }] }) : [];
  const include = (p: typeof allPrograms[number]) => {
    if (['STRESS', 'REPLAY'].includes(purpose)) return !!stressData && ([stressData.generatorId, stressData.referenceId, stressData.candidateId, stressData.checkerId].includes(p.id) || (p.enabled && (p.role === 'VALIDATOR' || p.role === 'EXTRA_VALIDATOR' && (p.validatorScope !== 'GROUPS' || extraIds.has(p.id)))));
    if (purpose === 'COMPILE') return p.id === programId;
    if (selfTests.some(s => s.programId === p.id)) return true;
    if (p.role === 'GENERATOR') return plans.some(plan => generatorPlanProgramIds(plan.data as GeneratorPlanSave).includes(p.id));
    if (!p.enabled) return false;
    if (['VALIDATOR', 'EXTRA_VALIDATOR'].includes(p.role)) return ['VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(purpose) && (p.validatorScope !== 'GROUPS' || extraIds.has(p.id));
    if (p.role === 'INTERACTOR') return settings.interactionMode === 'INTERACTIVE' && ['ANSWERS', 'ACCEPTANCE'].includes(purpose);
    if (p.role === 'CHECKER') return ['SELF_TEST', 'ANSWERS', 'ACCEPTANCE'].includes(purpose) && settings.checkerMode === 'CUSTOM' && !directInteraction;
    if (p.role === 'MAIN_SOLUTION') return ['ANSWERS', 'ACCEPTANCE'].includes(purpose);
    return purpose === 'ACCEPTANCE' && solutionRoles.has(p.role);
  };
  const programSnapshots = allPrograms.filter(include).filter(p => p.currentRevision).map(p => ({
    id: p.id, revisionId: p.currentRevisionId!, version: p.version, name: p.name, role: p.role, enabled: p.enabled,
    source: p.currentRevision!.source, sourceHash: p.currentRevision!.hash, expectedVerdicts: p.expectedVerdicts,
    ...(p.validatorScope === 'GROUPS' ? { validatorScope: 'GROUPS' as const } : {}), ...(p.expectedScore ? { expectedScore: p.expectedScore } : {}),
    profile: { id: p.profile.id, name: p.profile.name, version: p.profile.version, language: p.profile.language, config: p.profile.config, hash: p.profile.hash, enabled: p.profile.enabled },
  })) as ProgramSnapshot[];
  const caseSnapshots = tests.filter(t => t.currentRevision && isJudgingData(settings, t)).map(t => ({
    ref: `test:${t.id}:${t.currentRevisionId}`, id: t.id, revisionId: t.currentRevisionId!, version: t.version, number: t.number, groupName: t.groupName, isSample: t.isSample,
    input: { key: t.currentRevision!.inputKey, hash: t.currentRevision!.inputHash, bytes: t.currentRevision!.inputBytes },
    answer: t.currentRevision!.answerKey ? { key: t.currentRevision!.answerKey, hash: t.currentRevision!.answerHash!, bytes: t.currentRevision!.answerBytes! } : null,
    provenance: t.currentRevision!.provenance,
  })) as CaseSnapshot[];
  const scopedSettings: Partial<JudgeSettingsValue> = {};
  if (['ANSWERS', 'ACCEPTANCE', 'STRESS', 'REPLAY'].includes(purpose)) Object.assign(scopedSettings, settings);
  else if (purpose === 'SELF_TEST') Object.assign(scopedSettings, { checkerMode: settings.checkerMode, absoluteTolerance: settings.absoluteTolerance, relativeTolerance: settings.relativeTolerance });
  const interactiveData = settings.interactionMode === 'INTERACTIVE' && ['GENERATE', 'VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(purpose);
  if (interactiveData) scopedSettings.interactionMode = 'INTERACTIVE';
  return {
    problemId, purpose, ...(programId ? { programId } : {}), budgetMs: stressData?.budgetMs ?? budgetMs, policy: plans.length || stressData ? GENERATOR_DEDUP_POLICY : JUDGE_POLICY, toolchain: JUDGE_TOOLCHAIN, sandboxVersion: GO_JUDGE_VERSION,
    ...(stress ? { stress: { version: stress.version, hash: stress.hash, data: stressData! } } : {}),
    ...(groupConfig && !stressData ? { groups: { version: groupConfig.version, hash: groupConfig.hash, data: groupData! } } : {}),
    ...(stressGroups ? { stressGroups } : {}),
    ...(interactiveData ? { dataPolicy: JUDGING_DATA_POLICY } : {}),
    ...(settings.interactionMode === 'INTERACTIVE' && ['ANSWERS', 'ACCEPTANCE'].includes(purpose) ? { interactionPolicy: INTERACTION_POLICY } : {}),
    programs: programSnapshots, tests: caseSnapshots, settings: scopedSettings,
    plans: plans.map(p => ({ ...p.data as GeneratorPlanSave, id: p.id, version: p.version, hash: p.hash })),
    selfTests: selfTests.map(t => ({ ...t.data as object, id: t.id, version: t.version, hash: t.hash })) as SelfTestSnapshot[],
  };
}
export function dependencyHash(snapshot: JudgeSnapshot) {
  // Budget controls execution, not whether the completed content report is current.
  const { budgetMs: _budget, replay: _replay, ...dependencies } = snapshot;
  return hashObject({ ...dependencies, purpose: snapshot.purpose === 'REPLAY' ? 'STRESS' : snapshot.purpose });
}
export function validateJudgeSnapshot(input: JudgeSnapshot) {
  if (['STRESS', 'REPLAY'].includes(input.purpose)) {
    const s = input.stress?.data;
    if (!s) throw new HttpError(422, '请先保存对拍配置');
    if ((s.groupIds?.length ?? 0) !== (input.stressGroups?.length ?? 0)) throw new HttpError(422, '对拍选择的数据组已不存在，请更新配置');
    for (const id of input.stressGroups?.flatMap(g=>g.extraValidatorIds) ?? []) if (!input.programs.some(p=>p.id===id&&p.enabled&&p.role==='EXTRA_VALIDATOR'&&p.validatorScope==='GROUPS')) throw new HttpError(422, '对拍选择的组级额外 Validator 已改变');
    const role = (id: string, roles: string[]) => input.programs.some(p => p.id === id && p.enabled && roles.includes(p.role));
    if (!role(s.generatorId, ['GENERATOR']) || !role(s.referenceId, [...solutionRoles]) || !role(s.candidateId, [...solutionRoles]) || s.referenceId === s.candidateId) throw new HttpError(422, '对拍需要本题启用的生成器及两个不同解法');
    if (input.settings.interactionMode !== 'BATCH') throw new HttpError(422, '对拍配置用于批处理题；交互题请使用交互验收');
    if (input.settings.checkerMode === 'CUSTOM' ? !s.checkerId || !role(s.checkerId, ['CHECKER']) : s.checkerId !== null) throw new HttpError(422, '请选择本题 Checker，内置比较器请留空');
    if (input.programs.filter(p => p.enabled && p.role === 'VALIDATOR').length !== 1) throw new HttpError(422, '对拍必须恰好启用一个主 Validator');
  }
  if (input.purpose === 'COMPILE' && (!input.programId || input.programs.length !== 1)) throw new HttpError(422, '编译任务需要选择本题程序');
  if (input.programs.some(p => !p.profile.enabled)) throw new HttpError(422, '所选程序的编译 profile 已停用，请选择管理员提供的启用版本');
  if (input.programs.some(p => testlibRoles.has(p.role) && !isCppLanguage(p.profile.language))) throw new HttpError(422, 'Validator / Checker / Interactor 必须选择 C++ 编译配置');
  if (['ANSWERS', 'ACCEPTANCE'].includes(input.purpose)) {
    if (input.settings.scoringMode === 'PARTIAL' && !input.groups?.data.groups.some(g=>g.points>0)) throw new HttpError(422, '部分分需要有正分数的数据组');
    if (input.settings.scoringMode === 'ACM' && input.programs.some(p=>p.expectedScore)) throw new HttpError(422, '分数预期适用于部分分模式，请显式选择部分分或移除分数声明');
    if (input.settings.interactionMode === 'INTERACTIVE' && (input.settings.ioMode !== 'STDIO' || input.programs.filter(p => p.role === 'INTERACTOR' && p.enabled).length !== 1)) throw new HttpError(422, '交互执行使用标准管道且必须恰好启用一个 Interactor');
    if (input.programs.filter(p => p.role === 'MAIN_SOLUTION' && p.enabled).length !== 1) throw new HttpError(422, '必须恰好启用一个主标程');
  }
  if (['VALIDATE', 'ANSWERS', 'ACCEPTANCE'].includes(input.purpose)) {
    if (!input.tests.length && !input.plans.length) throw new HttpError(422, input.settings.interactionMode === 'INTERACTIVE' ? '交互样例仅用于题面展示；请添加至少一组启用的非样例测试数据或生成计划' : '至少需要一组启用的数据或生成计划');
    if (input.programs.filter(p => p.role === 'VALIDATOR' && p.enabled).length !== 1) throw new HttpError(422, '必须恰好启用一个主 Validator');
    if (input.tests.length + input.plans.reduce((n, p) => n + p.count, 0) > 200) throw new HttpError(422, '一次任务最多 200 组数据');
  }
  if (input.purpose === 'GENERATE' && !input.plans.length) throw new HttpError(422, '没有启用的生成计划');
  for (const plan of input.plans) {
    try { generatorPlanCommands(plan); } catch (error) { throw new HttpError(422, `${plan.name}：${(error as Error).message}`); }
    for (const id of generatorPlanProgramIds(plan)) {
      const generator = input.programs.find(p => p.id === id);
      if (!generator || !generator.enabled || generator.role !== 'GENERATOR') throw new HttpError(422, `生成计划 ${plan.name} 的生成器不可用`);
    }
  }
  if (['ANSWERS', 'SELF_TEST', 'ACCEPTANCE'].includes(input.purpose) && input.settings.checkerMode === 'CUSTOM' && input.programs.filter(p => p.role === 'CHECKER' && p.enabled).length > 1) throw new HttpError(422, '只能启用一个判题 Checker');
  if (['ANSWERS', 'ACCEPTANCE'].includes(input.purpose) && !(input.settings.interactionMode === 'INTERACTIVE' && (input.settings.interaction?.verdictMode ?? 'DIRECT') === 'DIRECT') && input.settings.checkerMode === 'CUSTOM' && !input.programs.some(p => p.role === 'CHECKER' && p.enabled)) throw new HttpError(422, '自定义比较需要启用 testlib Checker');
  if (input.purpose === 'SELF_TEST' && !input.selfTests.length) throw new HttpError(422, '没有启用的工具自测');
  if (input.groups?.data.groups.length) {
    const groups = input.groups.data.groups;
    try { groupOrder(groups); } catch (e) { if (e instanceof GroupError) throw new HttpError(422,e.message); throw e; }
    const members = groups.flatMap(g=>g.members);
    if (input.plans.length || members.length !== input.tests.length || input.tests.some(t=>!members.some(m=>m.testId===t.id&&m.revisionId===t.revisionId))) throw new HttpError(422, '数据组必须固定全部参与判题数据的当前版本（交互样例不参与）；生成数据请先收集并停用生成计划，再显式更新组成员');
    for (const id of groups.flatMap(g=>g.extraValidatorIds)) if (!input.programs.some(p=>p.id===id&&p.enabled&&p.role==='EXTRA_VALIDATOR'&&p.validatorScope==='GROUPS')) throw new HttpError(422, '组级额外 Validator 已停用或角色/范围已改变');
    for (const p of input.programs) if (p.expectedScore?.groups.some(e=>!groups.some(g=>g.id===e.groupId))) throw new HttpError(422, `${p.name} 的分数预期引用已移除的数据组`);
  }
  for (const t of input.selfTests) {
    if (t.programId) {
      const p = input.programs.find(p => p.id === t.programId);
      if (!p || !(t.kind === 'VALIDATOR' ? ['VALIDATOR', 'EXTRA_VALIDATOR'] : ['CHECKER']).includes(p.role)) throw new HttpError(422, `自测 ${t.name} 的工具角色已改变`);
    } else if (t.kind !== 'CHECKER' || input.settings.checkerMode === 'CUSTOM') throw new HttpError(422, '自定义工具自测必须指定本题程序');
  }
}
export const builtinProfiles: Omit<ProfileSnapshot, 'version'>[] = programLanguages.map(language => {
  const config = { optimization: 'O2' as const, warnings: true, compileTimeMs: 10000, compileMemoryMb: 512 };
  const names = { CPP17: 'GNU C++17', CPP20: 'GNU C++20', CPP23: 'GNU C++23', C17: 'GNU C17', JAVA17: 'Java (OpenJDK 17)', PYTHON3: 'Python 3.11' };
  return { id: `builtin-${language.toLowerCase()}`, name: names[language], language, config, hash: hashObject({ language, config }), enabled: true };
});
