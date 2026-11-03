import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true, createdAt: true },
    });
    if (!organization) throw new NotFoundException('Organization not found');
    return organization;
  }

  listMembers(organizationId: string) {
    return this.prisma.membership.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, email: true } },
      },
    });
  }

  async addMember(organizationId: string, email: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) throw new NotFoundException('Registered user not found');

    try {
      return await this.prisma.membership.create({
        data: { organizationId, userId: user.id, role: MembershipRole.MEMBER },
        select: {
          id: true,
          organizationId: true,
          role: true,
          user: { select: { id: true, email: true } },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User already belongs to this organization');
      }
      throw error;
    }
  }

  async updateMemberRole(organizationId: string, membershipId: string, role: MembershipRole) {
    return this.prisma.$transaction(async (transaction) => {
      const membership = await transaction.membership.findFirst({
        where: { id: membershipId, organizationId },
        select: { id: true, role: true },
      });
      if (!membership) throw new NotFoundException('Membership not found');

      if (membership.role === MembershipRole.OWNER && role !== MembershipRole.OWNER) {
        const ownerCount = await transaction.membership.count({
          where: { organizationId, role: MembershipRole.OWNER },
        });
        if (ownerCount <= 1) {
          throw new BadRequestException('An organization must have at least one owner');
        }
      }

      return transaction.membership.update({
        where: { id: membership.id },
        data: { role },
        select: { id: true, userId: true, organizationId: true, role: true },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
