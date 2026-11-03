import { AuditRecord } from './audit-record';

type AuditRequest = {
  method: string;
  path: string;
  id?: string;
  params?: Record<string, string | string[]>;
  body?: unknown;
  user?: { sub?: string; organizationId?: string };
};

export function mapRequestToAuditRecord(
  request: AuditRequest,
  statusCode: number,
  responseBody?: unknown,
): AuditRecord | null {
  const method = request.method.toUpperCase();
  const path = request.path.split('?')[0];
  const response = asRecord(responseBody);
  const responseUser = asRecord(response?.user);
  const responseAccount = asRecord(response?.account) ?? response;
  const params = request.params ?? {};
  const body = asRecord(request.body);
  const success = statusCode < 400;
  let action: string | null = null;
  let resourceType: string | null = null;
  let resourceId: string | null = null;

  if (method === 'POST' && path === '/api/auth/register') {
    action = success ? 'USER_REGISTERED' : 'USER_REGISTRATION_FAILED';
    resourceType = 'user';
  } else if (method === 'POST' && path === '/api/auth/login') {
    action = success ? 'LOGIN' : 'LOGIN_FAILED';
    resourceType = 'session';
  } else if (method === 'POST' && path === '/api/auth/logout') {
    action = 'LOGOUT';
    resourceType = 'session';
  } else if (method === 'POST' && /\/instagram\/accounts\/connect$/.test(path)) {
    action = success ? 'INSTAGRAM_CONNECTION_STARTED' : 'INSTAGRAM_CONNECTION_START_FAILED';
    resourceType = 'instagram_account';
    resourceId = asString(asRecord(response?.account)?.id);
  } else if (method === 'GET' && path === '/api/instagram/oauth/callback') {
    action = success ? 'INSTAGRAM_CONNECTED' : 'INSTAGRAM_CONNECTION_FAILED';
    resourceType = 'instagram_account';
    resourceId = asString(responseAccount?.id);
  } else if (method === 'DELETE' && /\/instagram\/accounts\/[^/]+$/.test(path)) {
    action = success ? 'INSTAGRAM_DISCONNECTED' : 'INSTAGRAM_DISCONNECT_FAILED';
    resourceType = 'instagram_account';
    resourceId = paramValue(params, 'accountId') ?? path.split('/').at(-1) ?? null;
  } else if (method === 'POST' && /\/instagram\/publications$/.test(path)) {
    action = success ? 'PUBLICATION_DRAFT_CREATED' : 'PUBLICATION_DRAFT_CREATE_FAILED';
    resourceType = 'publication';
    resourceId = asString(response?.id);
  } else if (method === 'POST' && /\/instagram\/publications\/[^/]+\/publish$/.test(path)) {
    action = success ? 'PUBLICATION_QUEUED' : 'PUBLICATION_QUEUE_FAILED';
    resourceType = 'publication';
    resourceId = paramValue(params, 'publicationId');
  } else if (method === 'POST' && /\/instagram\/publications\/[^/]+\/schedule$/.test(path)) {
    action = success ? 'PUBLICATION_SCHEDULED' : 'PUBLICATION_SCHEDULE_FAILED';
    resourceType = 'publication';
    resourceId = paramValue(params, 'publicationId');
  } else if (method === 'POST' && /\/jobs\/publications\/[^/]+\/retry$/.test(path)) {
    action = success ? 'PUBLICATION_RETRIED' : 'PUBLICATION_RETRY_FAILED';
    resourceType = 'publication';
    resourceId = paramValue(params, 'publicationId') ?? path.split('/').at(-2) ?? null;
  } else if (method === 'POST' && /\/publications\/[^/]+\/cancel$/.test(path)) {
    action = success ? 'PUBLICATION_CANCELED' : 'PUBLICATION_CANCEL_FAILED';
    resourceType = 'publication';
    resourceId = paramValue(params, 'publicationId') ?? path.split('/').at(-2) ?? null;
  } else if (method === 'POST' && /\/automation-rules$/.test(path)) {
    action = success ? 'AUTOMATION_RULE_CREATED' : 'AUTOMATION_RULE_CREATE_FAILED';
    resourceType = 'automation_rule';
    resourceId = asString(response?.id);
  } else if (method === 'POST' && /\/automation-rules\/[^/]+\/simulate$/.test(path)) {
    action = success ? 'AUTOMATION_TESTED' : 'AUTOMATION_TEST_FAILED';
    resourceType = 'automation_rule';
    resourceId = paramValue(params, 'ruleId') ?? path.split('/').at(-2) ?? null;
  } else if (method === 'PATCH' && /\/automation-rules\/[^/]+$/.test(path)) {
    action = success ? 'AUTOMATION_RULE_UPDATED' : 'AUTOMATION_RULE_UPDATE_FAILED';
    resourceType = 'automation_rule';
    resourceId = paramValue(params, 'ruleId') ?? path.split('/').at(-1) ?? null;
  } else if (method === 'DELETE' && /\/automation-rules\/[^/]+$/.test(path)) {
    action = success ? 'AUTOMATION_RULE_DELETED' : 'AUTOMATION_RULE_DELETE_FAILED';
    resourceType = 'automation_rule';
    resourceId = paramValue(params, 'ruleId') ?? path.split('/').at(-1) ?? null;
  } else if (method === 'POST' && /\/organizations\/[^/]+\/members$/.test(path)) {
    action = success ? 'ORGANIZATION_MEMBER_ADDED' : 'ORGANIZATION_MEMBER_ADD_FAILED';
    resourceType = 'membership';
    resourceId = asString(response?.id);
  } else if (method === 'PATCH' && /\/members\/[^/]+\/role$/.test(path)) {
    action = success ? 'ORGANIZATION_MEMBER_ROLE_CHANGED' : 'ORGANIZATION_MEMBER_ROLE_CHANGE_FAILED';
    resourceType = 'membership';
    resourceId = paramValue(params, 'membershipId') ?? path.split('/').at(-2) ?? null;
  } else if (method === 'POST' && /\/media-assets\/cleanup-orphans$/.test(path)) {
    action = success ? 'MEDIA_ORPHANS_CLEANED' : 'MEDIA_ORPHAN_CLEANUP_FAILED';
    resourceType = 'media_library';
  } else if (method === 'DELETE' && /\/media-assets\/[^/]+$/.test(path)) {
    action = success ? 'MEDIA_ASSET_DELETED' : 'MEDIA_ASSET_DELETE_FAILED';
    resourceType = 'media_asset';
    resourceId = paramValue(params, 'assetId') ?? path.split('/').at(-1) ?? null;
  } else if (method === 'POST' && /\/media-assets$/.test(path)) {
    action = success ? 'MEDIA_ASSET_UPLOADED' : 'MEDIA_ASSET_UPLOAD_FAILED';
    resourceType = 'media_asset';
    resourceId = asString(response?.id);
  }

  if (!action) return null;

  const userId = request.user?.sub ?? asString(responseUser?.id) ?? null;
  const organizationId =
    request.user?.organizationId ??
    paramValue(params, 'organizationId') ??
    asString(response?.organizationId) ??
    asString(responseAccount?.organizationId) ??
    null;
  const mediaType = asString(response?.mediaType) ?? asString(body?.mediaType);
  const triggerType = asString(response?.triggerType) ?? asString(body?.triggerType);
  const provider = asString(responseAccount?.provider) ?? asString(response?.provider);
  const role = asString(response?.role) ?? asString(body?.role);
  const metadata: Record<string, unknown> = { statusCode };
  if (mediaType) metadata.mediaType = mediaType;
  if (triggerType) metadata.triggerType = triggerType;
  if (provider) metadata.provider = provider;
  if (role) metadata.nextRole = role;

  return {
    organizationId,
    userId,
    action,
    resourceType,
    resourceId,
    outcome: success ? 'SUCCESS' : 'FAILURE',
    correlationId: request.id ?? null,
    metadata,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function paramValue(params: Record<string, string | string[]>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' ? value : Array.isArray(value) ? value[0] ?? null : null;
}
