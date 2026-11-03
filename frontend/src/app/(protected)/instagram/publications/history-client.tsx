'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState } from '@/components/ui/states';
import { listInstagramAccounts, instagramAccountsQueryKey } from '@/lib/api/instagram';
import {
  listPublications,
  publicationsQueryKey,
  type Publication,
  type PublicationStatus,
} from '@/lib/api/publications';
import {
  formatDate,
  isInProgress,
  mediaTypeLabel,
  StatusBadge,
} from './publication-ui';

const PAGE_SIZE = 12;

const statuses: Array<{ value: PublicationStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'QUEUED', label: 'Queued' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'CANCELED', label: 'Canceled' },
];

export default function PublicationsHistory() {
  const session = useSession();
  const organizationId = session.membership.organization.id;
  const [page, setPage] = useState(1);
  const [instagramAccountId, setInstagramAccountId] = useState('');
  const [status, setStatus] = useState<PublicationStatus | ''>('');
  const filters = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      ...(instagramAccountId ? { instagramAccountId } : {}),
      ...(status ? { status } : {}),
    }),
    [instagramAccountId, page, status],
  );
  const accountsQuery = useQuery({
    queryKey: instagramAccountsQueryKey(organizationId),
    queryFn: () => listInstagramAccounts(organizationId),
  });
  const historyQuery = useQuery({
    queryKey: [...publicationsQueryKey(organizationId), filters],
    queryFn: () => listPublications(organizationId, filters),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) => isInProgress(item.status))
        ? 2_500
        : false,
    refetchIntervalInBackground: false,
  });

  const publications = historyQuery.data;
  const hasFilters = Boolean(instagramAccountId || status);

  function updateStatus(value: string) {
    setStatus(value as PublicationStatus | '');
    setPage(1);
  }

  function updateAccount(value: string) {
    setInstagramAccountId(value);
    setPage(1);
  }

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            Instagram publishing
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Publishing history<span className="text-indigo-600">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Track drafts and posts sent from {session.membership.organization.name}.
          </p>
        </div>
        <Link
          href="/instagram/compose"
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 sm:self-auto"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Create a post
        </Link>
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-6 py-7 text-white shadow-xl shadow-indigo-950/10 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute right-14 top-8 size-28 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100">
              <Clock3 className="size-3.5" aria-hidden="true" /> Workspace publishing log
            </div>
            <h2 className="max-w-lg text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[30px]">
              Every draft and post, in one place.
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-slate-300">
              Follow a publication from the first draft through Instagram’s processing queue.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 backdrop-blur-sm lg:min-w-[190px]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
              <FileText className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">Matching posts</span>
              <span className="mt-1 block text-sm font-semibold text-white">{publications ? publications.total.toLocaleString() : '—'} total</span>
            </span>
          </div>
        </div>
      </section>

      <section aria-label="Publication filters" className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Filter publishing history</h2>
            <p className="mt-1 text-xs text-slate-500">Narrow the list by account or publication status.</p>
          </div>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setInstagramAccountId('');
                setStatus('');
                setPage(1);
              }}
              className="self-start rounded-lg px-2.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 sm:self-auto"
            >
              Clear filters
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Instagram account
            <select
              aria-label="Filter by Instagram account"
              value={instagramAccountId}
              onChange={(event) => updateAccount(event.target.value)}
              disabled={accountsQuery.isLoading || accountsQuery.isError}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
            >
              <option value="">All accounts</option>
              {(accountsQuery.data ?? []).map((account) => (
                <option key={account.id} value={account.id}>
                  {account.username ? `@${account.username}` : account.name || 'Instagram account'}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium text-slate-600">
            Status
            <select
              aria-label="Filter by publication status"
              value={status}
              onChange={(event) => updateStatus(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            >
              {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
        </div>
      </section>

      {historyQuery.isLoading ? (
        <LoadingState label="Loading publishing history" />
      ) : historyQuery.isError ? (
        <InlineError message={historyQuery.error.message} retry={() => void historyQuery.refetch()} />
      ) : publications && publications.items.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-[22px] border border-dashed border-slate-300 bg-white px-5 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            {hasFilters ? <Search className="size-5" aria-hidden="true" /> : <FileText className="size-5" aria-hidden="true" />}
          </span>
          <h2 className="mt-4 text-base font-semibold text-slate-900">{hasFilters ? 'No matching publications' : 'Your publishing history is empty'}</h2>
          <p className="mt-1 max-w-sm text-sm leading-6 text-slate-500">
            {hasFilters ? 'Try another account or status filter.' : 'Create a post to see its draft and publishing progress here.'}
          </p>
          {hasFilters ? (
            <button type="button" onClick={() => { setInstagramAccountId(''); setStatus(''); setPage(1); }} className="mt-4 text-xs font-semibold text-indigo-700 hover:text-indigo-900">Clear filters</button>
          ) : (
            <Link href="/instagram/compose" className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700">
              Compose your first post <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : publications ? (
        <section aria-label="Publication history" className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
          <div className="flex flex-col justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Recent publications</h2>
              <p className="mt-1 text-xs text-slate-500">
                {publications.total === 0 ? 'No matching posts' : `${(publications.page - 1) * publications.pageSize + 1}–${Math.min(publications.page * publications.pageSize, publications.total)} of ${publications.total} posts`}
              </p>
            </div>
            {publications.items.some((item) => isInProgress(item.status)) && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                <RefreshCw className="size-3 animate-spin" aria-hidden="true" /> Checking publishing status
              </span>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {publications.items.map((publication) => <PublicationRow key={publication.id} publication={publication} />)}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 sm:px-6">
            <p className="text-xs text-slate-500">Page {publications.page} of {Math.max(1, publications.totalPages)}</p>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1 || historyQuery.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" aria-hidden="true" /> Previous
              </button>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= publications.totalPages || historyQuery.isFetching}
                onClick={() => setPage((current) => current + 1)}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function PublicationRow({ publication }: { publication: Publication }) {
  return (
    <Link
      href={`/instagram/publications/${publication.id}`}
      className="group flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50/70 sm:flex-row sm:items-center sm:px-6"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
          <Camera className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">{mediaTypeLabel(publication.mediaType)}</h3>
            <StatusBadge status={publication.status} />
          </div>
          <p className="mt-1 max-w-2xl truncate text-xs text-slate-600">{publication.caption || 'No caption'}</p>
          <p className="mt-1 truncate text-[11px] text-slate-400">
            {publication.instagramAccount.username ? `@${publication.instagramAccount.username}` : publication.instagramAccount.name || 'Instagram account'}
            {' · '}{formatDate(publication.createdAt)}
          </p>
          {publication.errorMessage && <p className="mt-1 truncate text-[11px] text-rose-600">{publication.errorMessage}</p>}
        </div>
      </div>
      <span className="inline-flex items-center gap-1 self-end text-xs font-semibold text-indigo-700 transition group-hover:gap-2 sm:self-center">
        View details <ArrowRight className="size-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

