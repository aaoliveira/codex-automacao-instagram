import { Injectable } from "@nestjs/common";
import { InstagramProviderType } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import {
  InstagramCredentials,
  InstagramProfile,
  InstagramProvider,
} from "./instagram-provider";

@Injectable()
export class MockInstagramProvider implements InstagramProvider {
  readonly type = InstagramProviderType.MOCK;

  authorizationUrl(
    state: string,
    redirectUri: string,
    scopes: string[],
  ): string {
    const url = new URL("http://mock.instagram.local/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", "mock");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<InstagramCredentials> {
    const suffix = createHash("sha256").update(code).digest("hex").slice(0, 16);
    const username = `mock_${suffix.slice(0, 8)}`;
    const profile: InstagramProfile = {
      externalAccountId: `mock_${suffix}`,
      username,
      name: `Mock Creator ${suffix.slice(0, 4)}`,
      avatarUrl: "https://placehold.co/96x96?text=MOCK",
    };

    return {
      accessToken: `mock_${randomBytes(32).toString("hex")}`,
      externalAccountId: profile.externalAccountId,
      tokenExpiresAt: null,
      profile,
    };
  }

  async validateConnection(
    credentials: InstagramCredentials,
  ): Promise<InstagramProfile> {
    if (
      !credentials.accessToken.startsWith("mock_") ||
      !credentials.externalAccountId.startsWith("mock_")
    ) {
      throw new Error("Mock Instagram credentials are invalid");
    }

    return (
      credentials.profile ?? {
        externalAccountId: credentials.externalAccountId,
        username: null,
        name: null,
        avatarUrl: null,
      }
    );
  }
}
