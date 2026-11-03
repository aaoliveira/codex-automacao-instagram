import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InstagramProviderType } from "@prisma/client";
import {
  InstagramCredentials,
  InstagramProfile,
  InstagramProvider,
} from "./instagram-provider";

type MetaTokenResponse = {
  access_token?: unknown;
  user_id?: unknown;
  expires_in?: unknown;
  data?: Array<{
    access_token?: unknown;
    user_id?: unknown;
    expires_in?: unknown;
  }>;
};

type MetaProfileResponse = {
  id?: unknown;
  user_id?: unknown;
  username?: unknown;
  name?: unknown;
  profile_picture_url?: unknown;
};

@Injectable()
export class MetaInstagramProvider implements InstagramProvider {
  readonly type = InstagramProviderType.META;

  constructor(private readonly config: ConfigService) {}

  authorizationUrl(
    state: string,
    redirectUri: string,
    scopes: string[],
  ): string {
    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set(
      "client_id",
      this.config.getOrThrow<string>("META_INSTAGRAM_APP_ID"),
    );
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(","));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<InstagramCredentials> {
    const appId = this.config.getOrThrow<string>("META_INSTAGRAM_APP_ID");
    const appSecret = this.config.getOrThrow<string>(
      "META_INSTAGRAM_APP_SECRET",
    );
    const form = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });

    const shortLived = await this.requestJson<MetaTokenResponse>(
      "https://api.instagram.com/oauth/access_token",
      { method: "POST", body: form },
    );
    const shortLivedData = this.singleTokenResponse(shortLived);
    const shortToken = this.requiredString(shortLivedData.access_token);
    const externalAccountId = this.requiredString(shortLivedData.user_id);

    const longLivedUrl = new URL("https://graph.instagram.com/access_token");
    longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
    longLivedUrl.searchParams.set("client_secret", appSecret);
    longLivedUrl.searchParams.set("access_token", shortToken);
    const longLived = await this.requestJson<MetaTokenResponse>(
      longLivedUrl.toString(),
    );
    const longLivedData = this.singleTokenResponse(longLived);
    const accessToken = this.requiredString(longLivedData.access_token);
    const expiresIn = this.numberOrNull(longLivedData.expires_in);

    return {
      accessToken,
      externalAccountId,
      tokenExpiresAt:
        expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000),
    };
  }

  async validateConnection(
    credentials: InstagramCredentials,
  ): Promise<InstagramProfile> {
    const configuredVersion = this.config.getOrThrow<string>(
      "META_INSTAGRAM_GRAPH_API_VERSION",
    );
    const version = configuredVersion.startsWith("v")
      ? configuredVersion
      : `v${configuredVersion}`;
    const url = new URL(
      `https://graph.instagram.com/${version}/${encodeURIComponent(credentials.externalAccountId)}`,
    );
    url.searchParams.set("fields", "username,name,profile_picture_url");
    const response = await this.requestJson<MetaProfileResponse>(
      url.toString(),
      {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      },
    );
    const responseId =
      this.optionalString(response.user_id) ?? this.optionalString(response.id);
    if (responseId && responseId !== credentials.externalAccountId) {
      throw new ServiceUnavailableException(
        "Instagram account could not be validated",
      );
    }

    return {
      externalAccountId: credentials.externalAccountId,
      username: this.optionalString(response.username),
      name: this.optionalString(response.name),
      avatarUrl: this.optionalString(response.profile_picture_url),
    };
  }

  private async requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`Meta request failed (${response.status})`);
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException(
        "Instagram provider is temporarily unavailable",
      );
    }
  }

  private singleTokenResponse(response: MetaTokenResponse) {
    if (Array.isArray(response.data)) {
      if (response.data.length !== 1) {
        throw new ServiceUnavailableException(
          "Instagram returned an unexpected token response",
        );
      }
      return response.data[0];
    }
    return response;
  }

  private requiredString(value: unknown): string {
    const result = this.optionalString(value);
    if (!result)
      throw new ServiceUnavailableException(
        "Instagram returned an incomplete response",
      );
    return result;
  }

  private optionalString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  private numberOrNull(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? value
      : null;
  }
}
