import { config, HttpError } from '@problemforge/domain';
import type { Prisma } from '@problemforge/database';

const loginUrl = 'https://www.cwnupaa.com/api/user/external/login';
export type AssociationUser = { userId: string; userAccount: string; name: string; email: string };
const unavailable = () => new HttpError(503, '协会登录服务暂时不可用，请稍后重试', 'ASSOCIATION_UNAVAILABLE');
const malformed = () => new HttpError(502, '协会登录服务返回的用户信息不完整，请联系管理员', 'ASSOCIATION_RESPONSE_INVALID');
export const associationConfigured = () => !!config.associationAppKey && config.associationAppKey !== 'CHANGE_ME';

export function parseAssociationResponse(text: string): AssociationUser {
  let result: any;
  try {
    // Node >=22.12 provides the original number token; Java Long IDs must not
    // be rounded through a JavaScript Number (which could identify another user).
    result = JSON.parse(text, (key: string, value: unknown, context?: {source?: string}) => {
      if (key === 'userId' && typeof value === 'number') return context?.source ?? (Number.isSafeInteger(value) ? String(value) : null);
      return value;
    });
  } catch { throw malformed(); }
  if (!result || typeof result !== 'object' || !Number.isInteger(result.code)) throw malformed();
  if (result.code !== 200) {
    const message = typeof result.msg === 'string' ? result.msg : '';
    if (/app\s*key/i.test(message)) throw new HttpError(503, '协会登录配置无效或已停用，请联系管理员', 'ASSOCIATION_CONFIG_INVALID');
    if (/学号登录已禁用/.test(message)) throw new HttpError(401, '学号登录已禁用，请使用协会账号或邮箱登录', 'LOGIN_FAILED');
    // Do not echo arbitrary provider messages, which may contain submitted secrets.
    throw new HttpError(401, '协会账号或密码错误，或账号不可用', 'LOGIN_FAILED');
  }
  const u = result.data;
  if (!u || typeof u.userId !== 'string' || !/^[1-9]\d{0,18}$/.test(u.userId) || BigInt(u.userId) > 9223372036854775807n ||
      typeof u.userAccount !== 'string' || !u.userAccount.trim() || u.userAccount.length > 254 ||
      typeof u.email !== 'string' || u.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u.email.trim())) throw malformed();
  const userAccount = u.userAccount.trim();
  return { userId: u.userId, userAccount, name: (typeof u.userName === 'string' && u.userName.trim() ? u.userName.trim() : userAccount).slice(0, 80), email: u.email.trim().toLowerCase() };
}

export async function associationLogin(account: string, password: string): Promise<AssociationUser> {
  if (!associationConfigured()) throw new HttpError(503, '协会登录尚未配置，请联系管理员填写 APPKEY', 'ASSOCIATION_NOT_CONFIGURED');
  let text: string;
  try {
    const response = await fetch(loginUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ appKey: config.associationAppKey, loginType: 'password', account: account.trim(), credential: password }),
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) { await response.body?.cancel(); throw unavailable(); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const {done, value} = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 32768) throw malformed(); chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    text = Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw unavailable();
  }
  return parseAssociationResponse(text);
}

// Caller holds the account transaction lock through identity sync and session issuance.
export async function syncAssociationUser(tx: Prisma.TransactionClient, info: AssociationUser) {
  const current = await tx.user.findUnique({ where: { associationUserId: info.userId } });
  if (current?.disabled) throw new HttpError(403, '此账号已在出题工作台停用，请联系管理员', 'ACCOUNT_DISABLED');
  const collision = await tx.user.findUnique({ where: { email: info.email } });
  if (collision && collision.id !== current?.id) throw new HttpError(409, '此邮箱已有本地账号，请联系管理员绑定协会用户 ID 后再登录', 'ACCOUNT_LINK_REQUIRED');
  const profile = { email: info.email, name: info.name, associationAccount: info.userAccount };
  if (!current) {
    const created = await tx.user.create({ data: { ...profile, associationUserId: info.userId, passwordHash: 'external', role: 'USER' } });
    await tx.auditLog.create({ data: { actorId: created.id, action: 'CREATE_ASSOCIATION_USER', resourceId: created.id } });
    return created;
  }
  const changed = current.email !== profile.email || current.name !== profile.name || current.associationAccount !== profile.associationAccount || current.passwordResetRequired;
  if (!changed) return current;
  if (current.email !== profile.email) await tx.session.deleteMany({ where: { userId: current.id } });
  await tx.passwordReset.deleteMany({ where: { userId: current.id } });
  const updated = await tx.user.update({ where: { id: current.id }, data: { ...profile, passwordResetRequired: false, version: { increment: 1 } } });
  await tx.auditLog.create({ data: { actorId: current.id, action: 'SYNC_ASSOCIATION_USER', resourceId: current.id } });
  return updated;
}
