import { Logger } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { Processor, WorkerHost } from "@nestjs/bullmq";
import {
  AutomationActionStatus,
  AutomationActionType,
  AutomationExecutionStatus,
  AutomationTriggerType,
  InstagramAccountStatus,
  InstagramProviderType,
  Prisma,
  WebhookEventStatus,
} from "@prisma/client";
import { Job } from "bullmq";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { TokenEncryptionService } from "../instagram/token-encryption.service";
import {
  InstagramAutomationProvider,
  InstagramAutomationProviderError,
} from "./instagram-automation-provider";
import {
  MAX_AUTOMATION_ACTIONS_PER_RULE,
  MAX_AUTOMATION_RULE_EXECUTIONS_PER_EVENT,
  MESSAGE_RESPONSE_WINDOW_MS,
  INSTAGRAM_AUTOMATION_QUEUE,
  AUTOMATION_PROVIDER,
} from "./automation.constants";
import { AUTOMATION_WORKER_CONCURRENCY } from "../shared/queue-runtime-config";
import {
  AutomationAction,
  AutomationConditionField,
  AutomationConditions,
  evaluateAutomationConditions,
  isAutomationActions,
  isAutomationConditions,
} from "./automation-rule.schema";

interface AutomationJobData {
  eventId: string;
  ruleId?: string;
}
type SafeEvent = {
  object: string | null;
  entryId: string | null;
  eventTimestamp: number | null;
  field: string | null;
  text: string | null;
  commentId: string | null;
  messageId: string | null;
  senderId: string | null;
  mediaId: string | null;
  conversationId: string | null;
};

@Processor(INSTAGRAM_AUTOMATION_QUEUE, {
  concurrency: AUTOMATION_WORKER_CONCURRENCY,
  lockDuration: 30_000,
})
export class AutomationEngineProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationEngineProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: TokenEncryptionService,
    @Inject(AUTOMATION_PROVIDER)
    private readonly provider: InstagramAutomationProvider,
    private readonly audit: AuditService,
  ) {
    super();
  }

  async process(job: Job<AutomationJobData>): Promise<void> {
    const event = await this.prisma.webhookEvent.findUnique({
      where: { id: job.data.eventId },
    });
    if (!event) return;
    const normalized = parseSafeEvent(event.normalizedPayload);
    if (!normalized.entryId) {
      await this.markEventProcessed(event.id);
      return;
    }
    const accounts = await this.prisma.instagramAccount.findMany({
      where: {
        externalAccountId: normalized.entryId,
        status: InstagramAccountStatus.CONNECTED,
        provider: event.provider as unknown as InstagramProviderType,
      },
      orderBy: [{ organizationId: "asc" }, { id: "asc" }],
    });
    if (accounts.length === 0) {
      await this.markEventProcessed(event.id);
      return;
    }

    let executions = 0;
    for (const account of accounts) {
      if (executions >= MAX_AUTOMATION_RULE_EXECUTIONS_PER_EVENT) break;
      const rules = await this.prisma.automationRule.findMany({
        where: {
          organizationId: account.organizationId,
          instagramAccountId: account.id,
          active: true,
          deletedAt: null,
          ...(job.data.ruleId ? { id: job.data.ruleId } : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: MAX_AUTOMATION_RULE_EXECUTIONS_PER_EVENT - executions,
      });
      for (const rule of rules) {
        if (executions >= MAX_AUTOMATION_RULE_EXECUTIONS_PER_EVENT) break;
        await this.processRule(event, normalized, account, rule);
        executions += 1;
      }
    }
    await this.markEventProcessed(event.id);
  }

  private markEventProcessed(eventId: string) {
    return this.prisma.webhookEvent.updateMany({
      where: {
        id: eventId,
        status: {
          in: [WebhookEventStatus.QUEUED, WebhookEventStatus.RECEIVED],
        },
      },
      data: { status: WebhookEventStatus.PROCESSED, processedAt: new Date() },
    });
  }

  private async processRule(
    event: { id: string; eventType: string },
    normalized: SafeEvent,
    account: {
      id: string;
      organizationId: string;
      provider: InstagramProviderType;
      externalAccountId: string | null;
      encryptedAccessToken: string | null;
      accessTokenIv: string | null;
      accessTokenTag: string | null;
    },
    rule: {
      id: string;
      organizationId: string;
      instagramAccountId: string;
      triggerType: AutomationTriggerType;
      conditions: Prisma.JsonValue;
      actions: Prisma.JsonValue;
    },
  ) {
    let execution;
    try {
      execution = await this.prisma.automationExecution.create({
        data: {
          organizationId: rule.organizationId,
          instagramAccountId: account.id,
          automationRuleId: rule.id,
          webhookEventId: event.id,
          status: AutomationExecutionStatus.PROCESSING,
        },
      });
    } catch (error) {
      if (isUniqueConstraint(error)) return;
      throw error;
    }

    if (!triggerMatches(rule.triggerType, event.eventType, normalized.field)) {
      await this.finishExecution(
        execution.id,
        AutomationExecutionStatus.SKIPPED,
        "TRIGGER_NOT_MATCHED",
        rule.organizationId,
        rule.id,
      );
      return;
    }
    if (
      !isAutomationConditions(rule.conditions) ||
      !isAutomationActions(rule.actions)
    ) {
      await this.finishExecution(
        execution.id,
        AutomationExecutionStatus.FAILED,
        "RULE_SCHEMA_INVALID",
        rule.organizationId,
        rule.id,
      );
      return;
    }
    if (
      normalized.senderId &&
      normalized.senderId === account.externalAccountId
    ) {
      await this.finishExecution(
        execution.id,
        AutomationExecutionStatus.SKIPPED,
        "SELF_EVENT_LOOP_GUARD",
        rule.organizationId,
        rule.id,
      );
      return;
    }
    const conditions = rule.conditions as AutomationConditions;
    if (
      !evaluateAutomationConditions(
        conditions,
        conditionValues(event.eventType, normalized),
      )
    ) {
      await this.finishExecution(
        execution.id,
        AutomationExecutionStatus.SKIPPED,
        "CONDITIONS_NOT_MET",
        rule.organizationId,
        rule.id,
      );
      return;
    }

    const actions = (rule.actions as AutomationAction[]).slice(
      0,
      MAX_AUTOMATION_ACTIONS_PER_RULE,
    );
    let completed = 0;
    let skipped = 0;
    try {
      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index];
        const actionResult = await this.executeAction({
          executionId: execution.id,
          organizationId: rule.organizationId,
          ruleId: rule.id,
          eventId: event.id,
          account,
          eventType: event.eventType,
          normalized,
          action,
          actionIndex: index,
        });
        if (actionResult === "FAILED") {
          await this.finishExecution(
            execution.id,
            AutomationExecutionStatus.FAILED,
            "ACTION_FAILED",
            rule.organizationId,
            rule.id,
          );
          return;
        }
        if (actionResult === "SKIPPED") skipped += 1;
        else completed += 1;
      }
      if (completed === 0 && skipped > 0) {
        await this.finishExecution(
          execution.id,
          AutomationExecutionStatus.SKIPPED,
          "DUPLICATE_EFFECT",
          rule.organizationId,
          rule.id,
        );
        return;
      }
      await this.prisma.automationExecution.update({
        where: { id: execution.id },
        data: {
          status: AutomationExecutionStatus.SUCCESS,
          result: {
            completedActions: completed,
            skippedActions: skipped,
          } as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      await this.recordExecutionAudit(rule.organizationId, rule.id, AutomationExecutionStatus.SUCCESS);
    } catch {
      await this.finishExecution(
        execution.id,
        AutomationExecutionStatus.FAILED,
        "EXECUTION_FAILED",
        rule.organizationId,
        rule.id,
      );
    }
  }

  private async executeAction(input: {
    executionId: string;
    organizationId: string;
    ruleId: string;
    eventId: string;
    account: {
      id: string;
      provider: InstagramProviderType;
      externalAccountId: string | null;
      encryptedAccessToken: string | null;
      accessTokenIv: string | null;
      accessTokenTag: string | null;
    };
    eventType: string;
    normalized: SafeEvent;
    action: AutomationAction;
    actionIndex: number;
  }): Promise<"SUCCESS" | "SKIPPED" | "FAILED"> {
    const { action, actionIndex, account } = input;
    const idempotencyKey = hash(`${input.executionId}:${actionIndex}`);
    const effectKey =
      action.type === AutomationActionType.REPLY_COMMENT &&
      input.normalized.commentId
        ? hash(
            `comment-reply:${account.provider}:${account.externalAccountId}:${input.normalized.commentId}`,
          )
        : action.type === AutomationActionType.SEND_MESSAGE
          ? hash(
              `message-response:${account.provider}:${account.externalAccountId}:${input.normalized.messageId ?? input.eventId}`,
            )
          : null;
    let actionExecution;
    try {
      actionExecution = await this.prisma.automationActionExecution.create({
        data: {
          organizationId: input.organizationId,
          automationExecutionId: input.executionId,
          actionIndex,
          actionType: action.type,
          idempotencyKey,
          effectKey,
          status: AutomationActionStatus.PROCESSING,
        },
      });
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error;
      if (
        effectKey &&
        !(await this.prisma.automationActionExecution.findUnique({
          where: { effectKey },
          select: { id: true },
        }))
      )
        throw error;
      await this.createSkippedAction(
        input,
        idempotencyKey,
        effectKey ? null : effectKey,
        "DUPLICATE_EFFECT",
      );
      return "SKIPPED";
    }

    try {
      let result: Record<string, unknown> = {};
      if (action.type === AutomationActionType.REGISTER_EVENT) {
        result = { webhookEventId: input.eventId };
      } else if (action.type === AutomationActionType.TAG_CONTACT) {
        if (!input.normalized.senderId)
          throw new SafeActionError("CONTACT_ID_MISSING");
        await this.prisma.automationContactTag.upsert({
          where: {
            organizationId_instagramAccountId_externalContactId_tag: {
              organizationId: input.organizationId,
              instagramAccountId: account.id,
              externalContactId: input.normalized.senderId,
              tag: action.tag,
            },
          },
          create: {
            organizationId: input.organizationId,
            instagramAccountId: account.id,
            automationRuleId: input.ruleId,
            externalContactId: input.normalized.senderId,
            tag: action.tag,
          },
          update: {},
        });
        result = { tagged: true };
      } else if (action.type === AutomationActionType.NOTIFY_OPERATOR) {
        const notification = await this.prisma.automationNotification.upsert({
          where: {
            automationRuleId_webhookEventId_actionIndex: {
              automationRuleId: input.ruleId,
              webhookEventId: input.eventId,
              actionIndex,
            },
          },
          create: {
            organizationId: input.organizationId,
            instagramAccountId: account.id,
            automationRuleId: input.ruleId,
            webhookEventId: input.eventId,
            actionIndex,
            message: action.message,
          },
          update: {},
          select: { id: true },
        });
        result = { notificationId: notification.id };
      } else {
        if (account.provider !== this.provider.type)
          throw new SafeActionError("PROVIDER_MISMATCH");
        const accessToken = this.readAccountToken(account);
        const providerAccount = {
          externalAccountId: account.externalAccountId!,
          accessToken,
        };
        let sent;
        if (action.type === AutomationActionType.REPLY_COMMENT) {
          if (
            input.eventType !== "instagram.change" ||
            input.normalized.field !== "comments" ||
            !input.normalized.commentId
          )
            throw new SafeActionError("COMMENT_REPLY_UNSUPPORTED_FOR_EVENT");
          sent = await this.provider.replyComment(
            providerAccount,
            input.normalized.commentId,
            action.text,
          );
        } else {
          if (
            input.eventType !== "instagram.messaging" ||
            !input.normalized.senderId ||
            input.normalized.senderId === account.externalAccountId
          )
            throw new SafeActionError("MESSAGE_RECIPIENT_NOT_ALLOWED");
          const timestamp = input.normalized.eventTimestamp;
          const age =
            timestamp === null
              ? Number.POSITIVE_INFINITY
              : Date.now() - normalizeTimestamp(timestamp);
          if (age < -5 * 60_000 || age > MESSAGE_RESPONSE_WINDOW_MS)
            throw new SafeActionError("MESSAGE_RESPONSE_WINDOW_EXPIRED");
          sent = await this.provider.sendMessage(
            providerAccount,
            input.normalized.senderId,
            action.text,
          );
        }
        result = { externalId: sent.externalId };
      }
      await this.prisma.automationActionExecution.update({
        where: { id: actionExecution.id },
        data: {
          status: AutomationActionStatus.SUCCESS,
          result: result as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      return "SUCCESS";
    } catch (error) {
      const code =
        error instanceof SafeActionError
          ? error.code
          : error instanceof InstagramAutomationProviderError
            ? error.code
            : "ACTION_FAILED";
      await this.prisma.automationActionExecution.update({
        where: { id: actionExecution.id },
        data: {
          status: AutomationActionStatus.FAILED,
          errorCode: code,
          finishedAt: new Date(),
        },
      });
      this.logger.warn(`Automation action failed (${code})`);
      return "FAILED";
    }
  }

  private async createSkippedAction(
    input: {
      executionId: string;
      organizationId: string;
      action: AutomationAction;
      actionIndex: number;
    },
    idempotencyKey: string,
    effectKey: string | null,
    code: string,
  ) {
    await this.prisma.automationActionExecution.create({
      data: {
        organizationId: input.organizationId,
        automationExecutionId: input.executionId,
        actionIndex: input.actionIndex,
        actionType: input.action.type,
        idempotencyKey,
        effectKey,
        status: AutomationActionStatus.SKIPPED,
        errorCode: code,
        finishedAt: new Date(),
      },
    });
  }

  private readAccountToken(account: {
    externalAccountId: string | null;
    encryptedAccessToken: string | null;
    accessTokenIv: string | null;
    accessTokenTag: string | null;
  }) {
    if (
      !account.externalAccountId ||
      !account.encryptedAccessToken ||
      !account.accessTokenIv ||
      !account.accessTokenTag
    ) {
      throw new SafeActionError("ACCOUNT_CREDENTIALS_UNAVAILABLE");
    }
    return this.encryption.decrypt({
      ciphertext: account.encryptedAccessToken,
      iv: account.accessTokenIv,
      tag: account.accessTokenTag,
    });
  }

  private async finishExecution(
    id: string,
    status: AutomationExecutionStatus,
    errorCode: string,
    organizationId: string,
    ruleId: string,
  ) {
    await this.prisma.automationExecution.update({
      where: { id },
      data: {
        status,
        errorCode,
        result: { reason: errorCode } as Prisma.InputJsonValue,
        finishedAt: new Date(),
      },
    });
    await this.recordExecutionAudit(organizationId, ruleId, status);
  }

  private recordExecutionAudit(
    organizationId: string,
    ruleId: string,
    status: AutomationExecutionStatus,
  ) {
    return this.audit.record({
      organizationId,
      action: `AUTOMATION_EXECUTION_${status}`,
      resourceType: "automation_rule",
      resourceId: ruleId,
      metadata: { result: status },
    });
  }
}

class SafeActionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function triggerMatches(
  trigger: AutomationTriggerType,
  eventType: string,
  field: string | null,
) {
  if (trigger === AutomationTriggerType.WEBHOOK_EVENT_RECEIVED) return true;
  if (trigger === AutomationTriggerType.MESSAGE_RECEIVED)
    return eventType === "instagram.messaging";
  return eventType === "instagram.change" && field === "comments";
}

function conditionValues(
  eventType: string,
  event: SafeEvent,
): Record<AutomationConditionField, string | null> {
  return {
    text: event.text,
    eventType,
    field: event.field,
    senderId: event.senderId,
    commentId: event.commentId,
    mediaId: event.mediaId,
    conversationId: event.conversationId,
  };
}

function parseSafeEvent(value: Prisma.JsonValue): SafeEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      object: null,
      entryId: null,
      eventTimestamp: null,
      field: null,
      text: null,
      commentId: null,
      messageId: null,
      senderId: null,
      mediaId: null,
      conversationId: null,
    };
  }
  const record = value as Record<string, unknown>;
  return {
    object: safeString(record.object),
    entryId: safeString(record.entryId),
    eventTimestamp:
      typeof record.eventTimestamp === "number" ? record.eventTimestamp : null,
    field: safeString(record.field),
    text: safeString(record.text),
    commentId: safeString(record.commentId),
    messageId: safeString(record.messageId),
    senderId: safeString(record.senderId),
    mediaId: safeString(record.mediaId),
    conversationId: safeString(record.conversationId),
  };
}

function safeString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function normalizeTimestamp(value: number) {
  return value < 100_000_000_000 ? value * 1_000 : value;
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function isUniqueConstraint(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}
