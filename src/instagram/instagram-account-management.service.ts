import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  InstagramAccountAccessLevel,
  InstagramAccountStatus,
  MembershipRole,
  Prisma,
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import { InstagramAccountsQueryDto } from "./dto/instagram-accounts-query.dto";
import { InstagramAccountsService } from "./instagram-accounts.service";

@Injectable()
export class InstagramAccountManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly instagramAccounts: InstagramAccountsService,
  ) {}

  async listAccounts(
    organizationId: string,
    user: AuthenticatedUser,
    query: InstagramAccountsQueryDto = {},
  ) {
    const membership = await this.membership(organizationId, user);
    const where = this.accountWhere(organizationId, membership, user, query);
    const hasFilters = Object.values(query).some(
      (value) => value !== undefined,
    );
    const orderField = query.sortBy ?? "createdAt";
    const order = query.sortOrder ?? "desc";
    const orderBy = [
      { [orderField]: order },
      { id: "asc" },
    ] as Prisma.InstagramAccountOrderByWithRelationInput[];
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    if (!hasFilters) {
      const accounts = await this.prisma.instagramAccount.findMany({
        where,
        orderBy,
      });
      return accounts.map((account) => this.publicAccount(account));
    }
    const [total, accounts] = await this.prisma.$transaction([
      this.prisma.instagramAccount.count({ where }),
      this.prisma.instagramAccount.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: accounts.map((account) => this.publicAccount(account)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async summary(organizationId: string, user: AuthenticatedUser) {
    const membership = await this.membership(organizationId, user);
    const where = this.accountWhere(organizationId, membership, user);
    const [total, statusGroups, providerGroups, groups, settings] =
      await Promise.all([
        this.prisma.instagramAccount.count({ where }),
        this.prisma.instagramAccount.groupBy({
          by: ["status"],
          where,
          _count: { id: true },
        }),
        this.prisma.instagramAccount.groupBy({
          by: ["provider"],
          where,
          _count: { id: true },
        }),
        this.listGroups(organizationId, user),
        this.ensureSettings(organizationId),
      ]);
    const byStatus = Object.fromEntries(
      Object.values(InstagramAccountStatus).map((status) => [status, 0]),
    );
    const byProvider = { MOCK: 0, META: 0 };
    for (const group of statusGroups) byStatus[group.status] = group._count.id;
    for (const group of providerGroups)
      byProvider[group.provider] = group._count.id;
    return {
      total,
      byStatus,
      byProvider,
      groups: groups.map(({ id, name, accountCount }) => ({
        id,
        name,
        accountCount,
      })),
      limits: {
        maxActiveAccounts: settings.maxActiveAccounts,
        maxGroups: settings.maxGroups,
      },
    };
  }

  async getAccount(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
  ) {
    await this.requireAccount(organizationId, accountId, user, "VIEW");
    const account = await this.prisma.instagramAccount.findFirstOrThrow({
      where: { organizationId, id: accountId },
    });
    return this.publicAccount(account);
  }

  async accessibleAccountsWhere(
    organizationId: string,
    user: AuthenticatedUser,
  ): Promise<Prisma.InstagramAccountWhereInput> {
    const membership = await this.membership(organizationId, user);
    return this.accountWhere(organizationId, membership, user);
  }

  async assertAccountReadable(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.requireAccount(organizationId, accountId, user, "VIEW");
  }

  async assertAccountManageable(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    await this.requireAccount(organizationId, accountId, user, "MANAGE");
  }

  async listGroups(organizationId: string, user: AuthenticatedUser) {
    const membership = await this.membership(organizationId, user);
    const groups = await this.prisma.instagramAccountGroup.findMany({
      where: { organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { accounts: true } },
        ...(membership.role === MembershipRole.MEMBER
          ? {
              accounts: {
                where: {
                  accessGrants: {
                    some: {
                      organizationId,
                      membershipId: membership.id,
                      level: {
                        in: [
                          InstagramAccountAccessLevel.VIEW,
                          InstagramAccountAccessLevel.MANAGE,
                        ],
                      },
                    },
                  },
                },
                select: { id: true },
              },
            }
          : {}),
      },
    });
    return groups
      .filter(
        (group) =>
          membership.role !== MembershipRole.MEMBER ||
          group.accounts.length > 0,
      )
      .map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        sortOrder: group.sortOrder,
        accountCount:
          membership.role === MembershipRole.MEMBER
            ? group.accounts.length
            : group._count.accounts,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      }));
  }

  async createGroup(
    organizationId: string,
    user: AuthenticatedUser,
    input: { name: string; description?: string | null },
  ) {
    const membership = await this.requireAdmin(organizationId, user);
    let group;
    try {
      group = await this.prisma.$transaction(async (tx) => {
        const settings = await this.lockSettings(tx, organizationId);
        const count = await tx.instagramAccountGroup.count({
          where: { organizationId },
        });
        if (count >= settings.maxGroups)
          throw new ConflictException(
            "Organization account group limit reached",
          );
        const lastOrder = await tx.instagramAccountGroup.aggregate({
          where: { organizationId },
          _max: { sortOrder: true },
        });
        return tx.instagramAccountGroup.create({
          data: {
            organizationId,
            name: input.name.trim(),
            description: normalizeNullable(input.description),
            sortOrder: (lastOrder._max.sortOrder ?? -1) + 1,
          },
        });
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          "An account group with this name already exists",
        );
      throw error;
    }
    await this.audit.record({
      organizationId,
      userId: membership.userId,
      action: "instagram.account_group.created",
      resourceType: "instagram_account_group",
      resourceId: group.id,
    });
    return group;
  }

  async updateGroup(
    organizationId: string,
    groupId: string,
    user: AuthenticatedUser,
    input: { name?: string; description?: string | null; sortOrder?: number },
  ) {
    const membership = await this.requireAdmin(organizationId, user);
    await this.findGroup(organizationId, groupId);
    try {
      const group = await this.prisma.instagramAccountGroup.update({
        where: { organizationId_id: { organizationId, id: groupId } },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(Object.prototype.hasOwnProperty.call(input, "description")
            ? { description: normalizeNullable(input.description) }
            : {}),
          ...(input.sortOrder !== undefined
            ? { sortOrder: input.sortOrder }
            : {}),
        },
      });
      await this.audit.record({
        organizationId,
        userId: membership.userId,
        action: "instagram.account_group.updated",
        resourceType: "instagram_account_group",
        resourceId: group.id,
      });
      return group;
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException(
          "An account group with this name already exists",
        );
      throw error;
    }
  }

  async deleteGroup(
    organizationId: string,
    groupId: string,
    user: AuthenticatedUser,
  ) {
    const membership = await this.requireAdmin(organizationId, user);
    await this.prisma.$transaction(async (tx) => {
      await this.findGroup(organizationId, groupId, tx);
      await tx.instagramAccount.updateMany({
        where: { organizationId, groupId },
        data: { groupId: null },
      });
      await tx.instagramAccountGroup.delete({
        where: { organizationId_id: { organizationId, id: groupId } },
      });
    });
    await this.audit.record({
      organizationId,
      userId: membership.userId,
      action: "instagram.account_group.deleted",
      resourceType: "instagram_account_group",
      resourceId: groupId,
    });
    return { success: true };
  }

  async orderGroups(
    organizationId: string,
    user: AuthenticatedUser,
    groupIds: string[],
  ) {
    const membership = await this.requireAdmin(organizationId, user);
    await this.prisma.$transaction(async (tx) => {
      const groups = await tx.instagramAccountGroup.findMany({
        where: { organizationId },
        select: { id: true },
      });
      if (
        groups.length !== groupIds.length ||
        groups.some((group) => !groupIds.includes(group.id))
      ) {
        throw new BadRequestException(
          "groupIds must contain every organization group exactly once",
        );
      }
      for (const [sortOrder, id] of groupIds.entries()) {
        await tx.instagramAccountGroup.update({
          where: { organizationId_id: { organizationId, id } },
          data: { sortOrder },
        });
      }
    });
    await this.audit.record({
      organizationId,
      userId: membership.userId,
      action: "instagram.account_group.reordered",
      resourceType: "instagram_account_group",
      metadata: { requestedCount: groupIds.length },
    });
    return this.listGroups(organizationId, user);
  }

  async updateAccountMetadata(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
    input: { internalAlias?: string | null; tags?: string[] },
  ) {
    const membership = await this.requireAccount(
      organizationId,
      accountId,
      user,
      "MANAGE",
    );
    const updated = await this.prisma.instagramAccount.update({
      where: { organizationId_id: { organizationId, id: accountId } },
      data: {
        ...(Object.prototype.hasOwnProperty.call(input, "internalAlias")
          ? { internalAlias: normalizeNullable(input.internalAlias) }
          : {}),
        ...(input.tags !== undefined
          ? { tags: normalizeTags(input.tags) }
          : {}),
      },
    });
    await this.audit.record({
      organizationId,
      userId: membership.userId,
      action: "instagram.account.metadata_updated",
      resourceType: "instagram_account",
      resourceId: accountId,
    });
    return this.publicAccount(updated);
  }

  async moveAccount(
    organizationId: string,
    accountId: string,
    groupId: string | null,
    user: AuthenticatedUser,
  ) {
    const membership = await this.requireAccount(
      organizationId,
      accountId,
      user,
      "MANAGE",
    );
    if (groupId) await this.findGroup(organizationId, groupId);
    const account = await this.prisma.instagramAccount.update({
      where: { organizationId_id: { organizationId, id: accountId } },
      data: { groupId },
    });
    await this.audit.record({
      organizationId,
      userId: membership.userId,
      action: "instagram.account.group_changed",
      resourceType: "instagram_account",
      resourceId: accountId,
    });
    return this.publicAccount(account);
  }

  async bulkMove(
    organizationId: string,
    user: AuthenticatedUser,
    accountIds: string[],
    groupId: string | null,
  ) {
    if (groupId) await this.findGroup(organizationId, groupId);
    const items = await this.runPartial(accountIds, async (accountId) => {
      const membership = await this.requireAccount(
        organizationId,
        accountId,
        user,
        "MANAGE",
      );
      await this.prisma.instagramAccount.update({
        where: { organizationId_id: { organizationId, id: accountId } },
        data: { groupId },
      });
      await this.audit.record({
        organizationId,
        userId: membership.userId,
        action: "instagram.account.group_changed",
        resourceType: "instagram_account",
        resourceId: accountId,
      });
      return { accountId, outcome: "SUCCESS" as const };
    });
    await this.auditBatch(
      organizationId,
      user,
      "instagram.accounts.bulk_move",
      items,
    );
    return { items };
  }

  async bulkTags(
    organizationId: string,
    user: AuthenticatedUser,
    accountIds: string[],
    tags: string[],
  ) {
    const normalized = normalizeTags(tags);
    const items = await this.runPartial(accountIds, async (accountId) => {
      const membership = await this.requireAccount(
        organizationId,
        accountId,
        user,
        "MANAGE",
      );
      await this.prisma.instagramAccount.update({
        where: { organizationId_id: { organizationId, id: accountId } },
        data: { tags: normalized },
      });
      await this.audit.record({
        organizationId,
        userId: membership.userId,
        action: "instagram.account.tags_updated",
        resourceType: "instagram_account",
        resourceId: accountId,
      });
      return { accountId, outcome: "SUCCESS" as const };
    });
    await this.auditBatch(
      organizationId,
      user,
      "instagram.accounts.bulk_tags",
      items,
    );
    return { items };
  }

  async bulkSync(
    organizationId: string,
    user: AuthenticatedUser,
    accountIds: string[],
  ) {
    const items = await this.runPartial(accountIds, async (accountId) => {
      const membership = await this.requireAccount(
        organizationId,
        accountId,
        user,
        "MANAGE",
      );
      await this.instagramAccounts.syncAccount(organizationId, accountId);
      await this.audit.record({
        organizationId,
        userId: membership.userId,
        action: "instagram.account.synchronized",
        resourceType: "instagram_account",
        resourceId: accountId,
      });
      return { accountId, outcome: "SUCCESS" as const };
    });
    await this.auditBatch(
      organizationId,
      user,
      "instagram.accounts.bulk_sync",
      items,
    );
    return { items };
  }

  async getPreferences(organizationId: string, user: AuthenticatedUser) {
    const membership = await this.membership(organizationId, user);
    const rows = await this.prisma.instagramAccountPreference.findMany({
      where: {
        organizationId,
        userId: membership.userId,
        OR: [{ favorite: true }, { isDefault: true }],
        account: this.accountWhere(organizationId, membership, user),
      },
      include: { account: true },
      orderBy: [
        { isDefault: "desc" },
        { favorite: "desc" },
        { updatedAt: "desc" },
      ],
    });
    return rows.map((row) => ({
      accountId: row.instagramAccountId,
      favorite: row.favorite,
      isDefault: row.isDefault,
      account: this.publicAccount(row.account),
    }));
  }

  async setFavorite(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
    favorite: boolean,
  ) {
    const membership = await this.requireAccount(
      organizationId,
      accountId,
      user,
      "VIEW",
    );
    const preference = await this.prisma.instagramAccountPreference.upsert({
      where: {
        organizationId_userId_instagramAccountId: {
          organizationId,
          userId: membership.userId,
          instagramAccountId: accountId,
        },
      },
      create: {
        organizationId,
        userId: membership.userId,
        instagramAccountId: accountId,
        favorite,
      },
      update: { favorite },
    });
    await this.audit.record({
      organizationId,
      userId: membership.userId,
      action: favorite
        ? "instagram.account.favorite_set"
        : "instagram.account.favorite_cleared",
      resourceType: "instagram_account",
      resourceId: accountId,
    });
    return { accountId, favorite: preference.favorite };
  }

  async setDefault(
    organizationId: string,
    accountId: string | null,
    user: AuthenticatedUser,
  ) {
    const membership = await this.membership(organizationId, user);
    if (accountId)
      await this.requireAccount(organizationId, accountId, user, "VIEW");
    await this.prisma.$transaction(
      async (tx) => {
        await tx.instagramAccountPreference.updateMany({
          where: { organizationId, userId: membership.userId, isDefault: true },
          data: { isDefault: false },
        });
        if (accountId) {
          await tx.instagramAccountPreference.upsert({
            where: {
              organizationId_userId_instagramAccountId: {
                organizationId,
                userId: membership.userId,
                instagramAccountId: accountId,
              },
            },
            create: {
              organizationId,
              userId: membership.userId,
              instagramAccountId: accountId,
              isDefault: true,
            },
            update: { isDefault: true },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record({
      organizationId,
      userId: membership.userId,
      action: accountId
        ? "instagram.account.default_set"
        : "instagram.account.default_cleared",
      resourceType: accountId
        ? "instagram_account"
        : "instagram_account_preference",
      resourceId: accountId ?? membership.userId,
    });
    return { accountId, isDefault: Boolean(accountId) };
  }

  async grantAccess(
    organizationId: string,
    accountId: string,
    membershipId: string,
    user: AuthenticatedUser,
    level: InstagramAccountAccessLevel,
  ) {
    const actor = await this.requireAdmin(organizationId, user);
    await this.findAccountForAdmin(organizationId, accountId);
    const target = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
    });
    if (!target) throw new NotFoundException("Organization member not found");
    if (target.role !== MembershipRole.MEMBER)
      throw new BadRequestException(
        "Account grants are only assigned to MEMBER roles",
      );
    const grant = await this.prisma.instagramAccountAccess.upsert({
      where: {
        organizationId_instagramAccountId_membershipId: {
          organizationId,
          instagramAccountId: accountId,
          membershipId,
        },
      },
      create: {
        organizationId,
        instagramAccountId: accountId,
        membershipId,
        level,
      },
      update: { level },
    });
    await this.audit.record({
      organizationId,
      userId: actor.userId,
      action: "instagram.account.access_granted",
      resourceType: "instagram_account",
      resourceId: accountId,
      metadata: { level },
    });
    return { membershipId: grant.membershipId, level: grant.level, accountId };
  }

  async revokeAccess(
    organizationId: string,
    accountId: string,
    membershipId: string,
    user: AuthenticatedUser,
  ) {
    const actor = await this.requireAdmin(organizationId, user);
    await this.findAccountForAdmin(organizationId, accountId);
    await this.prisma.$transaction(async (tx) => {
      await tx.instagramAccountAccess.deleteMany({
        where: { organizationId, instagramAccountId: accountId, membershipId },
      });
      const target = await tx.membership.findFirst({
        where: { id: membershipId, organizationId },
        select: { userId: true },
      });
      if (target)
        await tx.instagramAccountPreference.deleteMany({
          where: {
            organizationId,
            userId: target.userId,
            instagramAccountId: accountId,
          },
        });
    });
    await this.audit.record({
      organizationId,
      userId: actor.userId,
      action: "instagram.account.access_revoked",
      resourceType: "instagram_account",
      resourceId: accountId,
    });
    return { success: true };
  }

  async listAccess(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
  ) {
    await this.requireAdmin(organizationId, user);
    await this.findAccountForAdmin(organizationId, accountId);
    const grants = await this.prisma.instagramAccountAccess.findMany({
      where: { organizationId, instagramAccountId: accountId },
      include: {
        membership: { include: { user: { select: { email: true } } } },
      },
      orderBy: [{ createdAt: "asc" }],
    });
    return grants.map((grant) => ({
      membershipId: grant.membershipId,
      email: grant.membership.user.email,
      level: grant.level,
      createdAt: grant.createdAt,
    }));
  }

  async getSettings(organizationId: string, user: AuthenticatedUser) {
    await this.requireAdmin(organizationId, user);
    return this.ensureSettings(organizationId);
  }

  async updateSettings(
    organizationId: string,
    user: AuthenticatedUser,
    changes: { maxActiveAccounts?: number; maxGroups?: number },
  ) {
    const actor = await this.requireAdmin(organizationId, user);
    const settings = await this.prisma.$transaction(
      async (tx) => {
        const current = await this.lockSettings(tx, organizationId);
        const activeCount = await tx.instagramAccount.count({
          where: {
            organizationId,
            status: { not: InstagramAccountStatus.DISCONNECTED },
          },
        });
        const groupCount = await tx.instagramAccountGroup.count({
          where: { organizationId },
        });
        const maxActiveAccounts =
          changes.maxActiveAccounts ?? current.maxActiveAccounts;
        const maxGroups = changes.maxGroups ?? current.maxGroups;
        if (maxActiveAccounts < activeCount)
          throw new ConflictException(
            "The account limit cannot be lower than the current active account count",
          );
        if (maxGroups < groupCount)
          throw new ConflictException(
            "The group limit cannot be lower than the current group count",
          );
        return tx.instagramAccountSettings.update({
          where: { organizationId },
          data: { maxActiveAccounts, maxGroups },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    await this.audit.record({
      organizationId,
      userId: actor.userId,
      action: "instagram.account.settings_updated",
      resourceType: "instagram_account_settings",
    });
    return settings;
  }

  async disconnect(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
  ) {
    const actor = await this.requireAdmin(organizationId, user);
    const result = await this.instagramAccounts.disconnectAccount(
      organizationId,
      accountId,
    );
    await this.audit.record({
      organizationId,
      userId: actor.userId,
      action: "instagram.account.disconnected",
      resourceType: "instagram_account",
      resourceId: accountId,
    });
    return result;
  }

  async sync(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
  ) {
    await this.requireAccount(organizationId, accountId, user, "MANAGE");
    const result = await this.instagramAccounts.syncAccount(
      organizationId,
      accountId,
    );
    await this.audit.record({
      organizationId,
      userId: user.sub,
      action: "instagram.account.synchronized",
      resourceType: "instagram_account",
      resourceId: accountId,
    });
    return result;
  }

  private accountWhere(
    organizationId: string,
    membership: { id: string; userId: string; role: MembershipRole },
    user: AuthenticatedUser,
    query: InstagramAccountsQueryDto = {},
  ): Prisma.InstagramAccountWhereInput {
    const where: Prisma.InstagramAccountWhereInput = {
      organizationId,
      ...(membership.role === MembershipRole.MEMBER
        ? {
            accessGrants: {
              some: {
                organizationId,
                membershipId: membership.id,
                level: {
                  in: [
                    InstagramAccountAccessLevel.VIEW,
                    InstagramAccountAccessLevel.MANAGE,
                  ],
                },
              },
            },
          }
        : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
      ...(query.groupId ? { groupId: query.groupId } : {}),
      ...(query.tag ? { tags: { has: query.tag.toLowerCase() } } : {}),
      ...(query.search
        ? {
            OR: [
              { username: { contains: query.search, mode: "insensitive" } },
              { name: { contains: query.search, mode: "insensitive" } },
              {
                externalAccountId: {
                  contains: query.search,
                  mode: "insensitive",
                },
              },
              {
                internalAlias: { contains: query.search, mode: "insensitive" },
              },
            ],
          }
        : {}),
      ...(query.favorite === true
        ? {
            preferences: {
              some: { organizationId, userId: user.sub, favorite: true },
            },
          }
        : query.favorite === false
          ? {
              NOT: {
                preferences: {
                  some: { organizationId, userId: user.sub, favorite: true },
                },
              },
            }
          : {}),
    };
    return where;
  }

  private async membership(organizationId: string, user: AuthenticatedUser) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId: user.sub, organizationId } },
      select: { id: true, userId: true, role: true },
    });
    if (!membership) throw new NotFoundException("Organization not found");
    return membership;
  }

  private async requireAdmin(organizationId: string, user: AuthenticatedUser) {
    const membership = await this.membership(organizationId, user);
    if (!isAdminRole(membership.role))
      throw new ForbiddenException("Insufficient organization role");
    return membership;
  }

  private async requireAccount(
    organizationId: string,
    accountId: string,
    user: AuthenticatedUser,
    required: "VIEW" | "MANAGE",
  ) {
    const membership = await this.membership(organizationId, user);
    const account = await this.prisma.instagramAccount.findFirst({
      where: { id: accountId, organizationId },
    });
    if (!account) throw new NotFoundException("Instagram account not found");
    if (isAdminRole(membership.role)) return membership;
    const grant = await this.prisma.instagramAccountAccess.findUnique({
      where: {
        organizationId_instagramAccountId_membershipId: {
          organizationId,
          instagramAccountId: accountId,
          membershipId: membership.id,
        },
      },
    });
    if (!grant) throw new NotFoundException("Instagram account not found");
    if (
      required === "MANAGE" &&
      grant.level !== InstagramAccountAccessLevel.MANAGE
    )
      throw new ForbiddenException("Account management permission required");
    return membership;
  }

  private async findAccountForAdmin(organizationId: string, accountId: string) {
    const account = await this.prisma.instagramAccount.findFirst({
      where: { id: accountId, organizationId },
      select: { id: true },
    });
    if (!account) throw new NotFoundException("Instagram account not found");
    return account;
  }

  private async findGroup(
    organizationId: string,
    groupId: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const group = await db.instagramAccountGroup.findFirst({
      where: { id: groupId, organizationId },
    });
    if (!group)
      throw new NotFoundException("Instagram account group not found");
    return group;
  }

  private async ensureSettings(organizationId: string) {
    return this.prisma.instagramAccountSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        maxActiveAccounts: this.config.get<number>(
          "INSTAGRAM_DEFAULT_ORGANIZATION_ACCOUNT_LIMIT",
          10,
        ),
        maxGroups: this.config.get<number>(
          "INSTAGRAM_DEFAULT_ORGANIZATION_GROUP_LIMIT",
          20,
        ),
      },
      update: {},
    });
  }

  private async lockSettings(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ) {
    await tx.instagramAccountSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        maxActiveAccounts: this.config.get<number>(
          "INSTAGRAM_DEFAULT_ORGANIZATION_ACCOUNT_LIMIT",
          10,
        ),
        maxGroups: this.config.get<number>(
          "INSTAGRAM_DEFAULT_ORGANIZATION_GROUP_LIMIT",
          20,
        ),
      },
      update: {},
    });
    await tx.$queryRaw`SELECT "organization_id" FROM "instagram_account_settings" WHERE "organization_id" = ${organizationId}::uuid FOR UPDATE`;
    return tx.instagramAccountSettings.findUniqueOrThrow({
      where: { organizationId },
    });
  }

  private async runPartial<T extends { accountId: string; outcome: "SUCCESS" }>(
    accountIds: string[],
    operation: (accountId: string) => Promise<T>,
  ) {
    const items: Array<
      T | { accountId: string; outcome: "FAILED"; code: string }
    > = [];
    for (const accountId of accountIds) {
      try {
        items.push(await operation(accountId));
      } catch (error) {
        const code =
          error instanceof NotFoundException
            ? "ACCOUNT_NOT_AVAILABLE"
            : error instanceof ForbiddenException
              ? "ACCESS_DENIED"
              : error instanceof ConflictException
                ? "ACCOUNT_NOT_READY"
                : error instanceof ServiceUnavailableException
                  ? "SYNC_FAILED"
                  : "OPERATION_FAILED";
        items.push({ accountId, outcome: "FAILED", code });
      }
    }
    return items;
  }

  private async auditBatch(
    organizationId: string,
    user: AuthenticatedUser,
    action: string,
    items: Array<{ outcome: "SUCCESS" | "FAILED" }>,
  ) {
    const succeededCount = items.filter(
      (item) => item.outcome === "SUCCESS",
    ).length;
    await this.audit.record({
      organizationId,
      userId: user.sub,
      action,
      resourceType: "instagram_account_batch",
      outcome: succeededCount === items.length ? "SUCCESS" : "FAILURE",
      metadata: {
        requestedCount: items.length,
        succeededCount,
        failedCount: items.length - succeededCount,
      },
    });
  }

  private publicAccount(account: Prisma.InstagramAccountGetPayload<object>) {
    return {
      id: account.id,
      organizationId: account.organizationId,
      provider: account.provider,
      dataMode: account.provider === "MOCK" ? "MOCK" : "LIVE",
      externalAccountId: account.externalAccountId,
      username: account.username,
      name: account.name,
      avatarUrl: account.avatarUrl,
      status: account.status,
      groupId: account.groupId,
      internalAlias: account.internalAlias,
      tags: account.tags,
      tokenExpiresAt: account.tokenExpiresAt,
      connectedAt: account.connectedAt,
      disconnectedAt: account.disconnectedAt,
      lastSyncedAt: account.lastSyncedAt,
      lastError: account.lastError,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }
}

function normalizeNullable(value?: string | null) {
  return value?.trim() || null;
}

function normalizeTags(tags: string[]) {
  return [
    ...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ];
}

function isUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isAdminRole(role: MembershipRole) {
  return role === MembershipRole.OWNER || role === MembershipRole.ADMIN;
}
