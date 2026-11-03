export type AuditOutcome = 'SUCCESS' | 'FAILURE';

export interface AuditRecord {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  outcome?: AuditOutcome;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

