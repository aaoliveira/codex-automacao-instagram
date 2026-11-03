import { MockInstagramProvider } from "./mock-instagram.provider";

describe("MockInstagramProvider", () => {
  const provider = new MockInstagramProvider();

  it("returns deterministic profile metadata and an opaque mock token", async () => {
    const credentials =
      await provider.exchangeAuthorizationCode("local-creator");
    const profile = await provider.validateConnection(credentials);

    expect(credentials.accessToken).not.toContain("local-creator");
    expect(credentials.externalAccountId).toMatch(/^mock_[a-f0-9]{16}$/);
    expect(profile.username).toMatch(/^mock_[a-f0-9]{8}$/);
    expect(profile.name).toMatch(/^Mock Creator /);
    expect(profile.avatarUrl).toContain("placehold.co");
  });

  it("includes the one-time state and callback in its local authorization URL", () => {
    const url = new URL(
      provider.authorizationUrl("state-once", "http://localhost/callback", []),
    );
    expect(url.protocol).toBe("http:");
    expect(url.searchParams.get("state")).toBe("state-once");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost/callback",
    );
  });
});
