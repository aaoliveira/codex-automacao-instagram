import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MembershipRole, Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
}

@Injectable()
export class AuthService {
  private readonly refreshTtlDays: number;
  private readonly accessTtl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    config: ConfigService,
  ) {
    this.refreshTtlDays = Number(config.get('REFRESH_TOKEN_TTL_DAYS', 30));
    this.accessTtl = config.get<string>('JWT_ACCESS_TTL', '15m');
  }

  async register(dto: RegisterDto) {
    const passwordHash = await this.passwordService.hash(dto.password);
    const organizationId = randomUUID();
    const slugBase = slugify(dto.organizationName).slice(0, 120) || 'workspace';
    const slug = `${slugBase}-${organizationId.slice(0, 8)}`;

    let account: { id: string; email: string; organizationId: string; role: MembershipRole };
    try {
      account = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { email: dto.email, passwordHash },
        });
        const organization = await transaction.organization.create({
          data: { id: organizationId, name: dto.organizationName.trim(), slug },
        });
        const membership = await transaction.membership.create({
          data: { userId: user.id, organizationId: organization.id, role: MembershipRole.OWNER },
        });
        return {
          id: user.id,
          email: user.email,
          organizationId: organization.id,
          role: membership.role,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }

    return this.createSession(account);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { memberships: { include: { organization: true } } },
    });
    if (!user || !(await this.passwordService.verify(user.passwordHash, dto.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const memberships = user.memberships;
    const membership = dto.organizationId
      ? memberships.find((entry) => entry.organizationId === dto.organizationId)
      : memberships.length === 1
        ? memberships[0]
        : undefined;
    if (!membership) throw new UnauthorizedException('Invalid email, password or organization');

    return this.createSession({
      id: user.id,
      email: user.email,
      organizationId: membership.organizationId,
      role: membership.role,
    });
  }

  async refresh(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    const now = new Date();
    const replacement = makeRefreshToken();

    const rotated = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.refreshToken.findUnique({ where: { tokenHash } });
      if (!current || current.revokedAt || current.expiresAt <= now) return null;

      const membership = await transaction.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: current.userId,
            organizationId: current.organizationId,
          },
        },
        include: { user: { select: { email: true } } },
      });
      if (!membership) return null;

      const revoked = await transaction.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) return null;

      const newToken = await transaction.refreshToken.create({
        data: {
          tokenHash: hashToken(replacement.token),
          userId: current.userId,
          organizationId: current.organizationId,
          expiresAt: this.refreshExpiresAt(),
        },
      });
      await transaction.refreshToken.update({
        where: { id: current.id },
        data: { replacedByTokenId: newToken.id },
      });

      return {
        account: {
          id: current.userId,
          email: membership.user.email,
          organizationId: current.organizationId,
          role: membership.role,
        },
      };
    });

    if (!rotated) throw new UnauthorizedException('Invalid or expired refresh token');
    const accessToken = await this.signAccessToken(rotated.account);
    return this.tokenResponse(accessToken, replacement.token);
  }

  async logout(userId: string, refreshToken: string): Promise<{ success: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  async me(userId: string, organizationId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        createdAt: true,
        memberships: {
          where: { organizationId },
          select: {
            role: true,
            organization: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    if (!user || user.memberships.length === 0) throw new UnauthorizedException();
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
      membership: user.memberships[0],
    };
  }

  private async createSession(account: {
    id: string;
    email: string;
    organizationId: string;
    role: MembershipRole;
  }) {
    const refresh = makeRefreshToken();
    const accessToken = await this.signAccessToken(account);
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refresh.token),
        userId: account.id,
        organizationId: account.organizationId,
        expiresAt: this.refreshExpiresAt(),
      },
    });
    return {
      ...this.tokenResponse(accessToken, refresh.token),
      user: { id: account.id, email: account.email },
      organizationId: account.organizationId,
      role: account.role,
    };
  }

  private signAccessToken(account: {
    id: string;
    email: string;
    organizationId: string;
    role: MembershipRole;
  }): Promise<string> {
    return this.jwtService.signAsync({
      sub: account.id,
      email: account.email,
      organizationId: account.organizationId,
      role: account.role,
    });
  }

  private tokenResponse(accessToken: string, refreshToken: string): TokenPair {
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTtl,
    };
  }

  private refreshExpiresAt(): Date {
    return new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }
}

function makeRefreshToken(): { token: string } {
  return { token: randomBytes(32).toString('base64url') };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
