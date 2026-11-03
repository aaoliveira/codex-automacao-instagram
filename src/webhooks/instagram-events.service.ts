import { Injectable, NotFoundException } from "@nestjs/common";
import {
  InstagramAccount,
  InstagramProviderType,
  Prisma,
  WebhookEvent,
  WebhookEventStatus,
  WebhookProvider,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { InstagramEventsQueryDto } from "./dto/instagram-events-query.dto";

type EventAccount = Pick<
  InstagramAccount,
  "id" | "provider" | "externalAccountId" | "username" | "name"
>;

type PublicEvent = {
  id: string;
  provider: WebhookProvider;
  externalEventId: string | null;
  instagramAccountId: string;
  accountUsername: string | null;
  accountName: string | null;
  eventType: string;
  field: string | null;
  status: WebhookEventStatus;
  receivedAt: Date;
  processedAt: Date | null;
  error: string | null;
  normalizedPayload: {
    object: string | null;
    eventTimestamp: number | null;
    field: string | null;
  };
};

const PUBLIC_EVENT_SELECT = {
  id: true,
  provider: true,
  externalEventId: true,
  eventType: true,
  normalizedPayload: true,
  receivedAt: true,
  processedAt: true,
  status: true,
  error: true,
} satisfies Prisma.WebhookEventSelect;

@Injectable()
export class InstagramEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, query: InstagramEventsQueryDto) {
    if (query.accountId) {
      const selectedAccount = await this.prisma.instagramAccount.findFirst({
        where: { id: query.accountId, organizationId },
        select: { id: true },
      });
      if (!selectedAccount) throw new NotFoundException("Instagram account not found");
    }

    const accounts = await this.findAccounts(organizationId, query.accountId);
    const pageCount = (total: number) => Math.ceil(total / query.pageSize);
    if (accounts.length === 0) {
      return {
        items: [],
        page: query.page,
        pageSize: query.pageSize,
        total: 0,
        totalPages: 0,
      };
    }

    const where = this.createWhere(accounts, query);
    const [total, events] = await this.prisma.$transaction([
      this.prisma.webhookEvent.count({ where }),
      this.prisma.webhookEvent.findMany({
        where,
        select: PUBLIC_EVENT_SELECT,
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return {
      items: events.map((event) => this.toPublicEvent(event, accounts)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: pageCount(total),
    };
  }

  async get(organizationId: string, eventId: string) {
    const accounts = await this.findAccounts(organizationId);
    if (accounts.length === 0) throw new NotFoundException("Instagram event not found");

    const event = await this.prisma.webhookEvent.findFirst({
      where: {
        id: eventId,
        OR: this.accountEventFilters(accounts),
      },
      select: PUBLIC_EVENT_SELECT,
    });
    if (!event) throw new NotFoundException("Instagram event not found");
    return this.toPublicEvent(event, accounts);
  }

  private findAccounts(organizationId: string, accountId?: string) {
    return this.prisma.instagramAccount.findMany({
      where: {
        organizationId,
        externalAccountId: { not: null },
        ...(accountId ? { id: accountId } : {}),
      },
      select: {
        id: true,
        provider: true,
        externalAccountId: true,
        username: true,
        name: true,
      },
    });
  }

  private createWhere(
    accounts: EventAccount[],
    query: InstagramEventsQueryDto,
  ): Prisma.WebhookEventWhereInput {
    const where: Prisma.WebhookEventWhereInput = {
      OR: this.accountEventFilters(accounts),
    };

    if (query.status === "pending") {
      where.status = {
        in: [
          WebhookEventStatus.RECEIVED,
          WebhookEventStatus.QUEUED,
          WebhookEventStatus.PROCESSING,
        ],
      };
    } else if (query.status === "processed") {
      where.status = WebhookEventStatus.PROCESSED;
    } else if (query.status === "error") {
      where.status = WebhookEventStatus.FAILED;
    }

    if (query.type === "comments") {
      where.AND = [
        { eventType: "instagram.change" },
        { normalizedPayload: { path: ["field"], equals: "comments" } },
      ];
    } else if (query.type === "messages") {
      where.eventType = "instagram.messaging";
    } else if (query.type === "other") {
      where.eventType = { notIn: ["instagram.change", "instagram.messaging"] };
    }

    return where;
  }

  private accountEventFilters(accounts: EventAccount[]) {
    return accounts.flatMap((account) => {
      if (!account.externalAccountId) return [];
      return [
        {
          provider: this.toWebhookProvider(account.provider),
          normalizedPayload: {
            path: ["entryId"],
            equals: account.externalAccountId,
          },
        } satisfies Prisma.WebhookEventWhereInput,
      ];
    });
  }

  private toWebhookProvider(provider: InstagramProviderType): WebhookProvider {
    return provider === InstagramProviderType.META
      ? WebhookProvider.META
      : WebhookProvider.MOCK;
  }

  private toPublicEvent(
    event: Pick<
      WebhookEvent,
      | "id"
      | "provider"
      | "externalEventId"
      | "eventType"
      | "normalizedPayload"
      | "receivedAt"
      | "processedAt"
      | "status"
      | "error"
    >,
    accounts: EventAccount[],
  ): PublicEvent {
    const normalized = isJsonObject(event.normalizedPayload)
      ? event.normalizedPayload
      : {};
    const entryId = readString(normalized.entryId);
    const account = accounts.find(
      (candidate) =>
        candidate.externalAccountId === entryId &&
        this.toWebhookProvider(candidate.provider) === event.provider,
    );
    if (!account) throw new NotFoundException("Instagram event not found");

    const field = readString(normalized.field);
    return {
      id: event.id,
      provider: event.provider,
      externalEventId: event.externalEventId,
      instagramAccountId: account.id,
      accountUsername: account.username,
      accountName: account.name,
      eventType: event.eventType,
      field,
      status: event.status,
      receivedAt: event.receivedAt,
      processedAt: event.processedAt,
      error: event.status === WebhookEventStatus.FAILED && event.error
        ? "Event processing failed"
        : null,
      normalizedPayload: {
        object: readString(normalized.object),
        eventTimestamp: readNumber(normalized.eventTimestamp),
        field,
      },
    };
  }
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Prisma.JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}
