import { backendRequest, uploadRequest } from '@/lib/api/client';

export type MediaKind = 'IMAGE' | 'VIDEO';

export interface MediaAsset {
  id: string;
  organizationId: string;
  originalFileName: string;
  mimeType: string;
  mediaKind: MediaKind;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MediaAssetPage {
  items: MediaAsset[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export const mediaAssetsQueryKey = (organizationId: string, search?: string) =>
  search === undefined
    ? ['media-assets', organizationId] as const
    : ['media-assets', organizationId, search] as const;

export function mediaAssetContentUrl(organizationId: string, assetId: string): string {
  return `/api/backend/organizations/${encodeURIComponent(organizationId)}/media-assets/${encodeURIComponent(assetId)}/content`;
}

export function listMediaAssets(
  organizationId: string,
  options: { page: number; pageSize: number; search?: string },
): Promise<MediaAssetPage> {
  const query = new URLSearchParams({
    page: String(options.page),
    pageSize: String(options.pageSize),
  });
  if (options.search) query.set('search', options.search);
  return backendRequest<MediaAssetPage>(
    `organizations/${encodeURIComponent(organizationId)}/media-assets?${query.toString()}`,
  );
}

export function getMediaAsset(organizationId: string, assetId: string): Promise<MediaAsset> {
  return backendRequest<MediaAsset>(
    `organizations/${encodeURIComponent(organizationId)}/media-assets/${encodeURIComponent(assetId)}`,
  );
}

export function uploadMediaAsset(
  organizationId: string,
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<MediaAsset> {
  const body = new FormData();
  body.append('file', file, file.name);
  return uploadRequest<MediaAsset>(
    `/api/backend/organizations/${encodeURIComponent(organizationId)}/media-assets?deduplicate=true`,
    body,
    onProgress,
  );
}

export function deleteMediaAsset(organizationId: string, assetId: string): Promise<{ id: string; deleted: boolean; storageCleanupPending: boolean }> {
  return backendRequest(
    `organizations/${encodeURIComponent(organizationId)}/media-assets/${encodeURIComponent(assetId)}`,
    { method: 'DELETE' },
  );
}

