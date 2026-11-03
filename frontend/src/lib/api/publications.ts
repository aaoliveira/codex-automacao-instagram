import { backendRequest } from '@/lib/api/client';

export type PublicationMediaType = 'PHOTO' | 'VIDEO' | 'REEL';
export type PublicationStatus =
  | 'DRAFT'
  | 'QUEUED'
  | 'PROCESSING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'CANCELED';

export interface Publication {
  id: string;
  organizationId: string;
  instagramAccountId: string;
  instagramAccount: {
    id: string;
    username: string | null;
    name: string | null;
  };
  mediaType: PublicationMediaType;
  caption: string | null;
  altText: string | null;
  shareToFeed: boolean | null;
  status: PublicationStatus;
  externalContainerId: string | null;
  externalMediaId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attemptCount: number;
  queuedAt: string | null;
  publishedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePublicationInput {
  instagramAccountId: string;
  mediaType: PublicationMediaType;
  mediaUrl?: string;
  mediaAssetId?: string;
  caption?: string;
  altText?: string;
  shareToFeed?: boolean;
  idempotencyKey: string;
}

export interface PublicationFilters {
  page: number;
  pageSize: number;
  instagramAccountId?: string;
  status?: PublicationStatus;
}

export interface PublicationPage {
  items: Publication[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const publicationsQueryKey = (organizationId: string) =>
  ['instagram-publications', organizationId] as const;

export const publicationQueryKey = (
  organizationId: string,
  publicationId: string,
) => ['instagram-publication', organizationId, publicationId] as const;

export function listPublications(
  organizationId: string,
  filters: PublicationFilters,
): Promise<PublicationPage> {
  const query = new URLSearchParams({
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  });
  if (filters.instagramAccountId)
    query.set('instagramAccountId', filters.instagramAccountId);
  if (filters.status) query.set('status', filters.status);

  return backendRequest<PublicationPage>(
    `organizations/${organizationId}/instagram/publications?${query.toString()}`,
  );
}

export function getPublication(
  organizationId: string,
  publicationId: string,
): Promise<Publication> {
  return backendRequest<Publication>(
    `organizations/${organizationId}/instagram/publications/${publicationId}`,
  );
}

export function createPublicationDraft(
  organizationId: string,
  input: CreatePublicationInput,
): Promise<Publication> {
  return backendRequest<Publication>(
    `organizations/${organizationId}/instagram/publications`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export function publishPublication(
  organizationId: string,
  publicationId: string,
): Promise<Publication> {
  return backendRequest<Publication>(
    `organizations/${organizationId}/instagram/publications/${publicationId}/publish`,
    { method: 'POST' },
  );
}
