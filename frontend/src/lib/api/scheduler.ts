import { backendRequest } from '@/lib/api/client';
import type { Publication, PublicationPage } from '@/lib/api/publications';

export type QueueJobState =
  | 'WAITING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED';

export interface PublicationJob {
  id: string;
  domain: 'INSTAGRAM_PUBLICATION';
  name: string;
  publicationId: string;
  instagramAccountId: string;
  instagramAccount: {
    id: string;
    username: string | null;
    name: string | null;
  };
  state: QueueJobState;
  queueState: string;
  attemptsMade: number;
  maxAttempts: number;
  scheduledAt: string | null;
  timezone: string | null;
  enqueuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Page<T> {
  items: T[];
  totalPages: number;
}

const PAGE_SIZE = 100;

async function fetchAllPages<T>(
  path: string,
  firstPage: Page<T>,
): Promise<T[]> {
  if (firstPage.totalPages <= 1) return firstPage.items;

  const items = [...firstPage.items];
  for (let start = 2; start <= firstPage.totalPages; start += 5) {
    const batch = await Promise.all(
      Array.from(
        { length: Math.min(5, firstPage.totalPages - start + 1) },
        (_, index) => backendRequest<Page<T>>(
          `${path}?page=${start + index}&pageSize=${PAGE_SIZE}`,
        ),
      ),
    );
    items.push(...batch.flatMap((page) => page.items));
  }
  return items;
}

export async function listPublicationJobs(
  organizationId: string,
): Promise<PublicationJob[]> {
  const path = `organizations/${organizationId}/jobs`;
  const firstPage = await backendRequest<Page<PublicationJob>>(
    `${path}?page=1&pageSize=${PAGE_SIZE}`,
  );
  return fetchAllPages(path, firstPage);
}

export async function listAllPublications(
  organizationId: string,
): Promise<Publication[]> {
  const path = `organizations/${organizationId}/instagram/publications`;
  const firstPage = await backendRequest<PublicationPage>(
    `${path}?page=1&pageSize=${PAGE_SIZE}`,
  );
  return fetchAllPages(path, firstPage);
}

export interface SchedulePublicationInput {
  scheduledAt: string;
  timezone: string;
}

export function schedulePublication(
  organizationId: string,
  publicationId: string,
  input: SchedulePublicationInput,
): Promise<Publication> {
  return backendRequest<Publication>(
    `organizations/${organizationId}/instagram/publications/${publicationId}/schedule`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function cancelPublicationJob(
  organizationId: string,
  publicationId: string,
): Promise<Publication> {
  return backendRequest<Publication>(
    `organizations/${organizationId}/jobs/publications/${publicationId}/cancel`,
    { method: 'POST' },
  );
}

export function retryPublicationJob(
  organizationId: string,
  publicationId: string,
): Promise<Publication> {
  return backendRequest<Publication>(
    `organizations/${organizationId}/jobs/publications/${publicationId}/retry`,
    { method: 'POST' },
  );
}

export const schedulerJobsQueryKey = (organizationId: string) =>
  ['scheduler-jobs', organizationId] as const;

export const schedulerPublicationsQueryKey = (organizationId: string) =>
  ['scheduler-publications', organizationId] as const;
