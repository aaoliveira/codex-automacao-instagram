'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Inbox,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState } from '@/components/ui/states';
import { listInstagramAccounts, instagramAccountsQueryKey } from '@/lib/api/instagram';
import {
  getInstagramEvent,
  instagramEventsQueryKey,
  listInstagramEvents,
  type InstagramEvent,
  type InstagramEventStatusFilter,
  type InstagramEventTypeFilter,
} from '@/lib/api/instagram-events';

const PAGE_SIZE = 20;

export default function InstagramEventsClient() {
  const session = useSession();
  const organizationId = session.membership.organization.id;
  const [page, setPage] = useState(1);
  const [accountId, setAccountId] = useState('');
  const [type, setType] = useState<InstagramEventTypeFilter | ''>('');
  const [status, setStatus] = useState<InstagramEventStatusFilter | ''>('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const filters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(accountId ? { accountId } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    }),
    [accountId, page, status, type],
  );
  const accountsQuery = useQuery({
    queryKey: instagramAccountsQueryKey(organizationId),
    queryFn: () => listInstagramAccounts(organizationId),
  });
  const eventsQuery = useQuery({
    queryKey: instagramEventsQueryKey(organizationId, filters),
    queryFn: () => listInstagramEvents(organizationId, filters),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  const detailQuery = useQuery({
    queryKey: ['instagram-event', organizationId, selectedEventId],
    queryFn: () => getInstagramEvent(organizationId, selectedEventId!),
    enabled: selectedEventId !== null,
  });

  function updateAccount(value: string) {
    setAccountId(value);
    setPage(1);
  }

  function updateType(value: string) {
    setType(value as InstagramEventTypeFilter | '');
    setPage(1);
  }

  function updateStatus(value: string) {
    setStatus(value as InstagramEventStatusFilter | '');
    setPage(1);
  }

  const result = eventsQuery.data;
  const hasFilters = Boolean(accountId || type || status);

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            Instagram activity
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Events inbox
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Review incoming account events for {session.membership.organization.name}.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 shadow-sm sm:self-auto">
          <Activity className="size-3.5 text-emerald-600" aria-hidden="true" />
          Updates every 10 seconds
        </div>
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-6 py-7 text-white shadow-xl shadow-indigo-950/10 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute right-14 top-8 size-28 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100">
              <Inbox className="size-3.5" aria-hidden="true" />
              Workspace event feed
            </div>
            <h2 className="max-w-lg text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[30px]">
              Keep up with what reaches your accounts.
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-slate-300">
              Incoming comments and messaging notifications appear here with a safe summary of their processing status.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 backdrop-blur-sm lg:min-w-[190px]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
              <MessageSquareText className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">
                Matching events
              </span>
              <span className="mt-1 block text-sm font-semibold text-white">
                {result ? result.total.toLocaleString() : '—'} total
              </span>
            </span>
          </div>
        </div>
      </section>

      <section aria-label="Event filters" className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Filter events</h2>
            <p className="mt-1 text-xs text-slate-500">Choose an account, event type, or processing status.</p>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setAccountId('');
                setType('');
                setStatus('');
                setPage(1);
              }}
              className="shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
            >
              Clear filters
            </button>
          )}
        </div>
        {accountsQuery.isError && (
          <div className="mb-4">
            <InlineError message={accountsQuery.error.message} retry={() => void accountsQuery.refetch()} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Instagram account
            <select
              aria-label="Instagram account"
              value={accountId}
              onChange={(event) => updateAccount(event.target.value)}
              disabled={accountsQuery.isLoading || accountsQuery.isError}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
            >
              <option value="">All accounts</option>
              {(accountsQuery.data ?? []).filter((account) => account.externalAccountId).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.username ? `@${account.username}` : account.name || 'Instagram account'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Event type
            <select
              aria-label="Event type"
              value={type}
              onChange={(event) => updateType(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            >
              <option value="">All event types</option>
              <option value="comments">Comments</option>
              <option value="messages">Messages</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Processing status
            <select
              aria-label="Processing status"
              value={status}
              onChange={(event) => updateStatus(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="processed">Processed</option>
              <option value="error">Error</option>
            </select>
          </label>
        </div>
      </section>

      {eventsQuery.isLoading ? (
        <LoadingState label="Loading Instagram events" />
      ) : eventsQuery.isError ? (
        <InlineError message={eventsQuery.error.message} retry={() => void eventsQuery.refetch()} />
      ) : result && result.items.length === 0 ? (
        <EmptyState filtered={hasFilters} />
      ) : result ? (
        <section aria-label="Instagram events" className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recent events</h2>
              <p className="mt-1 text-xs text-slate-500">
                {result.total === 0 ? 'No matching events' : `${(result.page - 1) * result.pageSize + 1}–${Math.min(result.page * result.pageSize, result.total)} of ${result.total} events`}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <RefreshCw className="size-3" aria-hidden="true" />
              Auto-refresh is paused in background tabs
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {result.items.map((event) => (
              <EventRow key={event.id} event={event} onOpen={() => setSelectedEventId(event.id)} />
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 sm:px-6">
            <p className="text-xs text-slate-500">Page {result.page} of {Math.max(1, result.totalPages)}</p>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1 || eventsQuery.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" /> Previous
              </button>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= result.totalPages || eventsQuery.isFetching}
                onClick={() => setPage((current) => current + 1)}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {selectedEventId && (
        <EventDetailsDialog
          event={detailQuery.data}
          loading={detailQuery.isLoading}
          error={detailQuery.error?.message}
          onRetry={() => void detailQuery.refetch()}
          onClose={() => setSelectedEventId(null)}
        />
      )}
    </div>
  );
}

function EventRow({ event, onOpen }: { event: InstagramEvent; onOpen: () => void }) {
  const typeLabel = getEventTypeLabel(event);
  const date = formatDate(event.receivedAt);
  return (
    <article className="flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          {event.eventType === 'instagram.messaging' ? (
            <MessageCircle className="size-4" aria-hidden="true" />
          ) : (
            <MessageSquareText className="size-4" aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">{typeLabel}</h3>
            <span className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-slate-500">{event.provider}</span>
          </div>
          <p className="mt-1 truncate text-xs text-slate-500">
            {event.accountUsername ? `@${event.accountUsername}` : event.accountName || 'Instagram account'}
            {event.field && event.field !== 'comments' ? ` · ${formatField(event.field)}` : ''}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Received {date}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <StatusBadge status={event.status} />
        <button
          type="button"
          onClick={onOpen}
          aria-label={`View details for ${typeLabel}`}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50"
        >
          Details
        </button>
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: InstagramEvent['status'] }) {
  if (status === 'PROCESSED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700">
        <CheckCircle2 className="size-3" aria-hidden="true" /> Processed
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700">
        <CircleAlert className="size-3" aria-hidden="true" /> Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
      <Clock3 className="size-3" aria-hidden="true" /> Pending
    </span>
  );
}

function EventDetailsDialog({
  event,
  loading,
  error,
  onRetry,
  onClose,
}: {
  event?: InstagramEvent;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-2xl sm:rounded-[24px] sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">Event details</p>
            <h2 id="event-dialog-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
              {event ? getEventTypeLabel(event) : 'Loading event'}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close event details" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        {loading ? (
          <LoadingState label="Loading event details" />
        ) : error ? (
          <div className="mt-5">
            <InlineError message={error} retry={onRetry} />
          </div>
        ) : event ? (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={event.status} />
              <span className="rounded-full border border-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600">{event.provider} provider</span>
            </div>
            {event.error && (
              <div className="flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {event.error}
              </div>
            )}
            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailItem label="Instagram account" value={event.accountUsername ? `@${event.accountUsername}` : event.accountName || 'Unknown account'} />
              <DetailItem label="Received" value={formatDate(event.receivedAt)} />
              <DetailItem label="Event category" value={formatField(event.field || event.eventType.replace('instagram.', ''))} />
              <DetailItem label="Processed" value={event.processedAt ? formatDate(event.processedAt) : 'Not yet processed'} />
              {event.externalEventId && <DetailItem label="External event ID" value={event.externalEventId} />}
            </dl>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-xs font-semibold text-slate-800">Safe event summary</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {event.normalizedPayload.object ? `Object: ${event.normalizedPayload.object}. ` : ''}
                {typeof event.normalizedPayload.eventTimestamp === 'number' ? `Provider timestamp: ${formatDate(new Date(event.normalizedPayload.eventTimestamp * 1000).toISOString())}. ` : ''}
                Sensitive event payload details are not shown here.
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-1 break-all text-xs font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-300 bg-white px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Inbox className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-sm font-semibold text-slate-900">{filtered ? 'No events match these filters' : 'No Instagram events yet'}</h2>
      <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">
        {filtered ? 'Try another account, event type, or processing status.' : 'Events received for your connected Instagram accounts will appear here.'}
      </p>
    </div>
  );
}

function getEventTypeLabel(event: InstagramEvent): string {
  if (event.eventType === 'instagram.messaging') return 'Direct message event';
  if (event.field === 'comments') return 'Comment update';
  if (event.field) return `${formatField(event.field)} update`;
  return 'Instagram account event';
}

function formatField(value: string): string {
  return value
    .replace(/^instagram\./, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
