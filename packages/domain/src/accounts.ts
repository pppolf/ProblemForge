import type { User } from '@problemforge/database';

// Local credentials are reserved for unbound system administrators. Association
// users (including those granted ADMIN) never fall back to a local password.
export function isLocalAdministrator(user: Pick<User, 'role' | 'associationUserId' | 'passwordHash'>) {
  return user.role === 'ADMIN' && user.associationUserId === null &&
    /^scrypt:32768:8:1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.passwordHash);
}

export function assertAssociationLinkable(user: Pick<User, 'role' | 'associationUserId'>) {
  if (user.role === 'ADMIN' && user.associationUserId === null) throw new Error('独立超级管理员使用本地密码，不绑定协会身份。');
}
