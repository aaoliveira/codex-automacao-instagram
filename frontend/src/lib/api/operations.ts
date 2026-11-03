import { apiRequest, backendRequest } from '@/lib/api/client';
import type { MembershipRole } from '@/lib/api/types';
import type { PublicationStatus } from '@/lib/api/publications';

export type HealthState = 'ok' | 'unavailable';

export interface OperationsHealth {
  api: HealthState;
  postgres: HealthState;
  redis: HealthState;
  checkedAt: string;
}

export interface QueueMetrics {
  queue: string;
  generatedAt: string;
  states: {
    WAITING: number;
    PROCESSING: number;
    COMPLETED: number;
    FAILED: number;
    CANCELED: number;
  };
  deadLetter: number;
}

export type AuditOutcome = 'SUCCESS' | 'FAILURE';

export interface AuditLogEntry {
  id: string;
  organizationId: string | null;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  outcome: AuditOutcome;
  correlationId: string | null;
  metadata: Record<string, string | number | boolean> | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditLogFilters {
  page: number;
  pageSize: number;
  action?: string;
  userId?: string;
}

const publicationStatuses: PublicationStatus[] = [
  'DRAFT',
  'QUEUED',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
  'CANCELED',
];

export function getOperationsHealth(): Promise<OperationsHealth> {
  return apiRequest<OperationsHealth>('/api/operations/health');
}

export function getQueueMetrics(organizationId: string): Promise<QueueMetrics> {
  return backendRequest<QueueMetrics>(
    `organizations/${encodeURIComponent(organizationId)}/jobs/metrics`,
  );
}

export async function getPublicationStatusCounts(
  organizationId: string,
): Promise<Record<PublicationStatus, number>> {
  const results = await Promise.all(
    publicationStatuses.map(async (status) => {
      const query = new URLSearchParams({ page: '1', pageSize: '1', status });
      const response = await backendRequest<{ total: number }>(
        `organizations/${encodeURIComponent(organizationId)}/instagram/publications?${query.toString()}`,
      );
      return [status, response.total] as const;
    }),
  );
  return Object.fromEntries(results) as Record<PublicationStatus, number>;
}

export function listAuditLogs(
  organizationId: string,
  filters: AuditLogFilters,
): Promise<AuditLogPage> {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.action) query.set('action', filters.action);
  if (filters.userId) query.set('userId', filters.userId);
  return backendRequest<AuditLogPage>(
    `organizations/${encodeURIComponent(organizationId)}/audit-logs?${query.toString()}`,
  );
}

export function canViewOperationsAudit(role: MembershipRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}
