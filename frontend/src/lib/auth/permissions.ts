import type { MembershipRole } from '@/lib/api/types';

export function canManageTeam(role: MembershipRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export function roleLabel(role: MembershipRole): string {
  switch (role) {
    case 'OWNER':
      return 'Owner';
    case 'ADMIN':
      return 'Admin';
    case 'MEMBER':
      return 'Member';
  }
}
