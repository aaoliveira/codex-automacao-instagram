import { ConfigService } from "@nestjs/config";
import { MetaInstagramProvider } from "./meta-instagram.provider";

describe("MetaInstagramProvider", () => {
  const values: Record<string, string> = {
    META_INSTAGRAM_APP_ID: "app-id",
    META_INSTAGRAM_APP_SECRET: "app-secret",
    META_INSTAGRAM_GRAPH_API_VERSION: "v25.0",
  };
  const provider = new MetaInstagramProvider({
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService);

  afterEach(() => jest.restoreAllMocks());

  it("builds the documented Instagram Login authorization URL with state", () => {
    const url = new URL(
      provider.authorizationUrl("csrf-state", "https://app.example/callback", [
        "instagram_business_basic",
      ]),
    );

    expect(url.origin + url.pathname).toBe(
      "https://www.instagram.com/oauth/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("app-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("instagram_business_basic");
    expect(url.searchParams.get("state")).toBe("csrf-state");
  });

  it("exchanges the code, upgrades the token and validates the account profile", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "short-token", user_id: "ig-123" }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "long-token", expires_in: 5184000 }),
          {
            status: 200,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            username: "professional_creator",
            name: "Professional Creator",
            profile_picture_url: "https://cdn.example/avatar.jpg",
          }),
          { status: 200 },
        ),
      );

    const credentials = await provider.exchangeAuthorizationCode(
      "one-time-code",
      "https://app.example/callback",
    );
    const profile = await provider.validateConnection(credentials);

    expect(credentials.externalAccountId).toBe("ig-123");
    expect(credentials.accessToken).toBe("long-token");
    expect(credentials.tokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(profile).toEqual({
      externalAccountId: "ig-123",
      username: "professional_creator",
      name: "Professional Creator",
      avatarUrl: "https://cdn.example/avatar.jpg",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const shortLivedRequest = fetchMock.mock.calls[0];
    expect(shortLivedRequest[0]).toBe(
      "https://api.instagram.com/oauth/access_token",
    );
    expect(shortLivedRequest[1]?.method).toBe("POST");
    expect(String(shortLivedRequest[1]?.body)).toContain(
      "grant_type=authorization_code",
    );

    const longLivedRequest = new URL(String(fetchMock.mock.calls[1][0]));
    expect(longLivedRequest.origin + longLivedRequest.pathname).toBe(
      "https://graph.instagram.com/access_token",
    );
    expect(longLivedRequest.searchParams.get("grant_type")).toBe(
      "ig_exchange_token",
    );
    expect(longLivedRequest.searchParams.get("access_token")).toBe(
      "short-token",
    );

    const profileRequest = new URL(String(fetchMock.mock.calls[2][0]));
    expect(profileRequest.origin + profileRequest.pathname).toBe(
      "https://graph.instagram.com/v25.0/ig-123",
    );
    expect(profileRequest.searchParams.get("fields")).toBe(
      "username,name,profile_picture_url",
    );
    expect(profileRequest.searchParams.has("access_token")).toBe(false);
    expect(fetchMock.mock.calls[2][1]?.headers).toEqual({
      Authorization: "Bearer long-token",
    });
  });
});
