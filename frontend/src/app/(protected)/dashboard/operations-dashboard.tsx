'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  FileText,
  ListFilter,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState } from '@/components/ui/states';
import { listInstagramAccounts } from '@/lib/api/instagram';
import {
  listAutomationExecutions,
  listAutomationRules,
  type AutomationExecution,
} from '@/lib/api/automations';
import {
  listInstagramEvents,
  type InstagramEvent,
} from '@/lib/api/instagram-events';
import {
  canViewOperationsAudit,
  getOperationsHealth,
  getPublicationStatusCounts,
  getQueueMetrics,
  listAuditLogs,
  type AuditLogEntry,
  type HealthState,
} from '@/lib/api/operations';
import {
  listPublicationJobPage,
  type PublicationJob,
} from '@/lib/api/scheduler';
import type { InstagramAccount } from '@/lib/api/types';
import type { PublicationStatus } from '@/lib/api/publications';

const statusOrder: PublicationStatus[] = [
  'PUBLISHED',
  'QUEUED',
  'PROCESSING',
  'DRAFT',
  'FAILED',
  'CANCELED',
];

const statusLabels: Record<PublicationStatus, string> = {
  DRAFT: 'Draft',
  QUEUED: 'Queued',
  PROCESSING: 'Processing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  CANCELED: 'Canceled',
};

const auditActions = [
  { value: 'LOGIN', label: 'Successful login' },
  { value: 'LOGIN_FAILED', label: 'Failed login' },
  { value: 'LOGOUT', label: 'Logout' },
  { value: 'INSTAGRAM_CONNECTED', label: 'Instagram connected' },
  { value: 'INSTAGRAM_DISCONNECTED', label: 'Instagram disconnected' },
  { value: 'PUBLICATION_PUBLISHED', label: 'Publication published' },
  { value: 'PUBLICATION_FAILED', label: 'Publication failed' },
  { value: 'AUTOMATION_RULE_CREATED', label: 'Automation created' },
  { value: 'AUTOMATION_RULE_UPDATED', label: 'Automation updated' },
  { value: 'AUTOMATION_EXECUTION_SUCCESS', label: 'Automation succeeded' },
  { value: 'AUTOMATION_EXECUTION_FAILED', label: 'Automation failed' },
  { value: 'ORGANIZATION_MEMBER_ADDED', label: 'Team member added' },
  { value: 'ORGANIZATION_MEMBER_ROLE_CHANGED', label: 'Member role changed' },
];

interface RecentFailure {
  id: string;
  title: string;
  detail: string;
  occurredAt: string;
  href: string;
  source: 'JOB' | 'EVENT' | 'AUTOMATION';
}

export default function OperationsDashboard() {
  const session = useSession();
  const queryClient = useQueryClient();
  const organizationId = session.membership.organization.id;
  const canManage = canViewOperationsAudit(session.membership.role);

  const healthQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'health'],
    queryFn: getOperationsHealth,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const accountsQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'accounts'],
    queryFn: () => listInstagramAccounts(organizationId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const publicationCountsQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'publication-counts'],
    queryFn: () => getPublicationStatusCounts(organizationId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const queueMetricsQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'queue-metrics'],
    queryFn: () => getQueueMetrics(organizationId),
    enabled: canManage,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const failedJobsQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'failed-jobs'],
    queryFn: () => listPublicationJobPage(organizationId, { page: 1, pageSize: 5, state: 'FAILED' }),
    enabled: canManage,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const rulesQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'automation-rules'],
    queryFn: () => listAutomationRules(organizationId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const failedExecutionsQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'failed-automations'],
    queryFn: () => listAutomationExecutions(organizationId, 5, 'FAILED'),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const eventsQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'recent-events'],
    queryFn: () => listInstagramEvents(organizationId, { page: 1, pageSize: 5 }),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });
  const failedEventsQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'failed-events'],
    queryFn: () => listInstagramEvents(organizationId, { page: 1, pageSize: 5, status: 'error' }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  const accounts = accountsQuery.data ?? [];
  const connectedAccounts = accounts.filter((account) => account.status === 'CONNECTED');
  const activeAutomations = (rulesQuery.data ?? []).filter((rule) => rule.active).length;
  const publicationCounts = publicationCountsQuery.data;
  const queue = queueMetricsQuery.data;
  const failures = useMemo(
    () => collectFailures(failedJobsQuery.data?.items, failedEventsQuery.data?.items, failedExecutionsQuery.data?.items),
    [failedEventsQuery.data?.items, failedExecutionsQuery.data?.items, failedJobsQuery.data?.items],
  );
  const failureCount =
    (failedJobsQuery.data?.total ?? 0) +
    (failedEventsQuery.data?.total ?? 0) +
    (failedExecutionsQuery.data?.total ?? 0);
  const hasFailureQueryError =
    (canManage && failedJobsQuery.isError) || failedEventsQuery.isError || failedExecutionsQuery.isError;
  const integrationState = getInstagramState(accountsQuery.data);

  async function refreshDashboard() {
    await queryClient.invalidateQueries({
      queryKey: ['operations-dashboard', organizationId],
    });
  }

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            Operations · {session.membership.organization.name}
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Operations dashboard<span className="text-indigo-600">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            A live view of your Instagram workspace, publishing queue, automations, and recent activity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refreshDashboard()}
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700 sm:self-auto"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh dashboard
        </button>
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-5 py-6 text-white shadow-xl shadow-indigo-950/10 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-14 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute right-10 top-10 size-28 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100">
              <Activity className="size-3.5" aria-hidden="true" /> Workspace operations
            </div>
            <h2 className="text-[23px] font-semibold leading-tight tracking-[-0.035em] sm:text-[29px]">
              {healthQuery.data?.api === 'ok' ? 'Your workspace is operational.' : 'Workspace health needs attention.'}
            </h2>
            <p className="mt-2 max-w-xl text-[13px] leading-6 text-slate-300">
              Review account connections, clear queue failures, and keep an eye on recent Instagram activity.
            </p>
          </div>
          <Link
            href="/instagram/accounts"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 text-xs font-semibold text-slate-900 transition hover:bg-indigo-50"
          >
            Manage accounts <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="relative z-10 mt-6 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <HealthPill label="API" state={healthQuery.data?.api} loading={healthQuery.isLoading} />
          <HealthPill label="PostgreSQL" state={healthQuery.data?.postgres} loading={healthQuery.isLoading} />
          <HealthPill label="Redis" state={healthQuery.data?.redis} loading={healthQuery.isLoading} />
          <HealthPill label="Instagram" state={integrationState.state} detail={integrationState.detail} loading={accountsQuery.isLoading} />
        </div>
        {(healthQuery.isError || accountsQuery.isError) && (
          <div className="relative z-10 mt-3 flex flex-wrap gap-2 text-xs text-amber-100" role="status">
            {healthQuery.isError && <span>Health status could not be refreshed.</span>}
            {accountsQuery.isError && <span>Instagram account health could not be loaded.</span>}
          </div>
        )}
      </section>

      <section aria-label="Workspace metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={<Camera className="size-4" aria-hidden="true" />}
          label="Connected accounts"
          value={accountsQuery.isLoading ? '…' : connectedAccounts.length.toLocaleString()}
          detail={accountsQuery.data ? `${accountsQuery.data.length} account${accountsQuery.data.length === 1 ? '' : 's'} in this workspace` : 'Instagram profile connections'}
          tone="indigo"
          href="/instagram/accounts"
          error={accountsQuery.isError}
        />
        <MetricCard
          icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
          label="Published"
          value={publicationCountsQuery.isLoading ? '…' : (publicationCounts?.PUBLISHED ?? 0).toLocaleString()}
          detail="Publications with published status"
          tone="emerald"
          href="/instagram/publications"
          error={publicationCountsQuery.isError}
        />
        <MetricCard
          icon={<CalendarClock className="size-4" aria-hidden="true" />}
          label="Jobs waiting"
          value={!canManage ? 'Admin' : queueMetricsQuery.isLoading ? '…' : (queue?.states.WAITING ?? 0).toLocaleString()}
          detail={!canManage ? 'Queue metrics require admin access' : `${(queue?.states.FAILED ?? 0).toLocaleString()} failed · ${queue?.deadLetter ?? 0} dead-letter`}
          tone="amber"
          href={canManage ? '/instagram/scheduler' : undefined}
          error={canManage && queueMetricsQuery.isError}
        />
        <MetricCard
          icon={<Workflow className="size-4" aria-hidden="true" />}
          label="Active automations"
          value={rulesQuery.isLoading ? '…' : activeAutomations.toLocaleString()}
          detail={rulesQuery.data ? `${rulesQuery.data.length} rule${rulesQuery.data.length === 1 ? '' : 's'} configured` : 'Automation rules in this workspace'}
          tone="violet"
          href="/automations"
          error={rulesQuery.isError}
        />
      </section>

      <section aria-label="Quick navigation" className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <ArrowUpRight className="size-4 text-indigo-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-slate-900">Quick links</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <QuickLink href="/instagram/accounts" label="Accounts" icon={<Camera className="size-4" aria-hidden="true" />} />
          <QuickLink href="/instagram/publications" label="Publications" icon={<FileText className="size-4" aria-hidden="true" />} />
          <QuickLink href="/automations" label="Automations" icon={<Bot className="size-4" aria-hidden="true" />} />
          {canManage && <QuickLink href="/instagram/scheduler" label="Jobs & schedule" icon={<CalendarClock className="size-4" aria-hidden="true" />} />}
          {canManage && <QuickLink href="#audit-log" label="Audit log" icon={<ShieldCheck className="size-4" aria-hidden="true" />} />}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Panel title="Publications by status" subtitle="Organization-wide totals from publication history" icon={<FileText className="size-4" aria-hidden="true" />} actionHref="/instagram/publications" actionLabel="View history">
          {publicationCountsQuery.isLoading ? (
            <LoadingState label="Loading publication status" />
          ) : publicationCountsQuery.isError ? (
            <InlineError message={publicationCountsQuery.error.message} retry={() => void publicationCountsQuery.refetch()} />
          ) : (
            <PublicationBreakdown counts={publicationCounts ?? emptyPublicationCounts()} />
          )}
        </Panel>

        <Panel title="Queue health" subtitle="Pending and failed work across the publishing queue" icon={<Activity className="size-4" aria-hidden="true" />} actionHref={canManage ? '/instagram/scheduler' : undefined} actionLabel={canManage ? 'Open jobs' : undefined}>
          {!canManage ? (
            <RestrictedPanel message="Queue metrics are available to organization owners and admins." />
          ) : queueMetricsQuery.isLoading ? (
            <LoadingState label="Loading queue health" />
          ) : queueMetricsQuery.isError ? (
            <InlineError message={queueMetricsQuery.error.message} retry={() => void queueMetricsQuery.refetch()} />
          ) : (
            <QueueSummary metrics={queue} />
          )}
        </Panel>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Panel title="Connected Instagram accounts" subtitle="Connection state and provider for this workspace" icon={<Camera className="size-4" aria-hidden="true" />} actionHref="/instagram/accounts" actionLabel="Manage accounts">
          {accountsQuery.isLoading ? (
            <LoadingState label="Loading Instagram accounts" />
          ) : accountsQuery.isError ? (
            <InlineError message={accountsQuery.error.message} retry={() => void accountsQuery.refetch()} />
          ) : accounts.length === 0 ? (
            <EmptyPanel title="No accounts connected" detail="Connect an Instagram account to start using workspace operations." href="/instagram/accounts" linkLabel="Connect an account" />
          ) : (
            <div className="divide-y divide-slate-100">
              {accounts.slice(0, 5).map((account) => <AccountRow key={account.id} account={account} />)}
              {accounts.length > 5 && <Link href="/instagram/accounts" className="block pt-3 text-xs font-semibold text-indigo-700 hover:text-indigo-900">View {accounts.length - 5} more accounts</Link>}
            </div>
          )}
        </Panel>

        <Panel title="Recent Instagram events" subtitle="Safe summaries of incoming account activity" icon={<Activity className="size-4" aria-hidden="true" />} actionHref="/instagram/events" actionLabel="Open events">
          {eventsQuery.isLoading ? (
            <LoadingState label="Loading recent events" />
          ) : eventsQuery.isError ? (
            <InlineError message={eventsQuery.error.message} retry={() => void eventsQuery.refetch()} />
          ) : !eventsQuery.data?.items.length ? (
            <EmptyPanel title="No events received" detail="Incoming comments and messages will appear here." href="/instagram/events" linkLabel="Open events inbox" />
          ) : (
            <div className="divide-y divide-slate-100">
              {eventsQuery.data.items.map((event) => <EventRow key={event.id} event={event} />)}
            </div>
          )}
        </Panel>
      </section>

      <section aria-labelledby="recent-errors-heading" className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><TriangleAlert className="size-4" aria-hidden="true" /></span>
            <div>
              <h2 id="recent-errors-heading" className="text-sm font-semibold text-slate-900">Recent errors</h2>
              <p className="mt-1 text-xs text-slate-500">{failureCount.toLocaleString()} failed jobs, events, and automation runs</p>
            </div>
          </div>
          <Link href={canManage ? '/instagram/scheduler' : '/instagram/events'} className="shrink-0 text-xs font-semibold text-indigo-700 hover:text-indigo-900">Resolve issues <ArrowRight className="ml-1 inline size-3.5" aria-hidden="true" /></Link>
        </div>
        {hasFailureQueryError ? (
          <InlineError message="Some recent failures could not be loaded." retry={() => void refreshDashboard()} />
        ) : failedEventsQuery.isLoading || failedExecutionsQuery.isLoading || (canManage && failedJobsQuery.isLoading) ? (
          <LoadingState label="Loading recent errors" />
        ) : failures.length === 0 ? (
          <div className="flex min-h-24 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center">
            <CircleCheck className="size-5 text-emerald-600" aria-hidden="true" />
            <p className="mt-2 text-xs font-semibold text-slate-700">No recent errors</p>
            <p className="mt-1 text-[11px] text-slate-500">Failed queue jobs, events, and automation runs will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {failures.slice(0, 6).map((failure) => <FailureRow key={`${failure.source}-${failure.id}`} failure={failure} />)}
          </div>
        )}
      </section>

      <AuditLogPanel organizationId={organizationId} canView={canManage} />
      <p className="text-center text-[10px] text-slate-400">Operational totals refresh automatically. Sensitive message content and credentials are not shown here.</p>
    </div>
  );
}

function AuditLogPanel({ organizationId, canView }: { organizationId: string; canView: boolean }) {
  const [draftAction, setDraftAction] = useState('');
  const [draftUserId, setDraftUserId] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [page, setPage] = useState(1);
  const [filterError, setFilterError] = useState('');

  const auditQuery = useQuery({
    queryKey: ['operations-dashboard', organizationId, 'audit-log', { action, userId, page }],
    queryFn: () => listAuditLogs(organizationId, { page, pageSize: 8, action: action || undefined, userId: userId || undefined }),
    enabled: canView,
  });

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUserId = draftUserId.trim();
    if (normalizedUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalizedUserId)) {
      setFilterError('Enter a valid user ID in UUID format.');
      return;
    }
    setFilterError('');
    setAction(draftAction);
    setUserId(normalizedUserId);
    setPage(1);
  }

  return (
    <section id="audit-log" aria-labelledby="audit-heading" className="scroll-mt-24 rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><ShieldCheck className="size-4" aria-hidden="true" /></span>
          <div>
            <h2 id="audit-heading" className="text-sm font-semibold text-slate-900">Audit log</h2>
            <p className="mt-1 text-xs text-slate-500">Review workspace actions by type or user. Secret values are never displayed.</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-lg bg-slate-50 px-2.5 py-1.5 text-[10px] font-medium text-slate-500">
          <ShieldCheck className="size-3 text-emerald-600" aria-hidden="true" /> Owner/Admin access
        </span>
      </div>

      {!canView ? (
        <RestrictedPanel message="Audit records are visible to organization owners and admins." />
      ) : (
        <>
          <form onSubmit={applyFilters} className="mb-4 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1.25fr_auto] sm:items-end">
            <label className="block text-[11px] font-medium text-slate-600">
              Filter audit action
              <select value={draftAction} onChange={(event) => setDraftAction(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                <option value="">All actions</option>
                {auditActions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="block text-[11px] font-medium text-slate-600">
              Filter by user ID
              <input value={draftUserId} onChange={(event) => setDraftUserId(event.target.value)} placeholder="Optional UUID" inputMode="text" autoComplete="off" className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
            </label>
            <button type="submit" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 text-xs font-semibold text-white transition hover:bg-indigo-700"><ListFilter className="size-3.5" aria-hidden="true" /> Apply filters</button>
            {filterError && <p className="text-xs text-rose-700 sm:col-span-3" role="alert">{filterError}</p>}
          </form>
          {auditQuery.isLoading ? (
            <LoadingState label="Loading audit records" />
          ) : auditQuery.isError ? (
            <InlineError message={auditQuery.error.message} retry={() => void auditQuery.refetch()} />
          ) : !auditQuery.data?.items.length ? (
            <EmptyPanel title={action || userId ? 'No matching audit records' : 'No audit records yet'} detail="Workspace actions appear here as they happen." />
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between text-[11px] text-slate-500">
                <span>{auditQuery.data.total.toLocaleString()} records</span>
                {(action || userId) && <button type="button" onClick={() => { setAction(''); setUserId(''); setDraftAction(''); setDraftUserId(''); setPage(1); }} className="font-semibold text-indigo-700 hover:text-indigo-900">Clear filters</button>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] border-collapse text-left">
                  <thead><tr className="border-y border-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-400"><th className="py-2.5 pr-3">Action</th><th className="py-2.5 pr-3">Resource</th><th className="py-2.5 pr-3">User</th><th className="py-2.5 pr-3">Outcome</th><th className="py-2.5 text-right">Time</th></tr></thead>
                  <tbody>{auditQuery.data.items.map((entry) => <AuditRow key={entry.id} entry={entry} />)}</tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                <span className="text-[11px] text-slate-500">Page {auditQuery.data.page} of {Math.max(auditQuery.data.totalPages, 1)}</span>
                <div className="flex gap-1.5">
                  <button type="button" aria-label="Previous audit page" disabled={page <= 1 || auditQuery.isFetching} onClick={() => setPage((current) => Math.max(current - 1, 1))} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="size-4" aria-hidden="true" /></button>
                  <button type="button" aria-label="Next audit page" disabled={page >= auditQuery.data.totalPages || auditQuery.isFetching} onClick={() => setPage((current) => current + 1)} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="size-4" aria-hidden="true" /></button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
  href,
  error,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: 'indigo' | 'emerald' | 'amber' | 'violet';
  href?: string;
  error?: boolean;
}) {
  const toneClass = {
    indigo: 'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  }[tone];
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={`flex size-8 items-center justify-center rounded-lg ${toneClass}`}>{icon}</span>
      </div>
      <p className="mt-4 text-[26px] font-semibold tracking-tight text-slate-900">{error ? '—' : value}</p>
      <p className="mt-1 min-h-8 text-[11px] leading-4 text-slate-500">{error ? 'Information could not be loaded' : detail}</p>
      {href && <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700">Open details <ArrowUpRight className="size-3" aria-hidden="true" /></span>}
    </>
  );
  const className = 'block min-w-0 rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-indigo-200 sm:p-5';
  return href ? <Link href={href} className={className}>{content}</Link> : <div className={className}>{content}</div>;
}

function Panel({
  title,
  subtitle,
  icon,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  actionHref?: string;
  actionLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">{icon}</span>
          <div className="min-w-0"><h2 className="truncate text-sm font-semibold text-slate-900">{title}</h2><p className="mt-1 text-[11px] leading-4 text-slate-500">{subtitle}</p></div>
        </div>
        {actionHref && actionLabel && <Link href={actionHref} className="shrink-0 pt-1 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900">{actionLabel} <ArrowRight className="ml-0.5 inline size-3" aria-hidden="true" /></Link>}
      </div>
      {children}
    </section>
  );
}

function PublicationBreakdown({ counts }: { counts: Record<PublicationStatus, number> }) {
  const maximum = Math.max(...Object.values(counts), 1);
  return (
    <div className="space-y-3">
      {statusOrder.map((status) => (
        <div key={status} className="grid grid-cols-[82px_1fr_36px] items-center gap-3">
          <span className="text-[11px] font-medium text-slate-600">{statusLabels[status]}</span>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full rounded-full ${statusBarColor(status)}`} style={{ width: `${counts[status] === 0 ? 0 : Math.max((counts[status] / maximum) * 100, 4)}%` }} /></div>
          <span className="text-right text-[11px] font-semibold tabular-nums text-slate-700">{counts[status].toLocaleString()}</span>
        </div>
      ))}
      <p className="border-t border-slate-100 pt-3 text-[10px] text-slate-400">Counts include all publications in this organization.</p>
    </div>
  );
}

function QueueSummary({ metrics }: { metrics: Awaited<ReturnType<typeof getQueueMetrics>> | undefined }) {
  if (!metrics) return <EmptyPanel title="Queue metrics unavailable" detail="Try refreshing the dashboard." />;
  const rows = [
    { label: 'Waiting', count: metrics.states.WAITING, state: 'WAITING' },
    { label: 'Processing', count: metrics.states.PROCESSING, state: 'PROCESSING' },
    { label: 'Failed', count: metrics.states.FAILED, state: 'FAILED' },
  ];
  return (
    <div className="space-y-3">
      {rows.map((row) => <div key={row.state} className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3"><span className="flex items-center gap-2 text-xs font-medium text-slate-600"><span className={`size-2 rounded-full ${row.state === 'FAILED' ? 'bg-rose-500' : row.state === 'WAITING' ? 'bg-amber-500' : 'bg-indigo-500'}`} />{row.label}</span><span className="text-sm font-semibold tabular-nums text-slate-900">{row.count.toLocaleString()}</span></div>)}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-[10px] text-slate-500"><span>Completed {metrics.states.COMPLETED.toLocaleString()} · Canceled {metrics.states.CANCELED.toLocaleString()}</span><span>{metrics.deadLetter.toLocaleString()} dead-letter</span></div>
    </div>
  );
}

function AccountRow({ account }: { account: InstagramAccount }) {
  const displayName = account.name || account.username || 'Instagram account';
  return (
    <Link href="/instagram/accounts" className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-100 via-rose-50 to-amber-50 text-fuchsia-600"><Camera className="size-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{displayName}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{account.username ? `@${account.username} · ` : ''}{account.provider} provider</span></span>
      <StatusBadge status={account.status} />
    </Link>
  );
}

function EventRow({ event }: { event: InstagramEvent }) {
  const status = event.status === 'FAILED' ? 'FAILED' : event.status === 'PROCESSED' ? 'SUCCESS' : 'PENDING';
  return (
    <Link href="/instagram/events" className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500"><Activity className="size-3.5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{eventLabel(event)}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{event.accountUsername ? `@${event.accountUsername} · ` : ''}{formatTime(event.receivedAt)}</span></span>
      <StatusBadge status={status} />
    </Link>
  );
}

function FailureRow({ failure }: { failure: RecentFailure }) {
  const icon = failure.source === 'JOB' ? <CalendarClock className="size-3.5" aria-hidden="true" /> : failure.source === 'EVENT' ? <Activity className="size-3.5" aria-hidden="true" /> : <Workflow className="size-3.5" aria-hidden="true" />;
  return (
    <Link href={failure.href} className="group rounded-xl border border-rose-100 bg-rose-50/55 p-3 transition hover:border-rose-200 hover:bg-rose-50">
      <div className="flex items-start gap-2.5"><span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-rose-600 ring-1 ring-rose-100">{icon}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{failure.title}</span><span className="mt-1 block truncate text-[10px] text-slate-500">{failure.detail}</span><span className="mt-2 block text-[10px] text-slate-400">{formatTime(failure.occurredAt)}</span></span><ArrowUpRight className="size-3 shrink-0 text-slate-400 transition group-hover:text-rose-700" aria-hidden="true" /></div>
    </Link>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="py-3 pr-3"><span className="block text-[11px] font-semibold text-slate-800">{auditActionLabel(entry.action)}</span><span className="mt-0.5 block text-[10px] text-slate-400">{entry.action}</span></td>
      <td className="py-3 pr-3 text-[11px] text-slate-600">{entry.resourceType ? humanize(entry.resourceType) : 'Workspace'}</td>
      <td className="py-3 pr-3 font-mono text-[10px] text-slate-500">{entry.userId ? `${entry.userId.slice(0, 8)}…` : 'System'}</td>
      <td className="py-3 pr-3"><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${entry.outcome === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{entry.outcome === 'SUCCESS' ? 'Success' : 'Failure'}</span></td>
      <td className="py-3 text-right text-[10px] text-slate-500">{formatTime(entry.createdAt)}</td>
    </tr>
  );
}

function HealthPill({ label, state, detail, loading }: { label: string; state?: HealthState | 'connected' | 'attention' | 'disconnected'; detail?: string; loading: boolean }) {
  const isHealthy = state === 'ok' || state === 'connected';
  const labelText = loading ? 'Checking' : state === 'ok' ? 'Operational' : state === 'connected' ? 'Connected' : state === 'attention' ? 'Needs review' : state === 'disconnected' ? 'Not connected' : 'Unavailable';
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
      {loading ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-indigo-200" aria-hidden="true" /> : isHealthy ? <CircleCheck className="size-3.5 shrink-0 text-emerald-300" aria-hidden="true" /> : <AlertCircle className="size-3.5 shrink-0 text-amber-300" aria-hidden="true" />}
      <span className="min-w-0 flex-1"><span className="block text-[9px] font-medium uppercase tracking-wide text-slate-400">{label}</span><span className="mt-0.5 block truncate text-[11px] font-semibold text-white">{detail || labelText}</span></span>
      <span className={`size-1.5 shrink-0 rounded-full ${loading ? 'bg-indigo-300' : isHealthy ? 'bg-emerald-400' : 'bg-amber-400'}`} />
    </div>
  );
}

function QuickLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return <Link href={href} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50/50 hover:text-indigo-700">{icon}{label}<ArrowUpRight className="ml-auto size-3 text-slate-400" aria-hidden="true" /></Link>;
}

function StatusBadge({ status }: { status: string }) {
  const style = status === 'CONNECTED' || status === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : status === 'FAILED' || status === 'ERROR' ? 'bg-rose-50 text-rose-700' : status === 'PENDING' || status === 'CONNECTING' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
  const label = status === 'CONNECTED' ? 'Connected' : status === 'SUCCESS' ? 'Processed' : status === 'FAILED' || status === 'ERROR' ? 'Error' : status === 'PENDING' || status === 'CONNECTING' ? 'Pending' : humanize(status);
  return <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold ${style}`}>{label}</span>;
}

function RestrictedPanel({ message }: { message: string }) {
  return <div className="flex min-h-24 items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-4"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 ring-1 ring-slate-200"><ShieldCheck className="size-4" aria-hidden="true" /></span><div><p className="text-xs font-semibold text-slate-700">Restricted overview</p><p className="mt-1 text-[11px] leading-5 text-slate-500">{message}</p></div></div>;
}

function EmptyPanel({ title, detail, href, linkLabel }: { title: string; detail: string; href?: string; linkLabel?: string }) {
  return <div className="flex min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5 text-center"><CircleDashed className="size-5 text-slate-400" aria-hidden="true" /><p className="mt-2 text-xs font-semibold text-slate-700">{title}</p><p className="mt-1 max-w-sm text-[11px] leading-5 text-slate-500">{detail}</p>{href && linkLabel && <Link href={href} className="mt-3 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900">{linkLabel} <ArrowRight className="ml-0.5 inline size-3" aria-hidden="true" /></Link>}</div>;
}

function collectFailures(jobs?: PublicationJob[], events?: InstagramEvent[], executions?: AutomationExecution[]): RecentFailure[] {
  const result: RecentFailure[] = [
    ...(jobs ?? []).map((job) => ({
      id: job.id,
      title: 'Publication job failed',
      detail: job.instagramAccount.username ? `@${job.instagramAccount.username} · open job details` : 'Open the publishing queue to retry or inspect this job',
      occurredAt: job.finishedAt ?? job.updatedAt,
      href: `/instagram/publications/${job.publicationId}`,
      source: 'JOB' as const,
    })),
    ...(events ?? []).map((event) => ({
      id: event.id,
      title: `${event.accountUsername ? `@${event.accountUsername} · ` : ''}${eventLabel(event)} failed`,
      detail: 'Instagram event processing needs review',
      occurredAt: event.receivedAt,
      href: '/instagram/events',
      source: 'EVENT' as const,
    })),
    ...(executions ?? []).map((execution) => ({
      id: execution.id,
      title: execution.automationRule.name,
      detail: 'Automation execution failed · review the rule history',
      occurredAt: execution.finishedAt ?? execution.createdAt,
      href: '/automations',
      source: 'AUTOMATION' as const,
    })),
  ];
  return result.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}

function getInstagramState(accounts?: InstagramAccount[]) {
  if (!accounts) return { state: undefined, detail: undefined } as const;
  const connected = accounts.filter((account) => account.status === 'CONNECTED');
  const needsReview = accounts.some((account) => account.status === 'ERROR' || account.status === 'CONNECTING');
  const providers = [...new Set(connected.map((account) => account.provider))];
  return {
    state: connected.length > 0 ? needsReview ? 'attention' as const : 'connected' as const : needsReview ? 'attention' as const : 'disconnected' as const,
    detail: connected.length > 0 ? `${connected.length} connected${providers.length === 1 ? ` · ${providers[0]}` : ''}` : needsReview ? 'Connection needs review' : 'Not connected',
  };
}

function emptyPublicationCounts(): Record<PublicationStatus, number> {
  return { DRAFT: 0, QUEUED: 0, PROCESSING: 0, PUBLISHED: 0, FAILED: 0, CANCELED: 0 };
}

function statusBarColor(status: PublicationStatus): string {
  switch (status) {
    case 'PUBLISHED': return 'bg-emerald-500';
    case 'QUEUED': return 'bg-amber-400';
    case 'PROCESSING': return 'bg-indigo-500';
    case 'DRAFT': return 'bg-slate-400';
    case 'FAILED': return 'bg-rose-500';
    case 'CANCELED': return 'bg-slate-300';
  }
}

function eventLabel(event: InstagramEvent): string {
  if (event.field === 'comments') return 'Comment update';
  if (event.field === 'messages') return 'Message update';
  return humanize(event.eventType);
}

function auditActionLabel(action: string): string {
  return auditActions.find((item) => item.value === action)?.label ?? humanize(action);
}

function humanize(value: string): string {
  return value.toLowerCase().split(/[_\s]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
