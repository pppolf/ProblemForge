import { Type } from '@sinclair/typebox';
import { hashObject, HttpError } from '@problemforge/domain';

export const PageFields = { cursor: Type.Optional(Type.String({ maxLength: 1500 })), limit: Type.Optional(Type.String({ pattern: '^(?:[1-9]|[1-9][0-9]|100)$' })) };
type Position = { id: string; createdAt: Date };
type Cursor = { v: 1; scope: string; asOf: string; after: { id: string; createdAt: string } | null };
export function pagination(query: { cursor?: string; limit?: string }, scope: unknown) {
  const fingerprint = hashObject(scope), limit = Number(query.limit ?? 25);
  let cursor: Cursor = { v: 1, scope: fingerprint, asOf: new Date().toISOString(), after: null };
  if (query.cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
      const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
      if (parsed.v !== 1 || parsed.scope !== fingerprint || !validDate(parsed.asOf) || parsed.asOf > new Date(Date.now()+1000).toISOString() || parsed.after !== null && (!parsed.after || typeof parsed.after.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(parsed.after.id) || !validDate(parsed.after.createdAt) || parsed.after.createdAt > parsed.asOf)) throw new Error();
      cursor = { v: 1, scope: fingerprint, asOf: parsed.asOf, after: parsed.after ? { id: parsed.after.id, createdAt: parsed.after.createdAt } : null };
    } catch { throw new HttpError(400, '分页位置无效或筛选范围已改变，请回到最新一页', 'INVALID_CURSOR'); }
  }
  const encode = (after: Cursor['after']) => Buffer.from(JSON.stringify({ ...cursor, after })).toString('base64url');
  const where = (after: Position | null = cursor.after ? { id: cursor.after.id, createdAt: new Date(cursor.after.createdAt) } : null) => ({
    AND: [{ createdAt: { lte: new Date(cursor.asOf) } }, ...(after ? [{ OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }] : [])],
  });
  return { limit, where, currentCursor: encode(cursor.after), asOf: cursor.asOf, next: (row: Position) => encode({ id: row.id, createdAt: row.createdAt.toISOString() }) };
}
export const pageOrder = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

// Authorization is evaluated per candidate before it reaches a response. A bounded
// scan can yield a short/empty page with a continuation, never skip visible rows.
export async function authorizedPage<T extends Position>(page: ReturnType<typeof pagination>, read: (where: ReturnType<typeof page.where>, take: number) => Promise<T[]>, authorize: (row: T) => Promise<unknown>) {
  const rows: T[] = []; let after: T | undefined, hasMore = false;
  for (let batch = 0; batch < 5; batch++) {
    const candidates = await read(after ? page.where(after) : page.where(), 100);
    for (const row of candidates) {
      try { await authorize(row); } catch (e) { if (e instanceof HttpError && [403,404].includes(e.statusCode)) { after = row; continue; } throw e; }
      if (rows.length === page.limit) return { rows, currentCursor: page.currentCursor, nextCursor: page.next(rows.at(-1)!), asOf: page.asOf };
      rows.push(row); after = row;
    }
    hasMore = candidates.length === 100;
    if (!hasMore) break;
  }
  return { rows, currentCursor: page.currentCursor, nextCursor: hasMore && after ? page.next(after) : null, asOf: page.asOf };
}
