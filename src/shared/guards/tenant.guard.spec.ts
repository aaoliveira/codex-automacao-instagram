import { NotFoundException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { TenantGuard } from './tenant.guard';

interface TestRequest {
  params: { organizationId: string };
  user: { sub: string; email: string; organizationId: string; role?: MembershipRole };
}

describe('TenantGuard', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
  const prisma = { membership: { findUnique: jest.fn() } };
  const guard = new TenantGuard(reflector as never, prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an organization ID from a different tenant', async () => {
    const request: TestRequest = {
      params: { organizationId: 'tenant-b' },
      user: { sub: 'user-a', email: 'a@example.com', organizationId: 'tenant-a' },
    };
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await expect(guard.canActivate(context as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.membership.findUnique).not.toHaveBeenCalled();
  });

  it('loads the current role from the matching organization membership', async () => {
    prisma.membership.findUnique.mockResolvedValue({ role: MembershipRole.ADMIN });
    const request: TestRequest = {
      params: { organizationId: 'tenant-a' },
      user: { sub: 'user-a', email: 'a@example.com', organizationId: 'tenant-a' },
    };
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(request.user.role).toBe(MembershipRole.ADMIN);
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({
      where: { userId_organizationId: { userId: 'user-a', organizationId: 'tenant-a' } },
      select: { role: true },
    });
  });
});
