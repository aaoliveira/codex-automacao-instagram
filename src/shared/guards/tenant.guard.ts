import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../types/authenticated-user';

type TenantRequest = Request & { user?: AuthenticatedUser };

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<TenantRequest>();
    const user = request.user;
    if (!user) return true;

    const routeOrganizationId = request.params.organizationId;
    if (routeOrganizationId && routeOrganizationId !== user.organizationId) {
      throw new NotFoundException('Organization not found');
    }

    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.sub, organizationId: user.organizationId } },
      select: { role: true },
    });
    if (!membership) throw new NotFoundException('Organization not found');

    user.role = membership.role;
    return true;
  }
}
