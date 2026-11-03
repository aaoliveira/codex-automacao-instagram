import { ConfigService } from "@nestjs/config";
import { InstagramAutomationProviderError } from "./instagram-automation-provider";
import { MetaInstagramAutomationProvider } from "./meta-instagram-automation.provider";

describe("MetaInstagramAutomationProvider", () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
  const provider = new MetaInstagramAutomationProvider({
    getOrThrow: jest.fn().mockReturnValue("v25.0"),
  } as unknown as ConfigService);
  const account = {
    externalAccountId: "17841400000000000",
    accessToken: "secret-instagram-token",
  };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("sends a response to one user supplied recipient through the documented Send API", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message_id: "message-response-id" }),
    );

    await expect(
      provider.sendMessage(account, "customer-ig-scoped-id", "Thanks!"),
    ).resolves.toEqual({ externalId: "message-response-id" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.instagram.com/v25.0/17841400000000000/messages",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${account.accessToken}`,
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      recipient: { id: "customer-ig-scoped-id" },
      message: { text: "Thanks!" },
    });
    expect(String(url)).not.toContain(account.accessToken);
  });

  it("replies only to the supplied comment through its replies edge", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "comment-reply-id" }));

    await expect(
      provider.replyComment(account, "incoming-comment-id", "Thank you!"),
    ).resolves.toEqual({ externalId: "comment-reply-id" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.instagram.com/v25.0/incoming-comment-id/replies",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      message: "Thank you!",
    });
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${account.accessToken}`,
    });
  });

  it("normalizes provider errors without exposing response details or credentials", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 10,
            is_transient: false,
            message: "provider detail must not escape",
          },
        },
        403,
      ),
    );

    let captured: unknown;
    try {
      await provider.sendMessage(account, "customer-id", "Reply");
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InstagramAutomationProviderError);
    expect(captured).toMatchObject({ code: "META_10", retryable: false });
    expect((captured as Error).message).not.toContain("provider detail");
    expect(JSON.stringify(captured)).not.toContain(account.accessToken);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
