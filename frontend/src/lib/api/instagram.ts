import { backendRequest } from "@/lib/api/client";
import type { InstagramAccount, InstagramConnectStart } from "@/lib/api/types";

export const instagramAccountsQueryKey = (organizationId: string) => [
  "instagram-accounts",
  organizationId,
];

export function listInstagramAccounts(
  organizationId: string,
): Promise<InstagramAccount[]> {
  return backendRequest<InstagramAccount[]>(
    `organizations/${organizationId}/instagram/accounts`,
  );
}

export function startInstagramConnection(
  organizationId: string,
): Promise<InstagramConnectStart> {
  return backendRequest<InstagramConnectStart>(
    `organizations/${organizationId}/instagram/accounts/connect`,
    { method: "POST" },
  );
}

export function completeInstagramOAuth(
  state: string,
  code: string,
): Promise<InstagramAccount> {
  const query = new URLSearchParams({ state, code });
  return backendRequest<InstagramAccount>(
    `instagram/oauth/callback?${query.toString()}`,
  );
}

export function syncInstagramAccount(
  organizationId: string,
  accountId: string,
): Promise<InstagramAccount> {
  return backendRequest<InstagramAccount>(
    `organizations/${organizationId}/instagram/accounts/${accountId}/sync`,
    { method: "POST" },
  );
}

export function disconnectInstagramAccount(
  organizationId: string,
  accountId: string,
): Promise<InstagramAccount> {
  return backendRequest<InstagramAccount>(
    `organizations/${organizationId}/instagram/accounts/${accountId}`,
    { method: "DELETE" },
  );
}
