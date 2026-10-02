import { config as dotenv } from 'dotenv';
dotenv();
const { db } = await import('@problemforge/database');
const { hashPassword } = await import('@problemforge/domain');
const args = process.argv.slice(2);
const option = (key: string) => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : undefined; };
const email = (option('--email') ?? process.env.PF_ADMIN_EMAIL)?.trim().toLowerCase();
const password = process.env.PF_ADMIN_PASSWORD;
if (args.includes('--user-id')) throw new Error('超级管理员使用独立本地密码，不接受协会 userId。');
if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12 || password.length > 256 || !password.trim()) throw new Error('用法：设置 PF_ADMIN_PASSWORD（12—256 字符），再执行 pnpm admin:init --email 管理员邮箱；也可设置 PF_ADMIN_EMAIL。已有账号不会被覆盖。');
try {
  const passwordHash = await hashPassword(password);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(70406100)::text`;
    if (await tx.user.findUnique({ where: { email } })) throw new Error('账号已存在，不覆盖角色、身份或密码；原独立管理员直接使用本地密码登录。');
    const user = await tx.user.create({ data: { email, name: option('--name') ?? '超级管理员', role: 'ADMIN', passwordHash } });
    await tx.auditLog.create({ data: { actorId: user.id, action: 'BOOTSTRAP_ADMIN', resourceId: user.id } });
  });
  console.log('独立超级管理员已初始化；请在「超级管理员登录」使用本地邮箱和密码，无需 APPKEY 或协会 userId。');
} finally { await db.$disconnect(); }
