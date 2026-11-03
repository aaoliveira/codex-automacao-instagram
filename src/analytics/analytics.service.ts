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
  AnalyticsDataOrigin,
  AnalyticsSnapshotStatus,
  AnalyticsSyncStatus,
  InstagramAccountStatus,
  InstagramProviderType,
  Prisma,
  PublicationStatus,
} from "@prisma/client";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { AuditService } from "../audit/audit.service";
import { InstagramAccountManagementService } from "../instagram/instagram-account-management.service";
import { TokenEncryptionService } from "../instagram/token-encryption.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuthenticatedUser } from "../shared/types/authenticated-user";
import {
  PUBLICATION_ANALYTICS_QUEUE,
  PUBLICATION_ANALYTICS_SYNC_JOB,
} from "./analytics.constants";
import {
  AnalyticsPeriod,
  addCalendarDays,
  resolveAnalyticsPeriod,
  zonedDateKey,
} from "./analytics-period";
import {
  ANALYTICS_INSIGHTS_PROVIDER,
  AnalyticsMetricKey,
  InstagramInsightsProvider,
  PUBLICATION_METRIC_KEYS,
} from "./insights-provider";
import { AnalyticsRateLimiter } from "./analytics-rate-limiter";
import { StartAnalyticsSyncDto } from "./dto/start-analytics-sync.dto";
import { AnalyticsPeriodDto } from "./dto/analytics-period.dto";
import { AnalyticsSeriesQueryDto } from "./dto/analytics-series-query.dto";

export interface AnalyticsSyncJobData {
  organizationId: string;
  syncRunId: string;
}

const DERIVED_METRIC = "engagement_rate_by_reach";
const ALL_METRIC_KEYS: AnalyticsMetricKey[] = [
  ...PUBLICATION_METRIC_KEYS,
  DERIVED_METRIC,
];

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: InstagramAccountManagementService,
    private readonly encryption: TokenEncryptionService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly rateLimiter: AnalyticsRateLimiter,
    @InjectQueue(PUBLICATION_ANALYTICS_QUEUE)
    private readonly queue: Queue<AnalyticsSyncJobData>,
    @Inject(ANALYTICS_INSIGHTS_PROVIDER)
    private readonly providers: Record<
      InstagramProviderType,
      InstagramInsightsProvider
    >,
  ) {}

  async metricCatalog() {
    const entries = await this.prisma.metricDefinition.findMany({
      where: { active: true },
      orderBy: [{ origin: "asc" }, { key: "asc" }],
    });
    return entries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      definition: entry.definition,
      unit: entry.unit,
      origin: entry.origin,
      granularity: entry.granularity,
      availableMediaTypes: entry.availableMediaTypes,
      requiredPermissions: entry.requiredPermissions,
      providerMetric: entry.metaMetric,
      formula: entry.formula,
      sourceSemantics:
        entry.origin === AnalyticsDataOrigin.DERIVED
          ? "DERIVED"
          : "PROVIDER_VALUE",
      supportedOrigins:
        entry.origin === AnalyticsDataOrigin.DERIVED
          ? ["DERIVED"]
          : ["META", "MOCK"],
      mockAvailable: true,
      availabilityByOrigin: {
        META: entry.availableMediaTypes,
        MOCK: ["PHOTO", "VIDEO", "REEL"],
        DERIVED: entry.availableMediaTypes,
      },
    }));
  }

  async startSync(
    organizationId: string,
    user: AuthenticatedUser,
    dto: StartAnalyticsSyncDto,
  ) {
    await this.accounts.assertAccountManageable(
      organizationId,
      dto.instagramAccountId,
      user,
    );
    const period = resolveAnalyticsPeriod(
      dto.fromDate,
      dto.toDate,
      dto.timezone,
    );
    const account = await this.prisma.instagramAccount.findFirst({
      where: { id: dto.instagramAccountId, organizationId },
      select: { id: true, status: true, provider: true },
    });
    if (!account) throw new NotFoundException("Instagram account not found");
    if (account.status !== InstagramAccountStatus.CONNECTED)
      throw new ConflictException(
        "Instagram account must be connected before syncing insights",
      );

    const existing = await this.prisma.analyticsSyncRun.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId,
          idempotencyKey: dto.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (
        existing.instagramAccountId !== dto.instagramAccountId ||
        existing.startDate.getTime() !== period.start.getTime() ||
        existing.endDate.getTime() !== period.endExclusive.getTime() ||
        existing.timezone !== dto.timezone
      ) {
        throw new ConflictException(
          "Idempotency key was already used for a different analytics request",
        );
      }
      return { ...this.publicRun(existing), reused: true };
    }

    let run;
    try {
      run = await this.prisma.analyticsSyncRun.create({
        data: {
          organizationId,
          instagramAccountId: dto.instagramAccountId,
          requestedByUserId: user.sub,
          idempotencyKey: dto.idempotencyKey,
          startDate: period.start,
          endDate: period.endExclusive,
          timezone: period.timezone,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const duplicate = await this.prisma.analyticsSyncRun.findUnique({
          where: {
            organizationId_idempotencyKey: {
              organizationId,
              idempotencyKey: dto.idempotencyKey,
            },
          },
        });
        if (duplicate) {
          if (
            duplicate.instagramAccountId !== dto.instagramAccountId ||
            duplicate.startDate.getTime() !== period.start.getTime() ||
            duplicate.endDate.getTime() !== period.endExclusive.getTime() ||
            duplicate.timezone !== dto.timezone
          ) {
            throw new ConflictException(
              "Idempotency key was already used for a different analytics request",
            );
          }
          return { ...this.publicRun(duplicate), reused: true };
        }
      }
      throw error;
    }

    try {
      await this.queue.add(
        PUBLICATION_ANALYTICS_SYNC_JOB,
        { organizationId, syncRunId: run.id },
        {
          jobId: run.id,
          attempts: this.config.get<number>("ANALYTICS_MAX_ATTEMPTS", 3),
          backoff: { type: "exponential", delay: 2_000 },
          removeOnComplete: { age: 7 * 24 * 60 * 60, count: 5_000 },
          removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 },
        },
      );
    } catch {
      await this.prisma.analyticsSyncRun.update({
        where: { id: run.id },
        data: {
          status: AnalyticsSyncStatus.FAILED,
          errorCode: "QUEUE_UNAVAILABLE",
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException("Analytics queue is unavailable");
    }
    await this.audit.record({
      organizationId,
      userId: user.sub,
      action: "analytics.insights.sync_started",
      resourceType: "analytics_sync_run",
      resourceId: run.id,
      metadata: { provider: account.provider, requestedCount: 0 },
    });
    return { ...this.publicRun(run), reused: false };
  }

  async syncStatus(
    organizationId: string,
    runId: string,
    user: AuthenticatedUser,
  ) {
    const run = await this.prisma.analyticsSyncRun.findFirst({
      where: { id: runId, organizationId },
    });
    if (!run) throw new NotFoundException("Analytics sync run not found");
    await this.accounts.assertAccountReadable(
      organizationId,
      run.instagramAccountId,
      user,
    );
    return this.publicRun(run);
  }

  async summary(
    organizationId: string,
    user: AuthenticatedUser,
    dto: AnalyticsPeriodDto,
  ) {
    const period = resolveAnalyticsPeriod(
      dto.fromDate,
      dto.toDate,
      dto.timezone,
    );
    const accountWhere = await this.accountFilter(
      organizationId,
      user,
      dto.instagramAccountId,
    );
    const previousTo = addCalendarDays(dto.fromDate, -1);
    const previousFrom = addCalendarDays(
      previousTo,
      -(period.numberOfDays - 1),
    );
    const previous = resolveAnalyticsPeriod(
      previousFrom,
      previousTo,
      dto.timezone,
    );
    const [currentData, previousData, catalog] = await Promise.all([
      this.readPeriodMetrics(organizationId, accountWhere, period),
      this.readPeriodMetrics(organizationId, accountWhere, previous),
      this.prisma.metricDefinition.findMany({
        where: { active: true },
        orderBy: { key: "asc" },
      }),
    ]);
    return {
      timezone: dto.timezone,
      current: {
        fromDate: dto.fromDate,
        toDate: dto.toDate,
        ...this.summarizeMetrics(currentData),
      },
      previous: {
        fromDate: previousFrom,
        toDate: previousTo,
        ...this.summarizeMetrics(previousData),
      },
      metrics: catalog.map((metric) => ({
        key: metric.key,
        label: metric.label,
        origin: metric.origin,
        unit: metric.unit,
      })),
    };
  }

  async series(
    organizationId: string,
    user: AuthenticatedUser,
    dto: AnalyticsSeriesQueryDto,
  ) {
    const period = resolveAnalyticsPeriod(
      dto.fromDate,
      dto.toDate,
      dto.timezone,
    );
    const accountWhere = await this.accountFilter(
      organizationId,
      user,
      dto.instagramAccountId,
    );
    const keys = this.validateMetricKey(dto.metricKey);
    const data = await Promise.all(
      keys.map(
        async (metricKey) =>
          [
            metricKey,
            await this.readMetricSnapshots(
              organizationId,
              accountWhere,
              metricKey,
              period,
            ),
          ] as const,
      ),
    );
    const dates = Array.from({ length: period.numberOfDays }, (_, i) =>
      addCalendarDays(dto.fromDate, i),
    );
    const items = data.map(([metricKey, snapshots]) => {
      const byDate = new Map<
        string,
        {
          total: number;
          available: number;
          unavailable: number;
          origins: Set<AnalyticsDataOrigin>;
        }
      >();
      for (const snapshot of snapshots) {
        if (!snapshot.publication.publishedAt) continue;
        const key = zonedDateKey(
          snapshot.publication.publishedAt,
          dto.timezone,
        );
        const bucket = byDate.get(key) ?? {
          total: 0,
          available: 0,
          unavailable: 0,
          origins: new Set<AnalyticsDataOrigin>(),
        };
        if (
          snapshot.status === AnalyticsSnapshotStatus.AVAILABLE &&
          snapshot.value !== null
        ) {
          bucket.total += Number(snapshot.value);
          bucket.available += 1;
          bucket.origins.add(snapshot.origin);
        } else bucket.unavailable += 1;
        byDate.set(key, bucket);
      }
      return {
        metricKey,
        points: dates.map((date) => {
          const bucket = byDate.get(date);
          return {
            date,
            value:
              bucket && bucket.available > 0 ? roundMetric(bucket.total) : null,
            availablePublications: bucket?.available ?? 0,
            unavailablePublications: bucket?.unavailable ?? 0,
            origins: bucket ? [...bucket.origins] : [],
          };
        }),
      };
    });
    return {
      timezone: dto.timezone,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      series: items,
    };
  }

  async ranking(
    organizationId: string,
    user: AuthenticatedUser,
    dto: AnalyticsSeriesQueryDto,
  ) {
    const period = resolveAnalyticsPeriod(
      dto.fromDate,
      dto.toDate,
      dto.timezone,
    );
    const accountWhere = await this.accountFilter(
      organizationId,
      user,
      dto.instagramAccountId,
    );
    const metricKey = this.validateMetricKey(dto.metricKey)[0];
    const snapshots = await this.readMetricSnapshots(
      organizationId,
      accountWhere,
      metricKey,
      period,
    );
    const byPublication = new Map<
      string,
      {
        publication: (typeof snapshots)[number]["publication"];
        value: number | null;
        status: AnalyticsSnapshotStatus;
        origin: AnalyticsDataOrigin;
        reasonCode: string | null;
        capturedAt: Date;
      }
    >();
    for (const snapshot of snapshots) {
      if (byPublication.has(snapshot.publicationId)) continue;
      byPublication.set(snapshot.publicationId, {
        publication: snapshot.publication,
        value:
          snapshot.status === AnalyticsSnapshotStatus.AVAILABLE &&
          snapshot.value !== null
            ? Number(snapshot.value)
            : null,
        status: snapshot.status,
        origin: snapshot.origin,
        reasonCode: snapshot.reasonCode,
        capturedAt: snapshot.capturedAt,
      });
    }
    return {
      metricKey,
      timezone: dto.timezone,
      items: [...byPublication.entries()]
        .map(([publicationId, item]) => ({
          publicationId,
          publishedAt: item.publication.publishedAt,
          mediaType: item.publication.mediaType,
          value: item.value,
          status: item.status,
          origin: item.origin,
          reasonCode: item.reasonCode,
          capturedAt: item.capturedAt,
        }))
        .sort(
          (a, b) =>
            (b.value ?? Number.NEGATIVE_INFINITY) -
              (a.value ?? Number.NEGATIVE_INFINITY) ||
            (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
        )
        .slice(0, 100),
    };
  }

  async publicationDetail(
    organizationId: string,
    publicationId: string,
    user: AuthenticatedUser,
  ) {
    const accessible = await this.accounts.accessibleAccountsWhere(
      organizationId,
      user,
    );
    const publication = await this.prisma.publication.findFirst({
      where: {
        organizationId,
        id: publicationId,
        instagramAccount: { is: accessible },
      },
      select: {
        id: true,
        instagramAccountId: true,
        mediaType: true,
        status: true,
        publishedAt: true,
        externalMediaId: true,
      },
    });
    if (!publication) throw new NotFoundException("Publication not found");
    const snapshots = await this.prisma.publicationInsightSnapshot.findMany({
      where: { organizationId, publicationId },
      orderBy: [{ capturedAt: "desc" }, { metricKey: "asc" }],
      include: {
        syncRun: { select: { timezone: true, createdAt: true, status: true } },
        metricDefinition: {
          select: { label: true, unit: true, origin: true, formula: true },
        },
      },
    });
    return {
      publication: {
        id: publication.id,
        instagramAccountId: publication.instagramAccountId,
        mediaType: publication.mediaType,
        status: publication.status,
        publishedAt: publication.publishedAt,
      },
      metrics: ALL_METRIC_KEYS.map((metricKey) => ({
        key: metricKey,
        latest: mapSnapshot(
          snapshots.find((snapshot) => snapshot.metricKey === metricKey),
        ),
        history: snapshots
          .filter((snapshot) => snapshot.metricKey === metricKey)
          .map(mapSnapshot),
      })),
    };
  }

  async processSyncRun(
    organizationId: string,
    runId: string,
    attempt: number,
    attempts: number,
    queueJob: {
      moveToDelayed: (timestamp: number, token: string) => Promise<void>;
      token?: string;
    },
  ) {
    const run = await this.prisma.analyticsSyncRun.findFirst({
      where: { id: runId, organizationId },
    });
    if (
      !run ||
      run.status === AnalyticsSyncStatus.COMPLETED ||
      run.status === AnalyticsSyncStatus.PARTIAL ||
      run.status === AnalyticsSyncStatus.FAILED
    )
      return;
    await this.prisma.analyticsSyncRun.update({
      where: { id: runId },
      data: {
        status: AnalyticsSyncStatus.PROCESSING,
        attemptCount: { increment: 1 },
        startedAt: run.startedAt ?? new Date(),
        errorCode: null,
      },
    });
    let providerType: InstagramProviderType | null = null;
    try {
      const account = await this.prisma.instagramAccount.findFirst({
        where: { id: run.instagramAccountId, organizationId },
        select: {
          id: true,
          provider: true,
          status: true,
          encryptedAccessToken: true,
          accessTokenIv: true,
          accessTokenTag: true,
        },
      });
      if (!account) throw new PermanentAnalyticsError("ACCOUNT_NOT_FOUND");
      providerType = account.provider;
      if (account.status !== InstagramAccountStatus.CONNECTED)
        throw new PermanentAnalyticsError("ACCOUNT_NOT_CONNECTED");
      const maxPublications = this.config.get<number>(
        "ANALYTICS_MAX_PUBLICATIONS_PER_RUN",
        100,
      );
      const publications = await this.prisma.publication.findMany({
        where: {
          organizationId,
          instagramAccountId: run.instagramAccountId,
          status: PublicationStatus.PUBLISHED,
          publishedAt: { gte: run.startDate, lt: run.endDate },
          externalMediaId: { not: null },
        },
        orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
        take: maxPublications + 1,
        select: {
          id: true,
          externalMediaId: true,
          mediaType: true,
          caption: true,
        },
      });
      if (publications.length > maxPublications)
        throw new PermanentAnalyticsError("PUBLICATION_LIMIT_EXCEEDED");
      await this.prisma.analyticsSyncRun.update({
        where: { id: runId },
        data: { requestedCount: publications.length * ALL_METRIC_KEYS.length },
      });
      const provider = this.providers[account.provider];
      const token =
        account.encryptedAccessToken &&
        account.accessTokenIv &&
        account.accessTokenTag
          ? this.encryption.decrypt({
              ciphertext: account.encryptedAccessToken,
              iv: account.accessTokenIv,
              tag: account.accessTokenTag,
            })
          : "";

      for (const publication of publications) {
        const existing = await this.prisma.publicationInsightSnapshot.findMany({
          where: {
            organizationId,
            syncRunId: runId,
            publicationId: publication.id,
          },
          select: { metricKey: true, status: true },
        });
        const complete = ALL_METRIC_KEYS.every((key) =>
          existing.some(
            (row) =>
              row.metricKey === key &&
              row.status !== AnalyticsSnapshotStatus.TRANSIENT_ERROR,
          ),
        );
        if (complete) continue;
        const waitMs = await this.rateLimiter.consume(
          organizationId,
          account.id,
        );
        if (waitMs > 0) {
          if (!queueJob.token)
            throw new Error("Analytics queue lock is unavailable");
          await this.prisma.analyticsSyncRun.update({
            where: { id: runId },
            data: { status: AnalyticsSyncStatus.QUEUED },
          });
          await queueJob.moveToDelayed(Date.now() + waitMs, queueJob.token);
          const { DelayedError } = await import("bullmq");
          throw new DelayedError();
        }
        const values = await provider.readPublicationInsights(token, {
          publicationId: publication.id,
          externalMediaId: publication.externalMediaId!,
          mediaType: publication.mediaType,
          caption: publication.caption,
        });
        const received = new Set(values.map((value) => value.metricKey));
        await this.prisma.$transaction(async (tx) => {
          for (const key of ALL_METRIC_KEYS) {
            const value = values.find((item) => item.metricKey === key) ?? {
              metricKey: key,
              origin:
                key === DERIVED_METRIC
                  ? AnalyticsDataOrigin.DERIVED
                  : account.provider === InstagramProviderType.MOCK
                    ? AnalyticsDataOrigin.MOCK
                    : AnalyticsDataOrigin.META,
              status: AnalyticsSnapshotStatus.UNAVAILABLE,
              value: null,
              reasonCode: "PROVIDER_METRIC_MISSING",
            };
            if (!received.has(key)) value.value = null;
            await tx.publicationInsightSnapshot.upsert({
              where: {
                syncRunId_publicationId_metricKey: {
                  syncRunId: runId,
                  publicationId: publication.id,
                  metricKey: key,
                },
              },
              create: {
                organizationId,
                instagramAccountId: account.id,
                publicationId: publication.id,
                syncRunId: runId,
                metricKey: key,
                mediaType: publication.mediaType,
                origin: value.origin,
                status: value.status,
                value:
                  value.status === AnalyticsSnapshotStatus.AVAILABLE &&
                  value.value !== null
                    ? new Prisma.Decimal(value.value)
                    : null,
                reasonCode: value.reasonCode,
              },
              update: {
                origin: value.origin,
                status: value.status,
                value:
                  value.status === AnalyticsSnapshotStatus.AVAILABLE &&
                  value.value !== null
                    ? new Prisma.Decimal(value.value)
                    : null,
                reasonCode: value.reasonCode,
                capturedAt: new Date(),
              },
            });
          }
        });
        if (
          values.some(
            (value) => value.status === AnalyticsSnapshotStatus.TRANSIENT_ERROR,
          )
        )
          throw new RetryableAnalyticsError("PROVIDER_TRANSIENT_ERROR");
      }

      const counts = await this.prisma.publicationInsightSnapshot.groupBy({
        by: ["status"],
        where: { organizationId, syncRunId: runId },
        _count: { id: true },
      });
      const available =
        counts.find(
          (group) => group.status === AnalyticsSnapshotStatus.AVAILABLE,
        )?._count.id ?? 0;
      const unavailable = counts.reduce(
        (sum, group) =>
          sum +
          (group.status === AnalyticsSnapshotStatus.AVAILABLE
            ? 0
            : group._count.id),
        0,
      );
      const status =
        unavailable > 0
          ? AnalyticsSyncStatus.PARTIAL
          : AnalyticsSyncStatus.COMPLETED;
      const updated = await this.prisma.analyticsSyncRun.update({
        where: { id: runId },
        data: {
          status,
          availableCount: available,
          unavailableCount: unavailable,
          finishedAt: new Date(),
          errorCode: null,
        },
      });
      await this.prisma.instagramAccount.updateMany({
        where: { id: account.id, organizationId },
        data: { lastSyncedAt: new Date() },
      });
      await this.audit.record({
        organizationId,
        userId: run.requestedByUserId,
        action:
          status === AnalyticsSyncStatus.PARTIAL
            ? "analytics.insights.sync_partial"
            : "analytics.insights.sync_completed",
        resourceType: "analytics_sync_run",
        resourceId: runId,
        metadata: {
          provider: account.provider,
          requestedCount: updated.requestedCount,
          succeededCount: available,
          failedCount: unavailable,
        },
      });
    } catch (error) {
      const delayed = error instanceof Error && error.name === "DelayedError";
      if (delayed) throw error;
      const retryable = error instanceof RetryableAnalyticsError;
      const finalAttempt = attempt + 1 >= attempts;
      if (
        !finalAttempt &&
        (retryable || !(error instanceof PermanentAnalyticsError))
      ) {
        await this.prisma.analyticsSyncRun.update({
          where: { id: runId },
          data: {
            status: AnalyticsSyncStatus.QUEUED,
            errorCode: retryable
              ? error.code
              : "ANALYTICS_SYNC_RETRYABLE_ERROR",
          },
        });
        throw new Error("Analytics sync will retry");
      }
      const counts = await this.prisma.publicationInsightSnapshot
        .groupBy({
          by: ["status"],
          where: { organizationId, syncRunId: runId },
          _count: { id: true },
        })
        .catch(() => []);
      const available =
        counts.find(
          (group) => group.status === AnalyticsSnapshotStatus.AVAILABLE,
        )?._count.id ?? 0;
      const unavailable = counts.reduce(
        (sum, group) =>
          sum +
          (group.status === AnalyticsSnapshotStatus.AVAILABLE
            ? 0
            : group._count.id),
        0,
      );
      const code =
        error instanceof PermanentAnalyticsError ||
        error instanceof RetryableAnalyticsError
          ? error.code
          : "ANALYTICS_SYNC_FAILED";
      const status =
        available > 0
          ? AnalyticsSyncStatus.PARTIAL
          : AnalyticsSyncStatus.FAILED;
      await this.prisma.analyticsSyncRun.update({
        where: { id: runId },
        data: {
          status,
          availableCount: available,
          unavailableCount: unavailable,
          errorCode: code,
          finishedAt: new Date(),
        },
      });
      await this.audit.record({
        organizationId,
        userId: run.requestedByUserId,
        action: "analytics.insights.sync_failed",
        resourceType: "analytics_sync_run",
        resourceId: runId,
        outcome: "FAILURE",
        metadata: {
          failedCount: unavailable,
          ...(providerType ? { provider: providerType } : {}),
        },
      });
      if (!finalAttempt && !(error instanceof PermanentAnalyticsError))
        throw new Error("Analytics sync will retry");
    }
  }

  private async accountFilter(
    organizationId: string,
    user: AuthenticatedUser,
    accountId?: string,
  ) {
    const accessible = await this.accounts.accessibleAccountsWhere(
      organizationId,
      user,
    );
    if (accountId) {
      const exists = await this.prisma.instagramAccount.findFirst({
        where: { AND: [{ id: accountId, organizationId }, accessible] },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException("Instagram account not found");
      return {
        AND: [{ id: accountId }, accessible],
      } satisfies Prisma.InstagramAccountWhereInput;
    }
    return accessible;
  }

  private validateMetricKey(key?: string): AnalyticsMetricKey[] {
    if (!key) return ALL_METRIC_KEYS;
    if (!ALL_METRIC_KEYS.includes(key as AnalyticsMetricKey))
      throw new BadRequestException("Unknown analytics metric");
    return [key as AnalyticsMetricKey];
  }

  private async readMetricSnapshots(
    organizationId: string,
    accountWhere: Prisma.InstagramAccountWhereInput,
    metricKey: string,
    period: AnalyticsPeriod,
  ) {
    const snapshots = await this.prisma.publicationInsightSnapshot.findMany({
      where: {
        organizationId,
        metricKey,
        instagramAccount: { is: accountWhere },
        publication: {
          is: {
            organizationId,
            publishedAt: { gte: period.start, lt: period.endExclusive },
          },
        },
      },
      orderBy: [
        { publicationId: "asc" },
        { capturedAt: "desc" },
        { id: "desc" },
      ],
      include: {
        publication: {
          select: { id: true, publishedAt: true, mediaType: true },
        },
      },
    });
    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots)
      if (!latest.has(snapshot.publicationId))
        latest.set(snapshot.publicationId, snapshot);
    return [...latest.values()];
  }

  private async readPeriodMetrics(
    organizationId: string,
    accountWhere: Prisma.InstagramAccountWhereInput,
    period: AnalyticsPeriod,
  ) {
    const values = await Promise.all(
      ALL_METRIC_KEYS.map(
        async (metricKey) =>
          [
            metricKey,
            await this.readMetricSnapshots(
              organizationId,
              accountWhere,
              metricKey,
              period,
            ),
          ] as const,
      ),
    );
    return values;
  }

  private summarizeMetrics(
    data: Awaited<ReturnType<AnalyticsService["readPeriodMetrics"]>>,
  ) {
    return Object.fromEntries(
      data.map(([metricKey, snapshots]) => {
        const available = snapshots.filter(
          (snapshot) =>
            snapshot.status === AnalyticsSnapshotStatus.AVAILABLE &&
            snapshot.value !== null,
        );
        const unavailable = snapshots.length - available.length;
        const total =
          available.length > 0
            ? roundMetric(
                available.reduce(
                  (sum, snapshot) => sum + Number(snapshot.value),
                  0,
                ),
              )
            : null;
        return [
          metricKey,
          {
            value: total,
            availablePublications: available.length,
            unavailablePublications: unavailable,
            status:
              snapshots.length === 0
                ? "NO_DATA"
                : unavailable === 0
                  ? "AVAILABLE"
                  : available.length === 0
                    ? snapshots[0].status
                    : "PARTIAL",
            origins: [...new Set(available.map((snapshot) => snapshot.origin))],
          },
        ];
      }),
    );
  }

  private publicRun(run: {
    id: string;
    instagramAccountId: string;
    timezone: string;
    startDate: Date;
    endDate: Date;
    status: AnalyticsSyncStatus;
    attemptCount: number;
    requestedCount: number;
    availableCount: number;
    unavailableCount: number;
    errorCode: string | null;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
  }) {
    return {
      id: run.id,
      instagramAccountId: run.instagramAccountId,
      timezone: run.timezone,
      start: run.startDate,
      endExclusive: run.endDate,
      status: run.status,
      attemptCount: run.attemptCount,
      requestedCount: run.requestedCount,
      availableCount: run.availableCount,
      unavailableCount: run.unavailableCount,
      errorCode: run.errorCode,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
  }
}

function mapSnapshot(
  snapshot:
    | {
        metricKey: string;
        origin: AnalyticsDataOrigin;
        status: AnalyticsSnapshotStatus;
        value: Prisma.Decimal | null;
        reasonCode: string | null;
        capturedAt: Date;
        syncRun: {
          timezone: string;
          createdAt: Date;
          status: AnalyticsSyncStatus;
        };
        metricDefinition: {
          label: string;
          unit: string;
          origin: AnalyticsDataOrigin;
          formula: string | null;
        };
      }
    | undefined,
) {
  if (!snapshot) return null;
  return {
    value:
      snapshot.status === AnalyticsSnapshotStatus.AVAILABLE &&
      snapshot.value !== null
        ? Number(snapshot.value)
        : null,
    status: snapshot.status,
    reasonCode: snapshot.reasonCode,
    origin: snapshot.origin,
    capturedAt: snapshot.capturedAt,
    timezone: snapshot.syncRun.timezone,
    syncStatus: snapshot.syncRun.status,
    definition: snapshot.metricDefinition,
  };
}

function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}

class PermanentAnalyticsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
class RetryableAnalyticsError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
