import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
dotenv();
const { db } = await import('@problemforge/database');
const { hashPassword, root } = await import('@problemforge/domain');
const args = process.argv.slice(2);
const option = (key: string) => { const index = args.indexOf(key); return index >= 0 ? args[index + 1] : undefined; };
const email = option('--email') ?? process.env.PF_ADMIN_EMAIL;
const generated = args.includes('--generate-password');
const password = generated ? randomBytes(24).toString('base64url') : process.env.PF_ADMIN_PASSWORD;
if (!email || !password || password.length < 12) throw new Error('用法：pnpm admin:init --email admin@example.org --generate-password，或设置 PF_ADMIN_EMAIL / PF_ADMIN_PASSWORD（至少 12 字符）。');
try {
  if (await db.user.findUnique({ where: { email: email.toLowerCase() } })) throw new Error('用户已存在，不覆盖密码或角色');
  const user = await db.user.create({ data: { email: email.toLowerCase(), name: option('--name') ?? '系统管理员', role: 'ADMIN', passwordHash: await hashPassword(password) } });
  await db.auditLog.create({ data: { actorId: user.id, action: 'BOOTSTRAP_ADMIN', resourceId: user.id } });
  if (generated) {
    await mkdir(resolve(root, '.local'), { recursive: true });
    await writeFile(resolve(root, '.local/bootstrap-admin.txt'), `ProblemForge 本地管理员\n邮箱：${email}\n密码：${password}\n入口：http://localhost:5180\n请妥善保管，本文件被 Git 忽略。\n`, { mode: 0o600, flag: 'wx' });
    console.log('管理员已创建，随机凭据保存于 .local/bootstrap-admin.txt（不输出到日志）。');
  } else console.log(`管理员已创建：${user.email}`);
} finally { await db.$disconnect(); }
