'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Camera,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { InlineError, LoadingState } from '@/components/ui/states';
import { useSession } from '@/components/session-context';
import {
  getPublication,
  publicationQueryKey,
  type Publication,
  type PublicationStatus,
} from '@/lib/api/publications';
import {
  formatDate,
  isInProgress,
  mediaTypeLabel,
  StatusBadge,
} from '../publication-ui';

export default function PublicationDetails({ publicationId }: { publicationId: string }) {
  const session = useSession();
  const organizationId = session.membership.organization.id;
  const publicationQuery = useQuery({
    queryKey: publicationQueryKey(organizationId, publicationId),
    queryFn: () => getPublication(organizationId, publicationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isInProgress(status) ? 2_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  if (publicationQuery.isLoading) return <LoadingState label="Loading publication details" />;
  if (publicationQuery.isError) {
    return (
      <div className="space-y-5">
        <Link href="/instagram/publications" className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-indigo-700">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> Publishing history
        </Link>
        <InlineError message={publicationQuery.error.message} retry={() => void publicationQuery.refetch()} />
      </div>
    );
  }
  if (!publicationQuery.data) return null;

  const publication = publicationQuery.data;
  const busy = isInProgress(publication.status);

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Link href="/instagram/publications" className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-500 transition hover:text-indigo-700">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Publishing history
          </Link>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">Publication details</p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            {mediaTypeLabel(publication.mediaType)}<span className="text-indigo-600">.</span>
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">Created {formatDate(publication.createdAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={publication.status} />
          {busy && <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400"><RefreshCw className="size-3 animate-spin" aria-hidden="true" /> Auto-updating</span>}
        </div>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <PublicationProgress publication={publication} />

          {publication.status === 'FAILED' && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden="true" />
              <div>
                <p className="font-semibold">Instagram could not publish this post.</p>
                <p className="mt-1 leading-5 text-rose-700">{publication.errorMessage || 'Review the account connection and media, then create a new publication.'}</p>
                {publication.errorCode && <p className="mt-2 font-mono text-[10px] text-rose-600">{publication.errorCode}</p>}
              </div>
            </div>
          )}

          <section className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4 sm:px-6">
              <h2 className="text-sm font-semibold text-slate-900">Post content</h2>
              <p className="mt-1 text-xs text-slate-500">The content details submitted to the backend.</p>
            </div>
            <div className="space-y-5 p-5 sm:p-6">
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200/80">
                  <Camera className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-medium uppercase tracking-wide text-slate-400">Instagram account</span>
                  <span className="mt-1 block truncate text-sm font-semibold text-slate-800">
                    {publication.instagramAccount.username ? `@${publication.instagramAccount.username}` : publication.instagramAccount.name || 'Instagram account'}
                  </span>
                </span>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[9px] font-semibold text-indigo-700">{publication.mediaType}</span>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Caption</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{publication.caption || <span className="text-slate-400">No caption was added.</span>}</p>
              </div>
              {publication.altText && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Image description</p>
                  <p className="mt-2 text-sm leading-6 text-slate-700">{publication.altText}</p>
                </div>
              )}
              {publication.mediaType === 'REEL' && publication.shareToFeed !== null && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Feed distribution</p>
                  <p className="mt-2 text-sm text-slate-700">{publication.shareToFeed ? 'Also shared to feed' : 'Reel only'}</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-[96px]">
          <section className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className={`flex size-10 items-center justify-center rounded-xl ${publication.status === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-600' : publication.status === 'FAILED' ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                {publication.status === 'PUBLISHED' ? <CheckCircle2 className="size-5" aria-hidden="true" /> : publication.status === 'FAILED' ? <CircleAlert className="size-5" aria-hidden="true" /> : busy ? <LoaderCircle className="size-5 animate-spin" aria-hidden="true" /> : <Clock3 className="size-5" aria-hidden="true" />}
              </span>
              <span>
                <span className="block text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">Current status</span>
                <span className="mt-1 block text-sm font-semibold text-slate-900">{statusLabel(publication.status)}</span>
              </span>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">{statusDescription(publication.status)}</p>
            <div className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-xs">
              <DataRow label="Created" value={formatDate(publication.createdAt)} />
              {publication.queuedAt && <DataRow label="Sent to queue" value={formatDate(publication.queuedAt)} />}
              {publication.publishedAt && <DataRow label="Published" value={formatDate(publication.publishedAt)} />}
              {publication.canceledAt && <DataRow label="Canceled" value={formatDate(publication.canceledAt)} />}
              <DataRow label="Attempts" value={String(publication.attemptCount)} />
            </div>
          </section>

          <section className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-indigo-600" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-slate-900">Provider references</h2>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-slate-500">Safe identifiers from the publishing provider.</p>
            <div className="mt-4 space-y-3">
              <DataRow label="Container ID" value={publication.externalContainerId || 'Not created yet'} mono />
              <DataRow label="Media ID" value={publication.externalMediaId || 'Not published yet'} mono />
            </div>
            <div className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-4 text-[10px] leading-4 text-slate-400">
              <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> Tokens and source media URLs are never displayed on this page.
            </div>
          </section>

          <Link href="/instagram/compose" className="flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700">
            Create another post <ArrowLeft className="size-3.5 rotate-180" aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </div>
  );
}

function PublicationProgress({ publication }: { publication: Publication }) {
  const steps: Array<{ status: PublicationStatus; title: string; detail: string }> = [
    { status: 'DRAFT', title: 'Draft created', detail: 'Content saved in this workspace' },
    { status: 'QUEUED', title: 'Added to queue', detail: 'Waiting for a publishing worker' },
    { status: 'PROCESSING', title: 'Sending to Instagram', detail: 'Media is being prepared and published' },
    { status: publication.status === 'FAILED' ? 'FAILED' : publication.status === 'CANCELED' ? 'CANCELED' : 'PUBLISHED', title: publication.status === 'FAILED' ? 'Publishing failed' : publication.status === 'CANCELED' ? 'Publication canceled' : 'Published', detail: publication.status === 'FAILED' ? 'Review the error details below' : publication.status === 'CANCELED' ? 'This item will not be published' : 'Your post is live on Instagram' },
  ];
  const final = publication.status === 'PUBLISHED' || publication.status === 'FAILED' || publication.status === 'CANCELED';
  const completedIndex = publication.status === 'DRAFT' ? 0 : publication.status === 'QUEUED' ? 1 : publication.status === 'PROCESSING' ? 2 : 3;

  return (
    <section className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Publishing progress</h2>
          <p className="mt-1 text-xs text-slate-500">Updates automatically while the post is queued or processing.</p>
        </div>
        {isInProgress(publication.status) && <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-indigo-600"><RefreshCw className="size-3 animate-spin" aria-hidden="true" /> Refreshing</span>}
      </div>
      <ol className="mt-5 space-y-4">
        {steps.map((step, index) => {
          const isCurrent = index === completedIndex;
          const isComplete = index < completedIndex || publication.status === 'PUBLISHED' && index === 3;
          const isFailed = isCurrent && publication.status === 'FAILED';
          const isCanceled = isCurrent && publication.status === 'CANCELED';
          return (
            <li key={step.status} className="flex items-start gap-3">
              <span className={`relative mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${isFailed ? 'bg-rose-100 text-rose-700' : isCanceled ? 'bg-slate-100 text-slate-500' : isComplete ? 'bg-emerald-100 text-emerald-700' : isCurrent ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}>
                {isFailed ? <CircleAlert className="size-3.5" aria-hidden="true" /> : isCanceled ? <Clock3 className="size-3.5" aria-hidden="true" /> : isComplete ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" /> : isCurrent && isInProgress(publication.status) ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <span className="size-1.5 rounded-full bg-current" />}
                {index < steps.length - 1 && <span className={`absolute left-1/2 top-7 h-4 w-px -translate-x-1/2 ${isComplete ? 'bg-emerald-200' : 'bg-slate-200'}`} />}
              </span>
              <span className="min-w-0 flex-1 pb-1">
                <span className={`block text-xs font-semibold ${isFailed ? 'text-rose-700' : isCurrent || isComplete ? 'text-slate-800' : 'text-slate-400'}`}>{step.title}</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-slate-400">{step.detail}</span>
              </span>
              {isCurrent && !final && <span className="mt-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-semibold text-indigo-700">Current</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DataRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-400">{label}</span>
      <span className={`min-w-0 break-all text-right font-medium text-slate-700 ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}

function statusLabel(status: PublicationStatus): string {
  const labels: Record<PublicationStatus, string> = {
    DRAFT: 'Draft saved',
    QUEUED: 'Waiting in queue',
    PROCESSING: 'Publishing in progress',
    PUBLISHED: 'Published',
    FAILED: 'Failed',
    CANCELED: 'Canceled',
  };
  return labels[status];
}

function statusDescription(status: PublicationStatus): string {
  const descriptions: Record<PublicationStatus, string> = {
    DRAFT: 'This post is saved as a draft and has not been sent to Instagram.',
    QUEUED: 'The request is waiting for an available publishing worker.',
    PROCESSING: 'The backend is preparing the media and checking its Instagram status.',
    PUBLISHED: 'Instagram confirmed this post was published.',
    FAILED: 'The backend stopped after a permanent error or the retry limit.',
    CANCELED: 'This publication was canceled before processing began.',
  };
  return descriptions[status];
}
