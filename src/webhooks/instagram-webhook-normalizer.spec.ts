import {
  normalizeMetaWebhook,
  normalizeMockWebhook,
} from "./instagram-webhook-normalizer";

describe("Instagram webhook normalization", () => {
  it("generates a stable idempotency key per event and Instagram account", () => {
    const event = {
      object: "instagram",
      entry: [
        {
          id: "account-1",
          time: 1_800_000_000,
          changes: [{ field: "comments", value: { id: "comment-1" } }],
        },
      ],
    };
    const repeatedEvent = {
      object: "instagram",
      entry: [
        {
          id: "account-1",
          time: 1_800_000_000,
          changes: [{ value: { id: "comment-1" }, field: "comments" }],
        },
      ],
    };
    const otherAccountEvent = {
      object: "instagram",
      entry: [
        {
          id: "account-2",
          time: 1_800_000_000,
          changes: [{ field: "comments", value: { id: "comment-1" } }],
        },
      ],
    };

    const [first] = normalizeMetaWebhook(event, false);
    const [repeated] = normalizeMetaWebhook(repeatedEvent, false);
    const [otherAccount] = normalizeMetaWebhook(otherAccountEvent, false);

    expect(first.dedupeKey).toBe(repeated.dedupeKey);
    expect(otherAccount.dedupeKey).not.toBe(first.dedupeKey);
    expect(first.normalizedPayload).toEqual({
      object: "instagram",
      entryId: "account-1",
      eventTimestamp: 1_800_000_000,
      field: "comments",
      text: null,
      commentId: "comment-1",
      messageId: null,
      senderId: null,
      mediaId: null,
      conversationId: null,
    });
    expect(first.rawPayload).toBeUndefined();
  });

  it("stores raw MOCK payload only when enabled and strips secret-like keys", () => {
    const input = {
      eventType: "instagram.messaging",
      externalEventId: "mock-event-1",
      data: {
        text: "hello",
        access_token: "must-not-be-stored",
        nested: { password: "also-private", safe: true },
      },
    };

    const disabled = normalizeMockWebhook(input, false);
    const enabled = normalizeMockWebhook(input, true);

    expect(disabled.rawPayload).toBeUndefined();
    expect(enabled.rawPayload).toEqual({
      eventType: "instagram.messaging",
      externalEventId: "mock-event-1",
      entryId: null,
      field: null,
      eventTimestamp: null,
      data: {
        text: "hello",
        nested: { safe: true },
      },
    });
  });

  it("normalizes only allowlisted comment/message fields", () => {
    const [comment] = normalizeMetaWebhook(
      {
        object: "instagram",
        entry: [
          {
            id: "ig-account",
            time: 1_800_000_000,
            changes: [
              {
                field: "comments",
                value: {
                  id: "c-1",
                  text: "Hello launch",
                  from: { id: "person-1" },
                  access_token: "secret",
                },
              },
            ],
          },
        ],
      },
      false,
    );
    expect(comment.normalizedPayload).toMatchObject({
      entryId: "ig-account",
      field: "comments",
      text: "Hello launch",
      commentId: "c-1",
      senderId: "person-1",
    });
    expect(JSON.stringify(comment.normalizedPayload)).not.toContain("secret");
  });
});
