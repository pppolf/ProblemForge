import { db } from '@problemforge/database';
import { hashPassword, isLocalAdministrator } from '@problemforge/domain';

try {
  const command = process.argv[2];
  if (command === 'idle') {
    const where = { state: { in: ['QUEUED', 'RUNNING'] as ('QUEUED' | 'RUNNING')[] } };
    const active = await db.build.count({ where }) + await db.testRun.count({ where });
    const pending = await db.storedObject.count({ where: { ready: false } });
    if (active || pending) throw new Error(`仍有 ${active} 个排队/执行任务、${pending} 个存储预留，请待任务结束后重试维护`);
    console.log('idle');
  } else if (command === 'bootstrap') {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(70406100)::text`;
      const admins = await tx.user.findMany({ where: { role: 'ADMIN', disabled: false, passwordResetRequired: false } });
      if (admins.some(isLocalAdministrator)) { console.log('已有独立管理员，保留原账号与密码。'); return; }
      if (await tx.user.count()) throw new Error('数据库已有用户但无可登录独立管理员，不自动接管，请先恢复管理员');
      const email = process.env.PF_ADMIN_EMAIL, password = process.env.PF_ADMIN_PASSWORD;
      if (!email || !password || password.length < 12) throw new Error('首次管理员初始化配置缺失');
      const user = await tx.user.create({ data: { email, name: '超级管理员', role: 'ADMIN', passwordHash: await hashPassword(password) } });
      await tx.auditLog.create({ data: { actorId: user.id, action: 'BOOTSTRAP_ADMIN', resourceId: user.id } });
      console.log('独立管理员已初始化，凭据保存在服务器私有 bootstrap-admin.txt。');
    });
  } else throw new Error('需要 idle 或 bootstrap');
} finally { await db.$disconnect(); }
