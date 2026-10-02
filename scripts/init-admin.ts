import { config as dotenv } from 'dotenv';
dotenv();
const { db } = await import('@problemforge/database');
const args = process.argv.slice(2);
const option = (key: string) => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : undefined; };
const email = (option('--email') ?? process.env.PF_ADMIN_EMAIL)?.trim().toLowerCase();
const associationUserId = option('--user-id') ?? process.env.PF_ADMIN_EXTERNAL_USER_ID;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !associationUserId || !/^[1-9]\d{0,18}$/.test(associationUserId) || BigInt(associationUserId) > 9223372036854775807n) throw new Error('用法：pnpm admin:init --email 协会邮箱 --user-id 协会userId；已有本地账号请用 pnpm user:link 绑定。');
try {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(70406100)::text`;
    if (await tx.user.findFirst({ where: { OR: [{ email }, { associationUserId }] } })) throw new Error('账号或协会用户 ID 已存在，不覆盖角色或身份；原本地账号使用 user:link。');
    const user = await tx.user.create({ data: { email, associationUserId, name: option('--name') ?? '系统管理员', role: 'ADMIN', passwordHash: 'external' } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'BOOTSTRAP_ADMIN', resourceId: user.id } });
  });
  console.log('协会管理员已初始化；请用协会账号或邮箱与官网密码登录。');
} finally { await db.$disconnect(); }
