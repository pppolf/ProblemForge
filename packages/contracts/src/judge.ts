import { Type, type Static } from '@sinclair/typebox';

const strict = { additionalProperties: false };
export const programRoles = ['MAIN_SOLUTION', 'CORRECT_SOLUTION', 'WRONG_SOLUTION', 'TIME_LIMIT_SOLUTION', 'BRUTE_FORCE', 'GENERATOR', 'VALIDATOR', 'EXTRA_VALIDATOR', 'CHECKER', 'INTERACTOR'] as const;
export type ProgramRole = typeof programRoles[number];
export const programRoleLabels: Record<ProgramRole, string> = {
  MAIN_SOLUTION: '主标程', CORRECT_SOLUTION: '正确解', WRONG_SOLUTION: '错误解', TIME_LIMIT_SOLUTION: '预期超时解',
  BRUTE_FORCE: '暴力解', GENERATOR: '生成器', VALIDATOR: 'Validator', EXTRA_VALIDATOR: '额外 Validator', CHECKER: 'Checker', INTERACTOR: 'Interactor',
};
export const programLanguages = ['CPP17', 'CPP20', 'PYTHON3'] as const;
export type ProgramLanguage = typeof programLanguages[number];
export const verdicts = ['AC', 'WA', 'PE', 'TLE', 'MLE', 'OLE', 'RE'] as const;
export type ExpectedVerdict = typeof verdicts[number];
export const judgePurposes = ['COMPILE', 'GENERATE', 'VALIDATE', 'ANSWERS', 'SELF_TEST', 'ACCEPTANCE', 'STRESS', 'REPLAY'] as const;
export type JudgePurpose = typeof judgePurposes[number];
const literalUnion = <T extends string>(values: readonly T[]) => Type.Union(values.map(v => Type.Literal(v)));
export const InteractionSettings = Type.Object({
  verdictMode: literalUnion(['DIRECT', 'CHECKER']), interactorTimeMs: Type.Integer({ minimum: 50, maximum: 10000 }),
  interactorMemoryMb: Type.Integer({ minimum: 32, maximum: 1024 }), wallTimeMs: Type.Integer({ minimum: 500, maximum: 30000 }),
  idleTimeMs: Type.Integer({ minimum: 100, maximum: 10000 }), transcriptBytes: Type.Integer({ minimum: 1024, maximum: 262144 }),
}, strict);
export const defaultInteractionSettings: Static<typeof InteractionSettings> = { verdictMode: 'DIRECT', interactorTimeMs: 2000, interactorMemoryMb: 256, wallTimeMs: 10000, idleTimeMs: 1000, transcriptBytes: 65536 };
export const judgePurposeLabels: Record<JudgePurpose, string> = { COMPILE: '编译', GENERATE: '生成输入', VALIDATE: '校验输入', ANSWERS: '生成答案', SELF_TEST: '工具自测', ACCEPTANCE: '完整验收', STRESS: '有预算对拍', REPLAY: '反例复现' };
export const JudgeSettings = Type.Object({
  interactionMode: literalUnion(['BATCH', 'INTERACTIVE']), checkerMode: literalUnion(['EXACT', 'TOKENS', 'FLOAT', 'CUSTOM']),
  scoringMode: literalUnion(['ACM', 'PARTIAL']), ioMode: literalUnion(['STDIO', 'FILES']),
  inputFile: Type.String({ pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,63}$' }), outputFile: Type.String({ pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,63}$' }),
  timeLimitMs: Type.Integer({ minimum: 50, maximum: 10000 }), memoryLimitMb: Type.Integer({ minimum: 32, maximum: 1024 }),
  outputLimitBytes: Type.Integer({ minimum: 1024, maximum: 4_194_304 }),
  absoluteTolerance: Type.Number({ minimum: 0, maximum: 1 }), relativeTolerance: Type.Number({ minimum: 0, maximum: 1 }),
  interaction: Type.Optional(InteractionSettings),
}, strict);
export type JudgeSettingsValue = Static<typeof JudgeSettings>;
export const JudgeSettingsInput = Type.Object({ expectedVersion: Type.Integer({ minimum: 1 }), settings: JudgeSettings }, strict);
export const defaultJudgeSettings: JudgeSettingsValue = {
  interactionMode: 'BATCH', checkerMode: 'TOKENS', scoringMode: 'ACM', ioMode: 'STDIO', inputFile: 'input.txt', outputFile: 'output.txt',
  timeLimitMs: 1000, memoryLimitMb: 256, outputLimitBytes: 1_048_576, absoluteTolerance: 1e-6, relativeTolerance: 1e-6,
};
export const ProfileConfig = Type.Object({
  optimization: literalUnion(['O0', 'O2']), warnings: Type.Boolean(), compileTimeMs: Type.Integer({ minimum: 1000, maximum: 30000 }),
  compileMemoryMb: Type.Integer({ minimum: 128, maximum: 1024 }),
}, strict);
export type ProfileConfigValue = Static<typeof ProfileConfig>;
export const ProfileInput = Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }), language: literalUnion(programLanguages), enabled: Type.Boolean(), config: ProfileConfig }, strict);
export const ProfileUpdateInput = Type.Object({ ...ProfileInput.properties, expectedVersion: Type.Integer({ minimum: 1 }) }, strict);
const programProperties = {
  name: Type.String({ minLength: 1, maxLength: 120 }), role: literalUnion(programRoles), profileId: Type.String({ minLength: 1, maxLength: 80 }),
  source: Type.String({ minLength: 1, maxLength: 100000 }), enabled: Type.Boolean(), notes: Type.String({ maxLength: 1000 }),
  expectedVerdicts: Type.Array(literalUnion(verdicts), { minItems: 1, maxItems: 7, uniqueItems: true }),
  validatorScope: Type.Optional(literalUnion(['GLOBAL', 'GROUPS'])),
  expectedScore: Type.Optional(Type.Union([Type.Null(), Type.Object({
    total: Type.Optional(Type.Object({ min: Type.Number({ minimum: 0, maximum: 10000, multipleOf: 0.001 }), max: Type.Number({ minimum: 0, maximum: 10000, multipleOf: 0.001 }) }, strict)),
    groups: Type.Array(Type.Object({ groupId: Type.String({ pattern: '^[A-Za-z0-9_-]{1,40}$' }), min: Type.Number({ minimum: 0, maximum: 10000, multipleOf: 0.001 }), max: Type.Number({ minimum: 0, maximum: 10000, multipleOf: 0.001 }) }, strict), { maxItems: 30 }),
  }, strict)])),
};
export const ProgramInput = Type.Object(programProperties, strict);
export const ProgramUpdateInput = Type.Object({ ...programProperties, expectedVersion: Type.Integer({ minimum: 1 }) }, strict);
export type ProgramSave = Static<typeof ProgramInput>;
export const RawBase64 = Type.String({ maxLength: 1_400_000, pattern: '^[A-Za-z0-9+/]*={0,2}$' });
const testProperties = {
  number: Type.Integer({ minimum: 1, maximum: 100000 }), groupName: Type.String({ pattern: '^[A-Za-z0-9_-]{1,40}$' }),
  isSample: Type.Boolean(), enabled: Type.Boolean(), notes: Type.String({ maxLength: 1000 }), inputBase64: RawBase64,
  answerBase64: Type.Union([RawBase64, Type.Null()]),
};
export const TestCaseInput = Type.Object(testProperties, strict);
export const TestCaseUpdateInput = Type.Object({ ...testProperties, expectedVersion: Type.Integer({ minimum: 1 }) }, strict);
export type TestCaseSave = Static<typeof TestCaseInput>;
export const TestGroupsInput = Type.Object({ groups: Type.Array(Type.Object({
  id: testProperties.groupName, points: Type.Integer({ minimum: 0, maximum: 10000 }), aggregation: literalUnion(['ALL', 'WEIGHTED']),
  members: Type.Array(Type.Object({ testId: Type.String({ minLength: 1 }), revisionId: Type.String({ minLength: 1 }), weight: Type.Integer({ minimum: 1, maximum: 1000000 }) }, strict), { minItems: 1, maxItems: 200 }),
  dependencies: Type.Array(testProperties.groupName, { maxItems: 30, uniqueItems: true }),
  extraValidatorIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 30, uniqueItems: true }),
}, strict), { maxItems: 30 }) }, strict);
export const TestGroupsUpdateInput = Type.Object({ expectedVersion: Type.Integer({ minimum: 0 }), data: TestGroupsInput }, strict);
export type TestGroupsValue = Static<typeof TestGroupsInput>;
export type ScoreExpectation = NonNullable<ProgramSave['expectedScore']>;
export const TestZipInput = Type.Object({ base64: Type.String({ minLength: 1, maxLength: 11_200_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' }), groupName: testProperties.groupName }, strict);
const planProperties = {
  name: programProperties.name, programId: Type.String({ minLength: 1, maxLength: 80 }), enabled: Type.Boolean(),
  argv: Type.Array(Type.String({ maxLength: 512, pattern: '^[^\u0000\r\n]*$' }), { maxItems: 32 }),
  seed: Type.String({ pattern: '^-?[0-9]{1,18}$' }), count: Type.Integer({ minimum: 1, maximum: 100 }),
  numberStart: testProperties.number, groupName: testProperties.groupName, isSample: Type.Boolean(),
};
export const GeneratorPlanInput = Type.Object(planProperties, strict);
export const GeneratorPlanUpdateInput = Type.Object({ ...planProperties, expectedVersion: Type.Integer({ minimum: 1 }) }, strict);
export type GeneratorPlanSave = Static<typeof GeneratorPlanInput>;
export const StressConfigInput = Type.Object({
  generatorId: planProperties.programId, referenceId: planProperties.programId, candidateId: planProperties.programId,
  checkerId: Type.Union([planProperties.programId, Type.Null()]), argv: planProperties.argv, seed: planProperties.seed,
  iterations: Type.Integer({ minimum: 1, maximum: 200 }), budgetMs: Type.Integer({ minimum: 1000, maximum: 600000 }),
  stop: literalUnion(['FIRST_COUNTEREXAMPLE', 'CONTINUE']),
  groupIds: Type.Optional(Type.Array(testProperties.groupName, { maxItems: 30, uniqueItems: true })),
}, strict);
export const StressConfigUpdateInput = Type.Object({ expectedVersion: Type.Integer({ minimum: 0 }), data: StressConfigInput }, strict);
export type StressConfigValue = Static<typeof StressConfigInput>;
const selfTestProperties = {
  name: programProperties.name, kind: literalUnion(['VALIDATOR', 'CHECKER']), programId: Type.Union([Type.String({ minLength: 1, maxLength: 80 }), Type.Null()]),
  enabled: Type.Boolean(), expected: literalUnion(['ACCEPT', 'REJECT', 'AC', 'WA', 'PE']),
  inputBase64: RawBase64, answerBase64: RawBase64, outputBase64: RawBase64,
};
export const ToolSelfTestInput = Type.Object(selfTestProperties, strict);
export const ToolSelfTestUpdateInput = Type.Object({ ...selfTestProperties, expectedVersion: Type.Integer({ minimum: 1 }) }, strict);
export type ToolSelfTestSave = Static<typeof ToolSelfTestInput>;
export const TestRunInput = Type.Object({
  purpose: literalUnion(judgePurposes), programId: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  requestKey: Type.String({ minLength: 16, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' }),
  budgetMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 600000 })),
}, strict);
