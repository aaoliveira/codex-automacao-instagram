import { MockInstagramAutomationProvider } from "./mock-instagram-automation.provider";

describe("MockInstagramAutomationProvider", () => {
  it("records message and comment effects without external credentials", async () => {
    const provider = new MockInstagramAutomationProvider();
    const account = {
      externalAccountId: "mock-account",
      accessToken: "not-used",
    };
    const reply = await provider.replyComment(account, "comment-1", "Thanks");
    const message = await provider.sendMessage(account, "sender-1", "Hello");
    expect(reply.externalId).toMatch(/^mock-comment_reply-/);
    expect(message.externalId).toMatch(/^mock-message-/);
    expect(provider.getReceipts()).toHaveLength(2);
  });
});
