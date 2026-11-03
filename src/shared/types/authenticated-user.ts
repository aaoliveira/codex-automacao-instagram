import { MembershipRole } from '@prisma/client';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  organizationId: string;
  role: MembershipRole;
}
