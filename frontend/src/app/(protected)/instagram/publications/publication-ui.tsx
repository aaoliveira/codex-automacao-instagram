import { Clock3, RefreshCw } from 'lucide-react';
import type { PublicationMediaType, PublicationStatus } from '@/lib/api/publications';

export function StatusBadge({ status }: { status: PublicationStatus }) {
  const styles: Record<PublicationStatus, string> = {
    DRAFT: 'bg-slate-100 text-slate-600',
    QUEUED: 'bg-amber-50 text-amber-700',
    PROCESSING: 'bg-indigo-50 text-indigo-700',
    PUBLISHED: 'bg-emerald-50 text-emerald-700',
    FAILED: 'bg-rose-50 text-rose-700',
    CANCELED: 'bg-slate-100 text-slate-500',
  };
  const labels: Record<PublicationStatus, string> = {
    DRAFT: 'Draft',
    QUEUED: 'Queued',
    PROCESSING: 'Processing',
    PUBLISHED: 'Published',
    FAILED: 'Failed',
    CANCELED: 'Canceled',
  };
  return (
    <span data-status={status} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold ${styles[status]}`}>
      {status === 'PROCESSING' && <RefreshCw className="size-3 animate-spin" aria-hidden="true" />}
      {status === 'QUEUED' && <Clock3 className="size-3" aria-hidden="true" />}
      {status === 'PUBLISHED' && <span className="size-1.5 rounded-full bg-emerald-500" />}
      {labels[status]}
    </span>
  );
}

export function mediaTypeLabel(mediaType: PublicationMediaType): string {
  if (mediaType === 'PHOTO') return 'Photo post';
  if (mediaType === 'VIDEO') return 'Video post';
  return 'Instagram Reel';
}

export function isInProgress(status: PublicationStatus): boolean {
  return status === 'QUEUED' || status === 'PROCESSING';
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
