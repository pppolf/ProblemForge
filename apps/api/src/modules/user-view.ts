import type { User } from '@problemforge/database';
import type { AuthenticatedUser, ManagedUser } from '@problemforge/contracts';
import { isLocalAdministrator } from '@problemforge/domain';

export const publicUser = (u: User): AuthenticatedUser => ({
  id: u.id, email: u.email, name: u.name, role: u.role,
  authProvider: isLocalAdministrator(u) ? 'local-admin' : 'association',
});
export const managedUser = (u: User): ManagedUser => ({
  id: u.id, email: u.email, name: u.name, role: u.role, disabled: u.disabled, version: u.version,
  associationUserId: u.associationUserId, associationAccount: u.associationAccount, localAdmin: isLocalAdministrator(u),
});
