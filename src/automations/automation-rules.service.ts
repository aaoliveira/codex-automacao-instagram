import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
  AutomationExecutionStatus,
  AutomationTriggerType,
  InstagramAccountStatus,
  InstagramProviderType,
  Prisma,
  WebhookEventStatus,
} from "@prisma/client";
import { Queue } from "bullmq";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  AutomationExecutionListQueryDto,
  AutomationNotificationsQueryDto,
  CreateAutomationRuleDto,
  SimulateAutomationEventDto,
  UpdateAutomationRuleDto,
} from "./dto/automation-rule.dto";
import {
  INSTAGRAM_AUTOMATION_JOB,
  INSTAGRAM_AUTOMATION_QUEUE,
} from "./automation.constants";
import { normalizeMockWebhook } from "../webhooks/instagram-webhook-normalizer";

interface AutomationJobData {
  eventId: string;
  ruleId?: string;
}

@Injectable()
export class AutomationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(INSTAGRAM_AUTOMATION_QUEUE)
    private readonly queue: Queue<AutomationJobData>,
  ) {}

  async create(organizationId: string, dto: CreateAutomationRuleDto) {
    const account = await this.prisma.instagramAccount.findFirst({
      where: {
        id: dto.instagramAccountId,
        organizationId,
        status: InstagramAccountStatus.CONNECTED,
      },
      select: { id: true },
    });
    if (!account)
      throw new NotFoundException("Connected Instagram account not found");
    return this.prisma.automationRule.create({
      data: {
        organizationId,
        instagramAccountId: account.id,
        name: dto.name.trim(),
        active: dto.active ?? true,
        triggerType: dto.triggerType,
        conditions: dto.conditions as Prisma.InputJsonValue,
        actions: dto.actions as Prisma.InputJsonValue,
      },
    });
  }

  list(organizationId: string, instagramAccountId?: string) {
    return this.prisma.automationRule.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(instagramAccountId ? { instagramAccountId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
  }

  async get(organizationId: string, ruleId: string) {
    const rule = await this.prisma.automationRule.findFirst({
      where: { id: ruleId, organizationId, deletedAt: null },
    });
    if (!rule) throw new NotFoundException("Automation rule not found");
    return rule;
  }

  async update(
    organizationId: string,
    ruleId: string,
    dto: UpdateAutomationRuleDto,
  ) {
    await this.get(organizationId, ruleId);
    if (dto.instagramAccountId) {
      const account = await this.prisma.instagramAccount.findFirst({
        where: {
          id: dto.instagramAccountId,
          organizationId,
          status: InstagramAccountStatus.CONNECTED,
        },
        select: { id: true },
      });
      if (!account)
        throw new NotFoundException("Connected Instagram account not found");
    }
    return this.prisma.automationRule.update({
      where: { id: ruleId, organizationId },
      data: {
        ...(dto.instagramAccountId
          ? { instagramAccountId: dto.instagramAccountId }
          : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.triggerType ? { triggerType: dto.triggerType } : {}),
        ...(dto.conditions !== undefined
          ? { conditions: dto.conditions as Prisma.InputJsonValue }
          : {}),
        ...(dto.actions !== undefined
          ? { actions: dto.actions as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  async delete(organizationId: string, ruleId: string) {
    await this.get(organizationId, ruleId);
    await this.prisma.automationRule.update({
      where: { id: ruleId, organizationId },
      data: { active: false, deletedAt: new Date() },
    });
    return { deleted: true };
  }

  async simulate(
    organizationId: string,
    ruleId: string,
    dto: SimulateAutomationEventDto,
  ) {
    const rule = await this.get(organizationId, ruleId);
    if (!rule.active)
      throw new ConflictException("Automation rule is inactive");
    const account = await this.prisma.instagramAccount.findFirst({
      where: {
        id: rule.instagramAccountId,
        organizationId,
        status: InstagramAccountStatus.CONNECTED,
      },
      select: { id: true, provider: true, externalAccountId: true },
    });
    if (!account)
      throw new NotFoundException("Connected Instagram account not found");
    if (account.provider !== InstagramProviderType.MOCK)
      throw new BadRequestException(
        "Simulation is available only for MOCK accounts",
      );
    if (!this.triggerMatches(rule.triggerType, dto.eventType, dto.field)) {
      throw new BadRequestException(
        "Simulated event does not match this rule trigger",
      );
    }

    const normalized = normalizeMockWebhook(
      {
        eventType: dto.eventType,
        externalEventId: dto.externalEventId
          ? `sim:${account.id}:${createHash("sha256").update(dto.externalEventId).digest("hex")}`
          : undefined,
        entryId: account.externalAccountId ?? account.id,
        field:
          dto.field ??
          (dto.eventType === "instagram.change" ? "comments" : undefined),
        eventTimestamp: dto.eventTimestamp,
        data: dto.data,
      },
      false,
    );
    let event;
    let duplicate = false;
    try {
      event = await this.prisma.webhookEvent.create({
        data: {
          provider: normalized.provider,
          externalEventId: normalized.externalEventId,
          dedupeKey: normalized.dedupeKey,
          eventType: normalized.eventType,
          normalizedPayload: normalized.normalizedPayload,
          rawPayload: Prisma.DbNull,
          status: WebhookEventStatus.QUEUED,
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      )
        throw error;
      duplicate = true;
      event = await this.prisma.webhookEvent.findFirst({
        where: {
          provider: normalized.provider,
          OR: [
            { dedupeKey: normalized.dedupeKey },
            ...(normalized.externalEventId
              ? [{ externalEventId: normalized.externalEventId }]
              : []),
          ],
        },
      });
      if (!event) throw error;
      const existing = await this.prisma.automationExecution.findFirst({
        where: {
          organizationId,
          automationRuleId: rule.id,
          webhookEventId: event.id,
        },
        select: { id: true, status: true },
      });
      if (existing)
        return {
          eventId: event.id,
          executionId: existing.id,
          status: existing.status,
          duplicate: true,
        };
    }

    try {
      await this.queue.add(
        INSTAGRAM_AUTOMATION_JOB,
        { eventId: event.id, ruleId: rule.id },
        {
          jobId: `${event.id}-${rule.id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: { count: 2_000 },
          removeOnFail: { count: 2_000 },
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Automation simulation could not be queued",
      );
    }
    return {
      eventId: event.id,
      ruleId: rule.id,
      status: AutomationExecutionStatus.PROCESSING,
      duplicate,
    };
  }

  async listExecutions(
    organizationId: string,
    query: AutomationExecutionListQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.AutomationExecutionWhereInput = {
      organizationId,
      ...(query.instagramAccountId
        ? { instagramAccountId: query.instagramAccountId }
        : {}),
      ...(query.ruleId ? { automationRuleId: query.ruleId } : {}),
      ...(query.webhookEventId ? { webhookEventId: query.webhookEventId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.automationExecution.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          automationRule: { select: { id: true, name: true } },
          actionExecutions: { orderBy: { actionIndex: "asc" } },
        },
      }),
      this.prisma.automationExecution.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async getExecution(organizationId: string, executionId: string) {
    const execution = await this.prisma.automationExecution.findFirst({
      where: { id: executionId, organizationId },
      include: {
        automationRule: { select: { id: true, name: true } },
        actionExecutions: { orderBy: { actionIndex: "asc" } },
        webhookEvent: {
          select: {
            id: true,
            provider: true,
            eventType: true,
            receivedAt: true,
            processedAt: true,
            status: true,
          },
        },
      },
    });
    if (!execution)
      throw new NotFoundException("Automation execution not found");
    return execution;
  }

  listNotifications(
    organizationId: string,
    query: AutomationNotificationsQueryDto,
  ) {
    return this.prisma.automationNotification.findMany({
      where: {
        organizationId,
        ...(query.instagramAccountId
          ? { instagramAccountId: query.instagramAccountId }
          : {}),
        ...(query.ruleId ? { automationRuleId: query.ruleId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
      select: {
        id: true,
        instagramAccountId: true,
        automationRuleId: true,
        webhookEventId: true,
        message: true,
        createdAt: true,
        readAt: true,
      },
    });
  }

  private triggerMatches(
    trigger: AutomationTriggerType,
    eventType: string,
    field?: string,
  ) {
    if (trigger === AutomationTriggerType.WEBHOOK_EVENT_RECEIVED) return true;
    if (trigger === AutomationTriggerType.MESSAGE_RECEIVED)
      return eventType === "instagram.messaging";
    return eventType === "instagram.change" && field === "comments";
  }
}
