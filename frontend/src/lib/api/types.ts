export type MembershipRole = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  createdAt: string;
  membership: {
    role: MembershipRole;
    organization: OrganizationSummary;
  };
}

export interface AuthResult {
  user: { id: string; email: string };
  organizationId: string;
  role: MembershipRole;
}

export interface OrganizationMember {
  role: MembershipRole;
  createdAt: string;
  user: { id: string; email: string };
}

export type InstagramProvider = 'MOCK' | 'META';
export type InstagramAccountStatus =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'ERROR';

export interface InstagramAccount {
  id: string;
  organizationId: string;
  provider: InstagramProvider;
  externalAccountId: string | null;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  status: InstagramAccountStatus;
  groupId?: string | null;
  internalAlias?: string | null;
  tags?: string[];
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstagramAccountGroup {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
  accountCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface InstagramAccountGroupMutationResult {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface InstagramAccountSummary {
  total: number;
  byStatus: Record<InstagramAccountStatus, number>;
  byProvider: Record<InstagramProvider, number>;
  groups: Array<{ id: string; name: string; accountCount: number }>;
  limits: { maxActiveAccounts: number; maxGroups: number };
}

export interface InstagramAccountPreference {
  accountId: string;
  favorite: boolean;
  isDefault: boolean;
  account: InstagramAccount;
}

export interface InstagramAccountsPage {
  items: InstagramAccount[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type InstagramAccountBatchItem =
  | { accountId: string; outcome: 'SUCCESS' }
  | {
      accountId: string;
      outcome: 'FAILED';
      code:
        | 'ACCOUNT_NOT_AVAILABLE'
        | 'ACCESS_DENIED'
        | 'ACCOUNT_NOT_READY'
        | 'SYNC_FAILED'
        | 'OPERATION_FAILED'
        | string;
    };

export interface InstagramAccountBatchResult {
  items: InstagramAccountBatchItem[];
}

export interface InstagramConnectStart {
  mode: InstagramProvider;
  state: string;
  authorizationUrl: string;
  account: InstagramAccount;
}

export interface ApiErrorBody {
  statusCode?: number;
  message?: string | string[];
}
