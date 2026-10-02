import 'dotenv/config';
import { db } from '@problemforge/database';
// This is an explicit local-operator binding, never an email-based login shortcut.
const args = process.argv.slice(2);
const option = (key: string) => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : undefined; };
const email = option('--email')?.trim().toLowerCase(), associationUserId = option('--user-id');
if (!email || !associationUserId || !/^[1-9]\d{0,18}$/.test(associationUserId) || BigInt(associationUserId) > 9223372036854775807n) throw new Error('用法：pnpm user:link --email 原本地账号邮箱 --user-id 经核对的协会userId（不是学号或账号名）。保留原用户权限，撤销旧会话。');
try {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(70406100)::text`;
    const user = await tx.user.findUnique({ where: { email } });
    if (!user) throw new Error('本地用户不存在；此命令不创建账号。');
    if (user.associationUserId && user.associationUserId !== associationUserId) throw new Error('本地用户已绑定其他协会身份，拒绝覆盖。');
    const existing = await tx.user.findUnique({ where: { associationUserId } });
    if (existing && existing.id !== user.id) throw new Error('协会身份已关联其他本地用户，拒绝合并或覆盖权限。');
    if (existing) return;
    await tx.user.update({ where: { id: user.id }, data: { associationUserId, passwordHash: 'external', passwordResetRequired: false, version: { increment: 1 } } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.passwordReset.deleteMany({ where: { userId: user.id } });
    await tx.auditLog.create({ data: { actorId: null, action: 'LINK_ASSOCIATION_USER', resourceId: user.id, detail: { associationUserId } } });
  });
  console.log('协会身份已绑定，原用户 ID、角色、题目和成员权限保留。请使用协会官网密码登录。');
} finally { await db.$disconnect(); }
