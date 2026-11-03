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
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
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
