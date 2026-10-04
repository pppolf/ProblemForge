import { type ContestDataValue, type DocumentKind, type ProblemManifest, kinds } from '@problemforge/contracts';
import { db, Prisma } from '@problemforge/database';
import { contestAccess, hashObject, HttpError } from '@problemforge/domain';
import { templateLanguages, validateBody, type TemplateFiles } from '@problemforge/template-engine';
import { problemSnapshot } from './revision-snapshot.ts';

export type FrozenContest = {
  schemaVersion: 1;
  selection: ContestDataValue;
  problems: { problemId: string; revisionId: string; revisionNumber: number | null; hash: string; judgeHash: string; acceptanceRunId: string; manifest: ProblemManifest }[];
  templates: Partial<Record<DocumentKind, { id: string; number: number; hash: string; files: TemplateFiles }>>;
};
type SourceSnapshot = Awaited<ReturnType<typeof problemSnapshot>>;

// Old saved contests keep their original JSON in storage, but now follow the source
// problem too. Revision IDs remain meaningful only inside immutable snapshots.
export function liveContestData(data: ContestDataValue): ContestDataValue {
  return { ...data, items: data.items.map(({ revisionId, ...item }) => item) };
}

export async function contestSources(tx: Prisma.TransactionClient, data: ContestDataValue) {
  const available = new Set((await tx.problem.findMany({ where: { id: { in: data.items.map(i => i.problemId) } }, select: { id: true } })).map(p => p.id));
  const sources = new Map<string, SourceSnapshot>();
  for (const item of data.items) if (available.has(item.problemId)) sources.set(item.problemId, await problemSnapshot(tx, item.problemId));
  return sources;
}

export function contestRevisionCurrent(revision: { data: unknown; hash: string }, data: ContestDataValue, sources: Map<string, SourceSnapshot>) {
  const frozen = revision.data as FrozenContest;
  return hashObject(frozen) === revision.hash
    && hashObject(liveContestData(frozen.selection)) === hashObject(liveContestData(data))
    && frozen.problems.length === data.items.length
    && data.items.every(item => sources.has(item.problemId) && frozen.problems.find(p => p.problemId === item.problemId)?.hash === sources.get(item.problemId)!.hash);
}

export async function currentContestRevisionIds(tx: Prisma.TransactionClient, contestId: string) {
  const contest = await tx.contest.findUniqueOrThrow({ where: { id: contestId } });
  const revisions = await tx.contestRevision.findMany({ where: { contestId } });
  const data = contest.data as ContestDataValue, sources = await contestSources(tx, data);
  return new Set(revisions.filter(r => contestRevisionCurrent(r, data, sources)).map(r => r.id));
}

export async function freezeCurrentContest(tx: Prisma.TransactionClient, contestId: string, userId: string, expectedVersion: number | undefined) {
  if (expectedVersion === undefined) throw new HttpError(400, '使用最新题目内容时必须提供比赛编排版本');
  await tx.$queryRaw`SELECT id FROM "Contest" WHERE id=${contestId} FOR UPDATE`;
  const contest = await tx.contest.findUniqueOrThrow({ where: { id: contestId } });
  if (contest.archived) throw new HttpError(409, '已归档比赛不能建立新冻结版本');
  if (contest.version !== expectedVersion) throw new HttpError(409, '比赛编排已改变，请重载合并', 'VERSION_CONFLICT');
  const data = liveContestData(contest.data as ContestDataValue);
  if (!data.items.length) throw new HttpError(422, '至少选择一道题目');
  const sources = await contestSources(tx, data);
  const snapshot: FrozenContest = { schemaVersion: 1, selection: structuredClone(data), problems: [], templates: {} };
  for (const item of snapshot.selection.items) {
    const source = sources.get(item.problemId);
    if (!source) throw new HttpError(409, `题号 ${item.code} 的源题已不存在，请调整比赛编排`);
    if (!source.judgeHash || !source.acceptanceRunId) throw new HttpError(409, `题号 ${item.code} 的最新内容缺少匹配的成功验收，请先完成题目验收`);
    const { manifest } = source;
    if (!manifest.documents.some(d => d.language === data.language && d.kind === 'STATEMENT' && d.enabled && d.body.trim())) throw new HttpError(422, `题号 ${item.code} 缺少所选语言的启用题面`);
    for (const document of manifest.documents.filter(d => d.enabled)) validateBody(document.body, document.kind, manifest.assets.map(a => a.path));
    item.revisionId = `WORKING:${source.hash}`;
    snapshot.problems.push({ problemId: item.problemId, revisionId: item.revisionId, revisionNumber: null, hash: source.hash, judgeHash: source.judgeHash, acceptanceRunId: source.acceptanceRunId, manifest });
  }
  for (const kind of kinds) {
    const id = data.templates[kind];
    if (!id) { if (kind === 'STATEMENT') throw new HttpError(422, '请选择比赛题册模板'); continue; }
    const template = await tx.templateVersion.findUnique({ where: { id }, include: { template: true } });
    const files = template?.files as TemplateFiles | undefined;
    if (!template || template.template.kind !== kind || !['PUBLISHED', 'ARCHIVED'].includes(template.state) || !files?.['booklet.tex']?.includes('{{CONTENTS}}')) throw new HttpError(422, '所选模板尚未提供多题组装入口或已撤回');
    if (!templateLanguages(files).includes(data.language)) throw new HttpError(422, '模板不支持比赛所选语言');
    snapshot.templates[kind] = { id, number: template.number, hash: template.hash, files };
  }
  const hash = hashObject(snapshot);
  const existing = await tx.contestRevision.findFirst({ where: { contestId, hash }, orderBy: { number: 'desc' } });
  if (existing) {
    if (hashObject(existing.data) !== existing.hash) throw new HttpError(409, '冻结清单哈希不匹配');
    return { revision: existing, snapshot };
  }
  const last = await tx.contestRevision.findFirst({ where: { contestId }, orderBy: { number: 'desc' }, select: { number: true } });
  const revision = await tx.contestRevision.create({ data: { contestId, number: (last?.number ?? 0) + 1, data: snapshot as unknown as Prisma.InputJsonValue, hash, createdById: userId } });
  await tx.auditLog.create({ data: { actorId: userId, action: 'FREEZE_CONTEST', resourceId: revision.id } });
  return { revision, snapshot };
}

export async function currentContestRevision(user: { id: string; role: string }, contestId: string, expectedVersion: number | undefined) {
  await contestAccess(user, contestId, true);
  return db.$transaction(tx => freezeCurrentContest(tx, contestId, user.id, expectedVersion), { isolationLevel: 'Serializable', timeout: 30000 });
}
