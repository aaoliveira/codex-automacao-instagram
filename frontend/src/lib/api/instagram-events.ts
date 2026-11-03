import { backendRequest } from '@/lib/api/client';

export type InstagramEventStatus =
  | 'RECEIVED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'FAILED';

export type InstagramEventTypeFilter = 'comments' | 'messages' | 'other';
export type InstagramEventStatusFilter = 'pending' | 'processed' | 'error';

export interface InstagramEvent {
  id: string;
  provider: 'META' | 'MOCK';
  externalEventId: string | null;
  instagramAccountId: string;
  accountUsername: string | null;
  accountName: string | null;
  eventType: string;
  field: string | null;
  status: InstagramEventStatus;
  receivedAt: string;
  processedAt: string | null;
  error: string | null;
  normalizedPayload: Record<string, string | number | null>;
}

export interface InstagramEventPage {
  items: InstagramEvent[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface InstagramEventFilters {
  page: number;
  pageSize: number;
  accountId?: string;
  type?: InstagramEventTypeFilter;
  status?: InstagramEventStatusFilter;
}

export const instagramEventsQueryKey = (
  organizationId: string,
  filters: InstagramEventFilters,
) => ['instagram-events', organizationId, filters] as const;

export function listInstagramEvents(
  organizationId: string,
  filters: InstagramEventFilters,
): Promise<InstagramEventPage> {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.accountId) query.set('accountId', filters.accountId);
  if (filters.type) query.set('type', filters.type);
  if (filters.status) query.set('status', filters.status);

  return backendRequest<InstagramEventPage>(
    `organizations/${organizationId}/instagram/events?${query.toString()}`,
  );
}

export function getInstagramEvent(
  organizationId: string,
  eventId: string,
): Promise<InstagramEvent> {
  return backendRequest<InstagramEvent>(
    `organizations/${organizationId}/instagram/events/${eventId}`,
  );
}
