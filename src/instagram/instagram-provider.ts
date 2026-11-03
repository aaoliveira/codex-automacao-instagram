import { InstagramProviderType } from "@prisma/client";

export const INSTAGRAM_PROVIDER = Symbol("INSTAGRAM_PROVIDER");

export interface InstagramProfile {
  externalAccountId: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface InstagramCredentials {
  accessToken: string;
  externalAccountId: string;
  tokenExpiresAt: Date | null;
  profile?: InstagramProfile;
}

export interface InstagramProvider {
  readonly type: InstagramProviderType;
  authorizationUrl(
    state: string,
    redirectUri: string,
    scopes: string[],
  ): string;
  exchangeAuthorizationCode(
    code: string,
    redirectUri: string,
  ): Promise<InstagramCredentials>;
  validateConnection(
    credentials: InstagramCredentials,
  ): Promise<InstagramProfile>;
}
