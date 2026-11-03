import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditRecord } from './audit-record';

const SAFE_METADATA_VALUES: Record<string, RegExp> = {
  role: /^(OWNER|ADMIN|MEMBER)$/,
  previousRole: /^(OWNER|ADMIN|MEMBER)$/,
  nextRole: /^(OWNER|ADMIN|MEMBER)$/,
  mediaType: /^(PHOTO|VIDEO|REEL)$/,
  triggerType: /^(COMMENT_RECEIVED|MESSAGE_RECEIVED|WEBHOOK_EVENT_RECEIVED)$/,
  provider: /^(MOCK|META)$/,
  level: /^(VIEW|MANAGE)$/,
  result: /^(SUCCESS|FAILED|SKIPPED|PUBLISHED|QUEUED|CANCELED)$/,
  reason: /^(invalid_credentials|organization_not_available|authorization_denied)$/,
  status: /^(COMPLETED|PARTIAL|FAILED|QUEUED|PROCESSING)$/,
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditRecord): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          organizationId: event.organizationId ?? null,
          userId: event.userId ?? null,
          action: safeIdentifier(event.action, 100),
          resourceType: event.resourceType ? safeIdentifier(event.resourceType, 64) : null,
          resourceId: event.resourceId ? safeIdentifier(event.resourceId, 255) : null,
          outcome: event.outcome ?? 'SUCCESS',
          correlationId: safeCorrelationId(event.correlationId),
          metadata: toSafeMetadata(event.metadata),
        },
      });
    } catch {
      // Audit persistence must not change a completed product operation; only safe event labels are logged.
      this.logger.error({ action: event.action, correlationId: safeCorrelationId(event.correlationId) }, 'Audit record could not be persisted');
    }
  }

  async list(
    organizationId: string,
    query: { page: number; pageSize: number; action?: string; userId?: string },
  ) {
    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          organizationId: true,
          userId: true,
          action: true,
          resourceType: true,
          resourceId: true,
          outcome: true,
          correlationId: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
}

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);
  private readonly auditRetentionDays: number;
  private readonly webhookRetentionDays: number;
  private readonly analyticsRetentionDays: number;
  private readonly cleanupIntervalMs: number;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.auditRetentionDays = Number(config.get('AUDIT_LOG_RETENTION_DAYS', 365));
    this.webhookRetentionDays = Number(config.get('WEBHOOK_EVENT_RETENTION_DAYS', 365));
    this.analyticsRetentionDays = Number(config.get('ANALYTICS_RETENTION_DAYS', 365));
    this.cleanupIntervalMs = Number(config.get('RETENTION_CLEANUP_INTERVAL_MS', 86_400_000));
  }

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.runRetentionCleanup().catch(() => {
        this.logger.error('Scheduled retention cleanup failed');
      });
    }, this.cleanupIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runRetentionCleanup(now = new Date()) {
    const auditCutoff = new Date(now.getTime() - this.auditRetentionDays * 86_400_000);
    const webhookCutoff = new Date(now.getTime() - this.webhookRetentionDays * 86_400_000);
    const analyticsCutoff = new Date(now.getTime() - this.analyticsRetentionDays * 86_400_000);
    const [auditLogs, webhookEvents, analyticsRetention] = await Promise.all([
      this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
      this.prisma.webhookEvent.deleteMany({ where: { receivedAt: { lt: webhookCutoff } } }),
      this.prisma.$transaction(async (tx) => {
        const snapshots = await tx.publicationInsightSnapshot.deleteMany({ where: { capturedAt: { lt: analyticsCutoff } } });
        const syncRuns = await tx.analyticsSyncRun.deleteMany({ where: { createdAt: { lt: analyticsCutoff } } });
        return { snapshots, syncRuns };
      }),
    ]);
    return {
      auditLogsDeleted: auditLogs.count,
      webhookEventsDeleted: webhookEvents.count,
      analyticsSnapshotsDeleted: analyticsRetention.snapshots.count,
      analyticsSyncRunsDeleted: analyticsRetention.syncRuns.count,
      auditRetentionDays: this.auditRetentionDays,
      webhookRetentionDays: this.webhookRetentionDays,
      analyticsRetentionDays: this.analyticsRetentionDays,
    };
  }
}

function toSafeMetadata(value?: Record<string, unknown> | null): Prisma.InputJsonObject | undefined {
  if (!value) return undefined;
  const safe: Record<string, string | number | boolean> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (key === 'statusCode' && typeof candidate === 'number' && candidate >= 100 && candidate <= 599) {
      safe[key] = candidate;
      continue;
    }
    if (['requestedCount', 'succeededCount', 'failedCount'].includes(key) && typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 0 && candidate <= 50_000) {
      safe[key] = candidate;
      continue;
    }
    const allowedValue = SAFE_METADATA_VALUES[key];
    if (allowedValue && typeof candidate === 'string' && allowedValue.test(candidate)) {
      safe[key] = candidate;
    }
  }
  return safe;
}

function safeIdentifier(value: string, maxLength: number): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, maxLength) || 'unknown';
}

function safeCorrelationId(value?: string | null): string | null {
  return value && /^[a-zA-Z0-9._-]{1,64}$/.test(value) ? value : null;
}

