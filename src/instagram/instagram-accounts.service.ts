import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  InstagramAccount,
  InstagramAccountStatus,
  InstagramProviderType,
  MembershipRole,
  Prisma,
} from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import { InstagramOAuthCallbackDto } from "./dto/instagram-oauth-callback.dto";
import { InstagramConnectionValidator } from "./instagram-connection-validator.service";
import { InstagramAccountsQueryDto } from "./dto/instagram-accounts-query.dto";
import {
  INSTAGRAM_PROVIDER,
  InstagramCredentials,
  InstagramProvider,
} from "./instagram-provider";
import { TokenEncryptionService } from "./token-encryption.service";

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class InstagramAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly encryption: TokenEncryptionService,
    private readonly connectionValidator: InstagramConnectionValidator,
    private readonly audit: AuditService,
    @Inject(INSTAGRAM_PROVIDER) private readonly provider: InstagramProvider,
  ) {}

  async startConnection(user: AuthenticatedUser, organizationId: string) {
    const state = randomBytes(32).toString("base64url");
    const redirectUri = this.redirectUri();
    const scopes = this.scopes();
    const authorizationUrl = this.provider.authorizationUrl(
      state,
      redirectUri,
      scopes,
    );
    const account = await this.prisma.$transaction(async (tx) => {
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
      const settings = await tx.instagramAccountSettings.findUniqueOrThrow({
        where: { organizationId },
      });
      const activeCount = await tx.instagramAccount.count({
        where: {
          organizationId,
          status: { not: InstagramAccountStatus.DISCONNECTED },
        },
      });
      if (activeCount >= settings.maxActiveAccounts) {
        throw new ConflictException(
          "Organization Instagram account limit reached",
        );
      }
      const createdAccount = await tx.instagramAccount.create({
        data: {
          organizationId,
          provider: this.provider.type,
          status: "CONNECTING",
        },
      });
      await tx.instagramOAuthState.create({
        data: {
          stateHash: this.hashState(state),
          userId: user.sub,
          organizationId,
          accountId: createdAccount.id,
          expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
        },
      });
      return createdAccount;
    });

    await this.audit.record({
      organizationId,
      userId: user.sub,
      action: "instagram.account.connection_started",
      resourceType: "instagram_account",
      resourceId: account.id,
      metadata: { provider: this.provider.type },
    });

    return {
      mode: this.provider.type,
      state,
      authorizationUrl,
      account: this.toPublicAccount(account),
    };
  }

  async handleOAuthCallback(query: InstagramOAuthCallbackDto) {
    if (!query.state) throw new BadRequestException("OAuth state is required");
    if (!query.code && !query.error)
      throw new BadRequestException("OAuth code is required");

    const now = new Date();
    const state = await this.prisma.instagramOAuthState.findUnique({
      where: { stateHash: this.hashState(query.state) },
      include: { account: true },
    });
    if (!state) {
      throw new BadRequestException("OAuth state is invalid or expired");
    }
    if (state.usedAt || state.expiresAt <= now) {
      if (!state.usedAt && state.expiresAt <= now) {
        await this.markAccountError(
          state.accountId,
          "Instagram authorization expired.",
        );
        await this.prisma.instagramOAuthState.updateMany({
          where: { id: state.id, usedAt: null },
          data: { usedAt: now },
        });
      }
      throw new BadRequestException("OAuth state is invalid or expired");
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: state.userId,
          organizationId: state.organizationId,
        },
      },
      select: { role: true },
    });
    if (
      !membership ||
      (membership.role !== MembershipRole.OWNER &&
        membership.role !== MembershipRole.ADMIN)
    ) {
      throw new BadRequestException("OAuth connection is no longer authorized");
    }
    if (state.account.status !== "CONNECTING") {
      throw new BadRequestException("OAuth connection is no longer pending");
    }

    const consumed = await this.prisma.instagramOAuthState.updateMany({
      where: { id: state.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (consumed.count !== 1)
      throw new BadRequestException("OAuth state has already been used");

    if (query.error) {
      await this.markAccountError(
        state.accountId,
        "Instagram authorization was declined.",
      );
      await this.prisma.instagramOAuthState.deleteMany({
        where: { id: state.id },
      });
      throw new BadRequestException("Instagram authorization was declined");
    }

    try {
      const credentials = await this.provider.exchangeAuthorizationCode(
        query.code!,
        this.redirectUri(),
      );
      const profile = await this.connectionValidator.validate(credentials);
      const encrypted = this.encryption.encrypt(credentials.accessToken);
      const existing = await this.prisma.instagramAccount.findFirst({
        where: {
          organizationId: state.organizationId,
          provider: this.provider.type,
          externalAccountId: profile.externalAccountId,
          id: { not: state.accountId },
        },
      });
      if (
        existing &&
        existing.status !== "DISCONNECTED" &&
        existing.status !== "ERROR"
      ) {
        throw new ConflictException(
          "This Instagram account is already connected to this organization",
        );
      }

      const data = {
        externalAccountId: profile.externalAccountId,
        username: profile.username,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        status: "CONNECTED" as const,
        encryptedAccessToken: encrypted.ciphertext,
        accessTokenIv: encrypted.iv,
        accessTokenTag: encrypted.tag,
        tokenExpiresAt: credentials.tokenExpiresAt,
        connectedAt: new Date(),
        disconnectedAt: null,
        lastSyncedAt: null,
        lastError: null,
      };
      let account: InstagramAccount;
      if (existing) {
        account = await this.prisma.$transaction(async (tx) => {
          const updated = await tx.instagramAccount.update({
            where: { id: existing.id },
            data,
          });
          await tx.instagramAccount.delete({ where: { id: state.accountId } });
          return updated;
        });
      } else {
        const updated = await this.prisma.instagramAccount.updateMany({
          where: { id: state.accountId, status: "CONNECTING" },
          data,
        });
        if (updated.count !== 1)
          throw new ConflictException(
            "Instagram connection is no longer pending",
          );
        account = await this.prisma.instagramAccount.findUniqueOrThrow({
          where: { id: state.accountId },
        });
        await this.prisma.instagramOAuthState.deleteMany({
          where: { id: state.id },
        });
      }
      await this.audit.record({
        organizationId: state.organizationId,
        userId: state.userId,
        action: "instagram.account.connected",
        resourceType: "instagram_account",
        resourceId: account.id,
        metadata: { provider: this.provider.type },
      });
      return this.toPublicAccount(account);
    } catch (error) {
      await this.markAccountError(
        state.accountId,
        "Instagram connection could not be validated.",
      );
      await this.prisma.instagramOAuthState.deleteMany({
        where: { id: state.id },
      });
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException
      )
        throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "This Instagram account is already connected to this organization",
        );
      }
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        "Instagram connection could not be completed",
      );
    }
  }

  async listAccounts(
    organizationId: string,
    query: InstagramAccountsQueryDto = {},
  ) {
    const where: Prisma.InstagramAccountWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.provider ? { provider: query.provider } : {}),
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
            ],
          }
        : {}),
    };
    const usePagination =
      query.page !== undefined ||
      query.pageSize !== undefined ||
      query.status !== undefined ||
      query.provider !== undefined ||
      query.search !== undefined;

    if (!usePagination) {
      const accounts = await this.prisma.instagramAccount.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      return accounts.map((account) => this.toPublicAccount(account));
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [total, accounts] = await this.prisma.$transaction([
      this.prisma.instagramAccount.count({ where }),
      this.prisma.instagramAccount.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: accounts.map((account) => this.toPublicAccount(account)),
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getAccountSummary(organizationId: string) {
    const [total, statusGroups, providerGroups] = await Promise.all([
      this.prisma.instagramAccount.count({ where: { organizationId } }),
      this.prisma.instagramAccount.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { id: true },
      }),
      this.prisma.instagramAccount.groupBy({
        by: ["provider"],
        where: { organizationId },
        _count: { id: true },
      }),
    ]);

    const byStatus = Object.fromEntries(
      Object.values(InstagramAccountStatus).map((status) => [status, 0]),
    ) as Record<InstagramAccountStatus, number>;
    const byProvider = Object.fromEntries(
      Object.values(InstagramProviderType).map((provider) => [provider, 0]),
    ) as Record<InstagramProviderType, number>;
    for (const group of statusGroups) byStatus[group.status] = group._count.id;
    for (const group of providerGroups)
      byProvider[group.provider] = group._count.id;

    return { total, byStatus, byProvider };
  }

  async getAccount(organizationId: string, accountId: string) {
    const account = await this.findAccount(organizationId, accountId);
    return this.toPublicAccount(account);
  }

  async syncAccount(organizationId: string, accountId: string) {
    const account = await this.findAccount(organizationId, accountId);
    if (
      !account.encryptedAccessToken ||
      !account.accessTokenIv ||
      !account.accessTokenTag ||
      !account.externalAccountId ||
      (account.status !== "CONNECTED" && account.status !== "ERROR")
    ) {
      throw new ConflictException("Instagram account is not connected");
    }

    try {
      const accessToken = this.encryption.decrypt({
        ciphertext: account.encryptedAccessToken,
        iv: account.accessTokenIv,
        tag: account.accessTokenTag,
      });
      const credentials: InstagramCredentials = {
        accessToken,
        externalAccountId: account.externalAccountId,
        tokenExpiresAt: account.tokenExpiresAt,
      };
      const profile = await this.connectionValidator.validate(credentials);
      const synced = await this.prisma.instagramAccount.update({
        where: { id: account.id },
        data: {
          username: profile.username,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          status: "CONNECTED",
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });
      return this.toPublicAccount(synced);
    } catch {
      await this.markAccountError(
        account.id,
        "Instagram connection validation failed during sync.",
      );
      throw new ServiceUnavailableException(
        "Instagram account could not be synchronized",
      );
    }
  }

  async disconnectAccount(organizationId: string, accountId: string) {
    const account = await this.findAccount(organizationId, accountId);
    const disconnected = await this.prisma.$transaction(
      async (tx) => {
        const activeRules = await tx.automationRule.count({
          where: {
            organizationId,
            instagramAccountId: accountId,
            active: true,
            deletedAt: null,
          },
        });
        const pendingPublications = await tx.publication.count({
          where: {
            organizationId,
            instagramAccountId: accountId,
            status: { in: ["DRAFT", "QUEUED", "PROCESSING"] },
          },
        });
        if (activeRules > 0 || pendingPublications > 0) {
          throw new ConflictException(
            "Deactivate active automations and resolve pending publications before disconnecting this account",
          );
        }
        await tx.instagramOAuthState.updateMany({
          where: { organizationId, accountId, usedAt: null },
          data: { usedAt: new Date() },
        });
        return tx.instagramAccount.update({
          where: { id: account.id },
          data: {
            status: "DISCONNECTED",
            encryptedAccessToken: null,
            accessTokenIv: null,
            accessTokenTag: null,
            tokenExpiresAt: null,
            disconnectedAt: new Date(),
            lastError: null,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return this.toPublicAccount(disconnected);
  }

  private async findAccount(
    organizationId: string,
    accountId: string,
  ): Promise<InstagramAccount> {
    const account = await this.prisma.instagramAccount.findFirst({
      where: { id: accountId, organizationId },
    });
    if (!account) throw new NotFoundException("Instagram account not found");
    return account;
  }

  private async markAccountError(
    accountId: string,
    message: string,
  ): Promise<void> {
    await this.prisma.instagramAccount.updateMany({
      where: { id: accountId, status: { not: "DISCONNECTED" } },
      data: { status: "ERROR", lastError: message },
    });
  }

  private redirectUri(): string {
    return this.config.get<string>(
      "META_INSTAGRAM_REDIRECT_URI",
      "http://localhost:3001/api/instagram/oauth/callback",
    );
  }

  private scopes(): string[] {
    return this.config
      .get<string>("META_INSTAGRAM_SCOPES", "instagram_business_basic")
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  private hashState(state: string): string {
    return createHash("sha256").update(state).digest("hex");
  }

  private toPublicAccount(account: InstagramAccount) {
    return {
      id: account.id,
      organizationId: account.organizationId,
      provider: account.provider,
      dataMode:
        account.provider === InstagramProviderType.MOCK ? "MOCK" : "LIVE",
      groupId: account.groupId,
      internalAlias: account.internalAlias,
      tags: account.tags,
      externalAccountId: account.externalAccountId,
      username: account.username,
      name: account.name,
      avatarUrl: account.avatarUrl,
      status: account.status,
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
