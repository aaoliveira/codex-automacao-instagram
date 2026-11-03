import { UnauthorizedException } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    refreshToken: { create: jest.fn() },
  };
  const passwords = { verify: jest.fn() };
  const jwt = { signAsync: jest.fn() };
  const config = { get: jest.fn((_key: string, defaultValue: unknown) => defaultValue) };
  const service = new AuthService(prisma as never, passwords as never, jwt as never, config as never);

  beforeEach(() => jest.clearAllMocks());

  it('authenticates against a selected organization and stores only a refresh token hash', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-id',
      email: 'owner@example.com',
      passwordHash: '$argon2id$hash',
      memberships: [
        {
          organizationId: 'organization-id',
          role: MembershipRole.OWNER,
          organization: { id: 'organization-id', name: 'Workspace', slug: 'workspace' },
        },
      ],
    });
    passwords.verify.mockResolvedValue(true);
    jwt.signAsync.mockResolvedValue('signed-access-token');
    prisma.refreshToken.create.mockResolvedValue({ id: 'refresh-id' });

    const result = await service.login({ email: 'owner@example.com', password: 'strong-password' });

    expect(result.accessToken).toBe('signed-access-token');
    expect(result.role).toBe(MembershipRole.OWNER);
    expect(result.refreshToken).toHaveLength(43);
    const storedRefreshToken = prisma.refreshToken.create.mock.calls[0][0].data.tokenHash;
    expect(storedRefreshToken).toMatch(/^[a-f0-9]{64}$/);
    expect(storedRefreshToken).not.toBe(result.refreshToken);
  });

  it('returns the same generic error for invalid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'unknown@example.com', password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(passwords.verify).not.toHaveBeenCalled();
  });
});
