import type { Prisma } from '@problemforge/database';
import type { TestCasesDelete, TestGroupsValue } from '@problemforge/contracts';
import { HttpError } from '@problemforge/domain';

// Caller holds the problem row lock. Validate the whole selection before writing;
// deleted rows retain their immutable revisions, but never reenter the working set.
export async function deleteTestCases(tx: Prisma.TransactionClient, problemId: string, selection: TestCasesDelete['tests'], actorId: string) {
  const ids = selection.map(test => test.id);
  if (!ids.length || ids.length > 500 || new Set(ids).size !== ids.length) throw new HttpError(422, '请选择 1～500 组不同的测试数据');
  const tests = await tx.testCase.findMany({ where: { problemId, deletedAt: null, id: { in: ids } }, select: { id: true, number: true, version: true } });
  const versions = new Map(tests.map(test => [test.id, test.version]));
  if (tests.length !== ids.length || selection.some(test => versions.get(test.id) !== test.expectedVersion)) {
    throw new HttpError(409, '所选数据已更新、已删除或不属于本题；本次未删除任何数据，请刷新列表后重新选择', 'VERSION_CONFLICT');
  }
  const changed = await tx.testCase.updateMany({
    where: { problemId, deletedAt: null, OR: selection.map(test => ({ id: test.id, version: test.expectedVersion })) },
    data: { deletedAt: new Date(), version: { increment: 1 } },
  });
  if (changed.count !== ids.length) throw new HttpError(409, '测试数据版本冲突，本次未删除任何数据', 'VERSION_CONFLICT');
  const config = await tx.testGroupConfig.findUnique({ where: { problemId } });
  const affectedGroups = ((config?.data as TestGroupsValue | undefined)?.groups ?? []).filter(group => group.members.some(member => ids.includes(member.testId))).map(group => group.id);
  await tx.problem.update({ where: { id: problemId }, data: { updatedAt: new Date() } });
  await tx.auditLog.create({ data: { actorId, action: 'DELETE_TESTS', resourceId: problemId, detail: { tests, affectedGroups } } });
  return { deletedIds: ids, affectedGroups };
}
