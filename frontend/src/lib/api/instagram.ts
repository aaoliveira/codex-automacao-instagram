import { backendRequest } from "@/lib/api/client";
import type {
  InstagramAccount,
  InstagramAccountBatchResult,
  InstagramAccountGroup,
  InstagramAccountGroupMutationResult,
  InstagramAccountPreference,
  InstagramAccountSummary,
  InstagramAccountsPage,
  InstagramConnectStart,
} from "@/lib/api/types";

export const instagramAccountsQueryKey = (organizationId: string) => [
  "instagram-accounts",
  organizationId,
];

export const instagramAccountManagementQueryKey = (organizationId: string) => [
  ...instagramAccountsQueryKey(organizationId),
  "management",
];

export interface ListInstagramAccountsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  groupId?: string;
  tag?: string;
  favorite?: boolean;
  search?: string;
  sortBy?: "createdAt" | "username" | "name" | "lastSyncedAt" | "internalAlias";
  sortOrder?: "asc" | "desc";
}

export function listManagedInstagramAccounts(
  organizationId: string,
  params: ListInstagramAccountsParams,
): Promise<InstagramAccountsPage> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ page: 1, pageSize: 20, sortBy: "createdAt", sortOrder: "desc", ...params })) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  return backendRequest<InstagramAccountsPage>(
    `organizations/${organizationId}/instagram/accounts?${query.toString()}`,
  );
}

export function getInstagramAccountSummary(
  organizationId: string,
): Promise<InstagramAccountSummary> {
  return backendRequest<InstagramAccountSummary>(
    `organizations/${organizationId}/instagram/accounts/summary`,
  );
}

export function listInstagramAccountGroups(
  organizationId: string,
): Promise<InstagramAccountGroup[]> {
  return backendRequest<InstagramAccountGroup[]>(
    `organizations/${organizationId}/instagram/accounts/groups`,
  );
}

export function listInstagramAccountPreferences(
  organizationId: string,
): Promise<InstagramAccountPreference[]> {
  return backendRequest<InstagramAccountPreference[]>(
    `organizations/${organizationId}/instagram/accounts/preferences`,
  );
}

export function createInstagramAccountGroup(
  organizationId: string,
  input: { name: string; description?: string },
): Promise<InstagramAccountGroupMutationResult> {
  return backendRequest<InstagramAccountGroupMutationResult>(
    `organizations/${organizationId}/instagram/accounts/groups`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateInstagramAccountGroup(
  organizationId: string,
  groupId: string,
  input: { name?: string; description?: string | null; sortOrder?: number },
): Promise<InstagramAccountGroupMutationResult> {
  return backendRequest<InstagramAccountGroupMutationResult>(
    `organizations/${organizationId}/instagram/accounts/groups/${groupId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteInstagramAccountGroup(
  organizationId: string,
  groupId: string,
): Promise<{ success: boolean }> {
  return backendRequest(
    `organizations/${organizationId}/instagram/accounts/groups/${groupId}`,
    { method: "DELETE" },
  );
}

export function orderInstagramAccountGroups(
  organizationId: string,
  groupIds: string[],
): Promise<InstagramAccountGroup[]> {
  return backendRequest<InstagramAccountGroup[]>(
    `organizations/${organizationId}/instagram/accounts/groups/order`,
    { method: "PUT", body: JSON.stringify({ groupIds }) },
  );
}

export function updateInstagramAccountMetadata(
  organizationId: string,
  accountId: string,
  input: { internalAlias: string | null; tags: string[] },
): Promise<InstagramAccount> {
  return backendRequest<InstagramAccount>(
    `organizations/${organizationId}/instagram/accounts/${accountId}/metadata`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function moveInstagramAccount(
  organizationId: string,
  accountId: string,
  groupId: string | null,
): Promise<InstagramAccount> {
  return backendRequest<InstagramAccount>(
    `organizations/${organizationId}/instagram/accounts/${accountId}/group`,
    { method: "PUT", body: JSON.stringify({ groupId }) },
  );
}

export function setInstagramAccountFavorite(
  organizationId: string,
  accountId: string,
  favorite: boolean,
): Promise<{ accountId: string; favorite: boolean }> {
  return backendRequest(
    `organizations/${organizationId}/instagram/accounts/${accountId}/favorite`,
    { method: favorite ? "PUT" : "DELETE" },
  );
}

export function setDefaultInstagramAccount(
  organizationId: string,
  accountId: string,
  isDefault: boolean,
): Promise<{ accountId: string | null; isDefault: boolean }> {
  return backendRequest(
    `organizations/${organizationId}/instagram/accounts/${accountId}/default`,
    {
    method: isDefault ? "PUT" : "DELETE",
    },
  );
}

export function bulkMoveInstagramAccounts(
  organizationId: string,
  accountIds: string[],
  groupId: string | null,
): Promise<InstagramAccountBatchResult> {
  return backendRequest(
    `organizations/${organizationId}/instagram/accounts/bulk/move-group`,
    { method: "POST", body: JSON.stringify({ accountIds, groupId }) },
  );
}

export function bulkTagInstagramAccounts(
  organizationId: string,
  accountIds: string[],
  tags: string[],
): Promise<InstagramAccountBatchResult> {
  return backendRequest(
    `organizations/${organizationId}/instagram/accounts/bulk/tags`,
    { method: "POST", body: JSON.stringify({ accountIds, tags }) },
  );
}

export function bulkSyncInstagramAccounts(
  organizationId: string,
  accountIds: string[],
): Promise<InstagramAccountBatchResult> {
  return backendRequest(
    `organizations/${organizationId}/instagram/accounts/bulk/sync`,
    { method: "POST", body: JSON.stringify({ accountIds }) },
  );
}

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
