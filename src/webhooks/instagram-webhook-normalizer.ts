import { createHash } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { Prisma, WebhookProvider } from "@prisma/client";
import { MockInstagramWebhookDto } from "./dto/mock-instagram-webhook.dto";

export interface NormalizedWebhookEvent {
  provider: WebhookProvider;
  externalEventId: string | null;
  dedupeKey: string;
  eventType: string;
  normalizedPayload: Prisma.InputJsonObject;
  rawPayload?: Prisma.InputJsonValue;
}

type JsonRecord = Record<string, unknown>;

export function normalizeMetaWebhook(
  payload: unknown,
  storeRawPayload: boolean,
): NormalizedWebhookEvent[] {
  if (!isRecord(payload)) {
    throw new BadRequestException(
      "Instagram webhook payload must be an object",
    );
  }

  const rootObject = asString(payload.object);
  const entries = Array.isArray(payload.entry)
    ? payload.entry.filter(isRecord)
    : [];
  const events: NormalizedWebhookEvent[] = [];

  for (const entry of entries) {
    const entryId = asString(entry.id);
    const eventTimestamp = asNumber(entry.time);
    const changes = Array.isArray(entry.changes)
      ? entry.changes.filter(isRecord)
      : [];
    const messages = Array.isArray(entry.messaging)
      ? entry.messaging.filter(isRecord)
      : [];

    for (const change of changes) {
      const field = asString(change.field);
      events.push(
        createEvent({
          provider: WebhookProvider.META,
          eventType: "instagram.change",
          externalEventId: getExternalEventId(change),
          rootObject,
          entryId,
          eventTimestamp,
          field,
          fingerprint: { rootObject, entryId, eventTimestamp, change },
          rawPayload: change,
          automationFields: extractAutomationFields(change, "instagram.change"),
          storeRawPayload,
        }),
      );
    }

    for (const message of messages) {
      events.push(
        createEvent({
          provider: WebhookProvider.META,
          eventType: "instagram.messaging",
          externalEventId: getExternalEventId(message),
          rootObject,
          entryId,
          eventTimestamp: asNumber(message.timestamp) ?? eventTimestamp,
          field: null,
          fingerprint: {
            rootObject,
            entryId,
            eventTimestamp: asNumber(message.timestamp) ?? eventTimestamp,
            message,
          },
          rawPayload: message,
          automationFields: extractAutomationFields(
            message,
            "instagram.messaging",
          ),
          storeRawPayload,
        }),
      );
    }

    if (changes.length === 0 && messages.length === 0) {
      events.push(
        createEvent({
          provider: WebhookProvider.META,
          eventType: "instagram.unknown",
          externalEventId: getExternalEventId(entry),
          rootObject,
          entryId,
          eventTimestamp,
          field: null,
          fingerprint: { rootObject, entryId, eventTimestamp, entry },
          rawPayload: entry,
          automationFields: emptyAutomationFields(),
          storeRawPayload,
        }),
      );
    }
  }

  if (events.length === 0) {
    events.push(
      createEvent({
        provider: WebhookProvider.META,
        eventType: "instagram.unknown",
        externalEventId: getExternalEventId(payload),
        rootObject,
        entryId: null,
        eventTimestamp: asNumber(payload.time),
        field: asString(payload.field),
        fingerprint: payload,
        rawPayload: payload,
        automationFields: emptyAutomationFields(),
        storeRawPayload,
      }),
    );
  }

  return events;
}

export function normalizeMockWebhook(
  payload: MockInstagramWebhookDto,
  storeRawPayload: boolean,
): NormalizedWebhookEvent {
  const rawEvent = {
    eventType: payload.eventType,
    externalEventId: payload.externalEventId ?? null,
    entryId: payload.entryId ?? null,
    field: payload.field ?? null,
    eventTimestamp: payload.eventTimestamp ?? null,
    data: payload.data ?? null,
  };
  return createEvent({
    provider: WebhookProvider.MOCK,
    eventType: payload.eventType,
    externalEventId: payload.externalEventId ?? null,
    rootObject: "instagram",
    entryId: payload.entryId ?? null,
    eventTimestamp:
      payload.eventTimestamp ?? asNumber(asRecord(payload.data)?.timestamp),
    field: payload.field ?? null,
    fingerprint: rawEvent,
    rawPayload: rawEvent,
    automationFields: extractAutomationFields(rawEvent, payload.eventType),
    storeRawPayload,
  });
}

function createEvent(input: {
  provider: WebhookProvider;
  eventType: string;
  externalEventId: string | null;
  rootObject: string | null;
  entryId: string | null;
  eventTimestamp: number | null;
  field: string | null;
  fingerprint: unknown;
  rawPayload: unknown;
  automationFields: AutomationEventFields;
  storeRawPayload: boolean;
}): NormalizedWebhookEvent {
  const normalizedPayload: Prisma.InputJsonObject = {
    object: input.rootObject,
    entryId: input.entryId,
    eventTimestamp: input.eventTimestamp,
    field: input.field,
    ...input.automationFields,
  };
  const identity = input.externalEventId
    ? `external:${input.externalEventId}`
    : `payload:${stableStringify(input.fingerprint)}`;
  const dedupeKey = createHash("sha256")
    .update(`${input.provider}:${input.eventType}:${identity}`)
    .digest("hex");

  return {
    provider: input.provider,
    externalEventId: input.externalEventId,
    dedupeKey,
    eventType: input.eventType,
    normalizedPayload,
    ...(input.storeRawPayload
      ? { rawPayload: sanitizeRawPayload(input.rawPayload) }
      : {}),
  };
}

interface AutomationEventFields {
  text: string | null;
  commentId: string | null;
  messageId: string | null;
  senderId: string | null;
  mediaId: string | null;
  conversationId: string | null;
}

function emptyAutomationFields(): AutomationEventFields {
  return {
    text: null,
    commentId: null,
    messageId: null,
    senderId: null,
    mediaId: null,
    conversationId: null,
  };
}

function extractAutomationFields(
  value: unknown,
  eventType: string,
): AutomationEventFields {
  if (!isRecord(value)) return emptyAutomationFields();
  const data = asRecord(value.data) ?? {};
  const comment = asRecord(value.value) ?? value;
  const message = asRecord(value.message) ?? value;
  const sender =
    asRecord(comment.from) ??
    asRecord(value.sender) ??
    asRecord(message.sender) ??
    asRecord(value.from) ??
    {};
  const media = asRecord(comment.media) ?? asRecord(value.media) ?? {};
  const conversation = asRecord(value.conversation) ?? {};

  const normalized: AutomationEventFields = {
    text: boundedString(
      data.text ?? message.text ?? comment.text ?? value.text,
      5_000,
    ),
    commentId: boundedString(
      data.commentId ??
        data.comment_id ??
        comment.comment_id ??
        (eventType === "instagram.change" ? comment.id : null),
      255,
    ),
    messageId: boundedString(
      data.messageId ?? data.message_id ?? message.mid ?? message.id,
      255,
    ),
    senderId: boundedString(
      data.senderId ?? data.sender_id ?? sender.id ?? value.sender_id,
      255,
    ),
    mediaId: boundedString(
      data.mediaId ?? data.media_id ?? media.id ?? value.media_id,
      255,
    ),
    conversationId: boundedString(
      data.conversationId ??
        data.conversation_id ??
        conversation.id ??
        value.thread_id,
      255,
    ),
  };

  return normalized;
}

function getExternalEventId(value: JsonRecord): string | null {
  const id = asString(value.event_id);
  return id && id.length <= 255 ? id : null;
}

function sanitizeRawPayload(value: unknown): Prisma.InputJsonValue {
  return sanitizeJsonValue(value) ?? {};
}

function sanitizeJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeJsonValue(item),
    ) as Prisma.InputJsonArray;
  }
  if (isRecord(value)) {
    const sanitized: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/(token|secret|authorization|password)/i.test(key)) continue;
      sanitized[key] = sanitizeJsonValue(item);
    }
    return sanitized as Prisma.InputJsonObject;
  }
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  const result = asString(value);
  return result ? result.slice(0, maxLength) : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
