import type { JudgePurpose, JudgeSettingsValue, ProfileConfigValue, ProgramLanguage, ProgramRole, ExpectedVerdict, GeneratorPlanSave, StressConfigValue, TestGroupsValue, ScoreExpectation } from '@problemforge/contracts';
import type { SandboxResult } from '@problemforge/judge-adapter';

export const JUDGE_POLICY = 'problemforge-judge-v1';
export const GENERATOR_COMMAND_POLICY = 'problemforge-judge-command-lines-v1';
export const GENERATOR_DEDUP_POLICY = 'problemforge-judge-generated-input-dedup-v2';
export { interactionVerdict, INTERACTION_POLICY } from './interaction.ts';
export { scoreGroups, scoreExpectation, groupOrder, GroupError, type ScoreReport, type GroupScore } from './scoring.ts';
export const TESTLIB_COMMIT = '68f9f300b6abebec82d2a68d8ca04394f2664fb6';
export const TESTLIB_HASH = '70f74c570f2b45d63086ae6e4c41bbb5c5ffd4428cba9914bbc0396d29be10d8';
export const JUDGE_TOOLCHAIN = `debian12-gcc12.2.0-14+deb12u1-python3.11.2-6+deb12u8-openjdk17.0.20.1+1-1~deb12u1-compile2-testlib0.9.41-${TESTLIB_HASH}`;
export const solutionRoles = new Set<ProgramRole>(['MAIN_SOLUTION', 'CORRECT_SOLUTION', 'WRONG_SOLUTION', 'TIME_LIMIT_SOLUTION', 'BRUTE_FORCE']);
export const testlibRoles = new Set<ProgramRole>(['VALIDATOR', 'EXTRA_VALIDATOR', 'CHECKER', 'INTERACTOR']);
export type BlobRef = { key: string; hash: string; bytes: number };
export type ProfileSnapshot = { id: string; name: string; version: number; language: ProgramLanguage; config: ProfileConfigValue; hash: string; enabled: boolean };
export type ProgramSnapshot = { id: string; revisionId: string; version: number; name: string; role: ProgramRole; enabled: boolean; source: string; sourceHash: string; expectedVerdicts: ExpectedVerdict[]; profile: ProfileSnapshot; validatorScope?: 'GROUPS'; expectedScore?: ScoreExpectation };
export type CaseSnapshot = { ref: string; id: string; revisionId: string; version: number; number: number; groupName: string; isSample: boolean; input: BlobRef; answer: BlobRef | null; provenance: Record<string, unknown> };
export type PlanSnapshot = GeneratorPlanSave & { id: string; version: number; hash: string };
export type SelfTestSnapshot = { id: string; version: number; hash: string; name: string; kind: 'VALIDATOR' | 'CHECKER'; programId: string | null; expected: string; input: BlobRef; answer: BlobRef; output: BlobRef };
export type JudgeSnapshot = {
  problemId: string; purpose: JudgePurpose; programId?: string; budgetMs: number; policy: string; toolchain: string; sandboxVersion: string;
  programs: ProgramSnapshot[]; tests: CaseSnapshot[]; plans: PlanSnapshot[]; selfTests: SelfTestSnapshot[];
  settings: Partial<JudgeSettingsValue>;
  stress?: { version: number; hash: string; data: StressConfigValue };
  replay?: { sourceRunId: string; sourceCaseId: string; input: BlobRef; answer: BlobRef; seed: string; verdict: string; regenerate: boolean };
  interactionPolicy?: string;
  groups?: { version: number; hash: string; data: TestGroupsValue };
  stressGroups?: { id: string; extraValidatorIds: string[] }[];
};
export type Comparison = { verdict: 'AC' | 'WA'; diagnostic: string };
const words = (bytes: Buffer) => bytes.toString('latin1').split(/[ \t\n\r\v\f]+/).filter(Boolean);
const finiteNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const specialNumber = /^[+-]?(?:nan|inf|infinity)$/i;
export function compareOutput(answer: Buffer, output: Buffer, settings: Pick<JudgeSettingsValue, 'checkerMode' | 'absoluteTolerance' | 'relativeTolerance'>): Comparison {
  if (settings.checkerMode === 'CUSTOM') throw new Error('自定义 Checker 必须在 Linux 沙箱执行');
  if (settings.checkerMode === 'EXACT') return answer.equals(output) ? { verdict: 'AC', diagnostic: '原始字节相同' } : { verdict: 'WA', diagnostic: `字节不同（答案 ${answer.length}，输出 ${output.length}）；空白和末尾换行也参与比较` };
  const expected = words(answer), actual = words(output);
  if (expected.length !== actual.length) return { verdict: 'WA', diagnostic: `token 数不同：预期 ${expected.length}，实际 ${actual.length}；不忽略尾随内容` };
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i], b = actual[i];
    if (settings.checkerMode === 'FLOAT' && (specialNumber.test(a) || specialNumber.test(b))) return { verdict: 'WA', diagnostic: `第 ${i + 1} 个 token：禁止 NaN / Infinity` };
    if (settings.checkerMode === 'FLOAT' && finiteNumber.test(a) && finiteNumber.test(b)) {
      const x = Number(a), y = Number(b), diff = Math.abs(x - y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !(diff <= settings.absoluteTolerance || diff <= settings.relativeTolerance * Math.abs(x))) return { verdict: 'WA', diagnostic: `第 ${i + 1} 个数值超出绝对/相对误差；相对误差以答案绝对值为基准` };
    } else if (a !== b) return { verdict: 'WA', diagnostic: `第 ${i + 1} 个 token 不同` };
  }
  return { verdict: 'AC', diagnostic: settings.checkerMode === 'FLOAT' ? '数值在误差范围内，非数值 token 完全相同' : 'token 相同（仅忽略六种 ASCII 空白）' };
}
export function executionVerdict(result: SandboxResult): 'AC' | 'TLE' | 'MLE' | 'OLE' | 'RE' | 'INFRA_ERROR' {
  if (result.status === 'Internal Error' || result.fileError?.some(f => f.type.startsWith('CopyIn'))) return 'INFRA_ERROR';
  if (result.status === 'Time Limit Exceeded') return 'TLE';
  if (result.status === 'Memory Limit Exceeded') return 'MLE';
  if (result.status === 'Output Limit Exceeded' || result.fileError?.some(f => ['CopyOutSizeExceeded', 'CollectSizeExceeded'].includes(f.type))) return 'OLE';
  if (result.status === 'Accepted' && result.exitStatus === 0 && !result.fileError?.length) return 'AC';
  return 'RE';
}
export function checkerVerdict(result: SandboxResult): 'AC' | 'WA' | 'PE' | 'TOOL_ERROR' | 'INFRA_ERROR' {
  if (executionVerdict(result) === 'INFRA_ERROR') return 'INFRA_ERROR';
  if (result.fileError?.length || !['Accepted', 'Nonzero Exit Status'].includes(result.status)) return 'TOOL_ERROR';
  if (result.status === 'Accepted' && result.exitStatus === 0) return 'AC';
  if (result.status === 'Nonzero Exit Status' && result.exitStatus === 1) return 'WA';
  if (result.status === 'Nonzero Exit Status' && [2, 4].includes(result.exitStatus)) return 'PE';
  // testlib _fail=3 is an author tool failure, never a defeated solution.
  return 'TOOL_ERROR';
}
export function validatorVerdict(result: SandboxResult): 'ACCEPT' | 'REJECT' | 'TOOL_ERROR' | 'INFRA_ERROR' {
  if (executionVerdict(result) === 'INFRA_ERROR') return 'INFRA_ERROR';
  if (result.fileError?.length) return 'TOOL_ERROR';
  if (result.status === 'Accepted' && result.exitStatus === 0) return 'ACCEPT';
  // In testlib validation mode malformed input exits _fail=3.
  if (result.status === 'Nonzero Exit Status' && result.exitStatus === 3) return 'REJECT';
  return 'TOOL_ERROR';
}
export function checkExpectation(program: Pick<ProgramSnapshot, 'role' | 'expectedVerdicts'>, results: string[]) {
  const unhealthy = results.some(v => ['CE', 'TOOL_ERROR', 'INFRA_ERROR', 'SKIPPED'].includes(v));
  const allPass = results.length > 0 && results.every(v => v === 'AC');
  if (['MAIN_SOLUTION', 'CORRECT_SOLUTION'].includes(program.role) || program.expectedVerdicts.includes('AC')) return { passed: allPass, diagnostic: allPass ? '通过所有必需数据' : '声明正确的解法未通过所有数据' };
  const defeated = results.some(v => program.expectedVerdicts.includes(v as ExpectedVerdict));
  return { passed: !unhealthy && defeated, diagnostic: unhealthy ? '编译/工具/基础设施错误不能作为击败证据' : defeated ? '出现声明的预期判定' : '未击败：没有出现声明的预期判定' };
}
