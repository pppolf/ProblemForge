import { Type } from '@sinclair/typebox';
import { db, type Prisma, type JudgePurpose } from '@problemforge/database';
import { HttpError, problemPermission, problemAccess, contestAccess } from '@problemforge/domain';
import { authenticate, type Api } from '../app.ts';
import { buildAccess } from './builds.ts';
import { PageFields, pagination, authorizedPage, pageOrder } from '../pagination.ts';

const Text = Type.String({ maxLength: 100 });
const TaskQuery = Type.Object({ ...PageFields, problemId: Type.Optional(Text), contestId: Type.Optional(Text), state: Type.Optional(Type.Union(['QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELED'].map(value => Type.Literal(value)))), purpose: Type.Optional(Text), from: Type.Optional(Type.String({ format: 'date-time' })), to: Type.Optional(Type.String({ format: 'date-time' })) }, { additionalProperties: false });
const ListQuery = Type.Object({ ...PageFields, q: Type.Optional(Type.String({ maxLength: 160 })), archived: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])) }, { additionalProperties: false });
export function memberWhere(user: {id:string;role:string}): Prisma.ProblemWhereInput {
  return user.role === 'ADMIN' ? {} : { OR: [{ members: { some: { userId: user.id } } }, { groupMembers: { some: { group: { members: { some: { userId: user.id } } } } } }] };
}
export async function historyRoutes(app: Api) {
  app.get('/api/builds/page', { preHandler: authenticate, schema: { querystring: TaskQuery } }, async req => {
    const { cursor, limit, ...filters } = req.query;
    if (filters.problemId && filters.contestId) throw new HttpError(400, '题目和比赛筛选不能同时使用');
    if (filters.problemId) await problemPermission(req.user, filters.problemId);
    if (filters.contestId) await contestAccess(req.user, filters.contestId);
    if (filters.purpose && !['DOCUMENT','CONTEST','TEMPLATE_VALIDATION'].includes(filters.purpose)) throw new HttpError(400, '未知 TeX 任务用途');
    if (filters.from && filters.to && new Date(filters.from) > new Date(filters.to)) throw new HttpError(400, '开始时间不能晚于结束时间');
    const page = pagination({ cursor, limit }, { user: req.user.id, type: 'builds', filters });
    const where: Prisma.BuildWhereInput = { ...(filters.problemId ? { problemId: filters.problemId } : filters.contestId ? { contestId: filters.contestId } : { requestedById: req.user.id }), ...(filters.state ? { state: filters.state as Prisma.EnumBuildStateFilter['equals'] } : {}), ...(filters.purpose ? { purpose: filters.purpose } : {}), createdAt: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } };
    const result = await authorizedPage(page, (position, take) => db.build.findMany({ where: { AND: [where, position] }, select: { id: true, kind: true, state: true, purpose: true, problemId: true, contestId: true, documentId: true, createdAt: true, updatedAt: true, cacheSourceId: true }, orderBy: [...pageOrder], take }), row => buildAccess(req, row));
    return { ...result, rows: result.rows.map(({ id, kind, state, purpose, problemId, contestId, documentId, createdAt, updatedAt, cacheSourceId }) => ({ id, kind, state, purpose, problemId, contestId, documentId, createdAt, updatedAt, cacheSourceId })) };
  });
  app.get('/api/test-runs/page', { preHandler: authenticate, schema: { querystring: TaskQuery } }, async req => {
    const { cursor, limit, ...filters } = req.query;
    if (filters.contestId) throw new HttpError(400, 'Judge 历史按题目筛选');
    if (filters.problemId) await problemAccess(req.user, filters.problemId);
    if (filters.purpose && !['COMPILE','GENERATE','VALIDATE','ANSWERS','SELF_TEST','ACCEPTANCE','STRESS','REPLAY'].includes(filters.purpose)) throw new HttpError(400, '未知 Judge 任务用途');
    if (filters.from && filters.to && new Date(filters.from) > new Date(filters.to)) throw new HttpError(400, '开始时间不能晚于结束时间');
    const page = pagination({ cursor, limit }, { user: req.user.id, type: 'runs', filters });
    const where: Prisma.TestRunWhereInput = { ...(filters.problemId ? { problemId: filters.problemId } : { requestedById: req.user.id }), ...(filters.state ? { state: filters.state as Prisma.EnumBuildStateFilter['equals'] } : {}), ...(filters.purpose ? { purpose: filters.purpose as JudgePurpose } : {}), createdAt: { ...(filters.from ? { gte: new Date(filters.from) } : {}), ...(filters.to ? { lte: new Date(filters.to) } : {}) } };
    const result = await authorizedPage(page, (position, take) => db.testRun.findMany({ where: { AND: [where, position] }, select: { id: true, problemId: true, purpose: true, state: true, accepted: true, completed: true, total: true, stage: true, createdAt: true, updatedAt: true }, orderBy: [...pageOrder], take }), row => problemAccess(req.user, row.problemId));
    return result;
  });
  app.get('/api/problems/page', { preHandler: authenticate, schema: { querystring: ListQuery } }, async req => {
    const { cursor, limit, ...filters } = req.query, q = filters.q?.trim() ?? '';
    const page = pagination({ cursor, limit }, { user: req.user.id, type: 'problems', filters });
    // Tags are an array; use a parameterized substring query, including Unicode and case.
    const tags = q ? await db.$queryRaw<{id:string}[]>`SELECT p.id FROM "Problem" p WHERE EXISTS (SELECT 1 FROM unnest(p.tags) tag WHERE strpos(lower(tag),lower(${q})) > 0)` : [];
    const responsible = q ? await db.user.findMany({ where: { name: { contains: q, mode: 'insensitive' } }, select: { id: true } }) : [];
    const where: Prisma.ProblemWhereInput = { AND: [memberWhere(req.user), page.where(), ...(filters.archived === 'true' ? [] : [{ archived: false }]), ...(q ? [{ OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { id: { in: tags.map(p => p.id) } }, { responsibleId: { in: responsible.map(u => u.id) } }] }] : [])] };
    const rows = await db.problem.findMany({ where, select: { id: true, title: true, tags: true, responsibleId: true, archived: true, updatedAt: true, createdAt: true, _count: { select: { documents: true } } }, orderBy: [...pageOrder], take: page.limit+1 });
    const hasMore = rows.length > page.limit; if (hasMore) rows.pop();
    return { rows, currentCursor: page.currentCursor, nextCursor: hasMore ? page.next(rows.at(-1)!) : null, asOf: page.asOf };
  });
}
