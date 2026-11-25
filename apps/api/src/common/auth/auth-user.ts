import { UserRole } from '@prisma/client';

/** Usuário autenticado extraído do JWT de acesso. */
export interface AuthUser {
  id: string;
  role: UserRole;
}

export const PRIVILEGED_ROLES: readonly UserRole[] = ['MODERATOR', 'ADMIN'];

export function isPrivileged(user: AuthUser | undefined): boolean {
  return !!user && PRIVILEGED_ROLES.includes(user.role);
}
