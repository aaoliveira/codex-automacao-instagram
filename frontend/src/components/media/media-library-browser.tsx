'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  FileImage,
  Film,
  Grid2X2,
  Image as ImageIcon,
  List,
  LoaderCircle,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState } from '@/components/ui/states';
import {
  deleteMediaAsset,
  listMediaAssets,
  mediaAssetContentUrl,
  mediaAssetsQueryKey,
  uploadMediaAsset,
  type MediaAsset,
  type MediaKind,
} from '@/lib/api/media';
import { canManageTeam } from '@/lib/auth/permissions';

type MediaLibraryBrowserProps = {
  selectionMode?: boolean;
  onSelect?: (asset: MediaAsset) => void;
};

type KindFilter = 'ALL' | MediaKind;
type ViewMode = 'GRID' | 'LIST';

const PAGE_SIZE = 24;
const ACCEPTED_FILE_TYPES = 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime';
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

export function MediaLibraryBrowser({
  selectionMode = false,
  onSelect,
}: MediaLibraryBrowserProps) {
  const session = useSession();
  const queryClient = useQueryClient();
  const organizationId = session.membership.organization.id;
  const canManageMedia = canManageTeam(session.membership.role);
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL');
  const [viewMode, setViewMode] = useState<ViewMode>('GRID');
  const [dragActive, setDragActive] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadName, setUploadName] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<MediaAsset | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const assetsQuery = useInfiniteQuery({
    queryKey: mediaAssetsQueryKey(organizationId, debouncedSearch),
    queryFn: ({ pageParam }) => listMediaAssets(organizationId, {
      page: pageParam,
      pageSize: PAGE_SIZE,
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadMediaAsset(organizationId, file, setUploadProgress),
    onSuccess: (asset) => {
      void queryClient.invalidateQueries({ queryKey: mediaAssetsQueryKey(organizationId) });
      setNotice({ tone: 'success', message: `${asset.originalFileName} was added to your media library.` });
      setUploadProgress(null);
      setUploadName('');
    },
    onError: (error) => {
      setNotice({ tone: 'error', message: error.message });
      setUploadProgress(null);
      setUploadName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (asset: MediaAsset) => deleteMediaAsset(organizationId, asset.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mediaAssetsQueryKey(organizationId) });
      setNotice({ tone: 'success', message: 'Media file deleted.' });
      setAssetToDelete(null);
    },
    onError: (error) => {
      setNotice({ tone: 'error', message: error.message });
      setAssetToDelete(null);
    },
  });

  const pages = useMemo(() => assetsQuery.data?.pages ?? [], [assetsQuery.data?.pages]);
  const assets = useMemo(() => {
    const allAssets = pages.flatMap((page) => page.items);
    return kindFilter === 'ALL' ? allAssets : allAssets.filter((asset) => asset.mediaKind === kindFilter);
  }, [pages, kindFilter]);
  const total = pages[0]?.total ?? 0;

  function startUpload(file?: File) {
    if (!file) return;
    setNotice(null);
    if (!ACCEPTED_FILE_TYPES.split(',').includes(file.type)) {
      setNotice({ tone: 'error', message: 'Choose a JPEG, PNG, WebP, MP4, or QuickTime file.' });
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setNotice({ tone: 'error', message: 'The file is larger than the 100 MB upload limit.' });
      return;
    }
    if (file.size === 0) {
      setNotice({ tone: 'error', message: 'The selected file is empty.' });
      return;
    }
    setUploadName(file.name);
    setUploadProgress(0);
    uploadMutation.mutate(file);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!canManageMedia || uploadMutation.isPending) return;
    startUpload(event.dataTransfer.files[0]);
  }

  return (
    <div className="space-y-5">
      {canManageMedia && !selectionMode && (
        <div
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragActive(false);
          }}
          onDrop={handleDrop}
          className={`rounded-2xl border border-dashed px-5 py-5 transition sm:px-6 ${dragActive ? 'border-indigo-400 bg-indigo-50 ring-4 ring-indigo-100' : 'border-slate-300 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'}`}
        >
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">Drop a file here to upload</p>
              <p className="mt-1 text-xs text-slate-500">JPEG, PNG, WebP, MP4, or QuickTime · up to 100 MB</p>
            </div>
            <input
              ref={fileInput}
              aria-label="Upload media file"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              className="sr-only"
              disabled={uploadMutation.isPending}
              onChange={(event) => {
                startUpload(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploadMutation.isPending}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {uploadMutation.isPending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Upload className="size-4" aria-hidden="true" />}
              Upload file
            </button>
          </div>
          {uploadMutation.isPending && uploadProgress !== null && (
            <div className="mt-4" role="status" aria-live="polite">
              <div className="mb-1.5 flex justify-between gap-3 text-[11px] text-slate-600">
                <span className="truncate">Uploading {uploadName}</span>
                <span>{uploadProgress}%</span>
              </div>
              <progress aria-label="Upload progress" max={100} value={uploadProgress} className="h-2 w-full overflow-hidden rounded-full accent-indigo-600" />
            </div>
          )}
        </div>
      )}

      {!canManageMedia && !selectionMode && (
        <p className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3 text-xs leading-5 text-indigo-900">
          You can browse and select media. An owner or admin can upload and delete files.
        </p>
      )}

      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${notice.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
          <span>{notice.message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)} className="shrink-0 rounded p-0.5 hover:bg-black/5"><X className="size-3.5" aria-hidden="true" /></button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search media files</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search media files"
            placeholder="Search file names…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
          />
        </label>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1" aria-label="Filter by media type">
            {([['ALL', 'All'], ['IMAGE', 'Images'], ['VIDEO', 'Videos']] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setKindFilter(value)}
                aria-pressed={kindFilter === value}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition sm:px-3 ${kindFilter === value ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
              >{label}</button>
            ))}
          </div>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1" aria-label="Media view">
            <button type="button" aria-label="Grid view" aria-pressed={viewMode === 'GRID'} onClick={() => setViewMode('GRID')} className={`rounded-lg p-1.5 ${viewMode === 'GRID' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400 hover:text-slate-700'}`}><Grid2X2 className="size-4" aria-hidden="true" /></button>
            <button type="button" aria-label="List view" aria-pressed={viewMode === 'LIST'} onClick={() => setViewMode('LIST')} className={`rounded-lg p-1.5 ${viewMode === 'LIST' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400 hover:text-slate-700'}`}><List className="size-4" aria-hidden="true" /></button>
          </div>
        </div>
      </div>

      {!assetsQuery.isLoading && !assetsQuery.isError && (
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>{kindFilter === 'ALL' ? total : `${assets.length}${assetsQuery.hasNextPage ? '+' : ''}`} {kindFilter === 'VIDEO' ? 'videos' : kindFilter === 'IMAGE' ? 'images' : 'files'}</span>
          {selectionMode && <span>Select a file to use in your post.</span>}
        </div>
      )}

      {assetsQuery.isLoading ? (
        <LoadingState label="Loading media library" />
      ) : assetsQuery.isError ? (
        <InlineError message={assetsQuery.error.message} retry={() => void assetsQuery.refetch()} />
      ) : assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            {debouncedSearch || kindFilter !== 'ALL' ? <Search className="size-5" aria-hidden="true" /> : <FileImage className="size-5" aria-hidden="true" />}
          </span>
          <h2 className="mt-4 text-sm font-semibold text-slate-900">{debouncedSearch ? 'No files match that search' : kindFilter !== 'ALL' ? 'No files of this type yet' : 'Your media library is empty'}</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-slate-500">
            {debouncedSearch || kindFilter !== 'ALL' ? 'Try another search or filter.' : selectionMode ? 'Upload a photo or video in the media library, then come back here to select it.' : 'Upload a photo or video to preview it and use it in the Composer.'}
          </p>
          {selectionMode && total === 0 && <Link href="/media" className="mt-4 inline-flex text-xs font-semibold text-indigo-700 underline underline-offset-4">Open media library</Link>}
          {!selectionMode && (debouncedSearch || kindFilter !== 'ALL') && <button type="button" onClick={() => { setSearch(''); setKindFilter('ALL'); }} className="mt-4 text-xs font-semibold text-indigo-700 underline underline-offset-4">Clear search and filters</button>}
        </div>
      ) : (
        <div className={viewMode === 'GRID' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4' : 'space-y-2'}>
          {assets.map((asset) => (
            <MediaAssetCard
              key={asset.id}
              asset={asset}
              organizationId={organizationId}
              viewMode={viewMode}
              canManage={canManageMedia && !selectionMode}
              selectionMode={selectionMode}
              onSelect={onSelect}
              onDelete={() => setAssetToDelete(asset)}
            />
          ))}
        </div>
      )}

      {assetsQuery.hasNextPage && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => void assetsQuery.fetchNextPage()}
            disabled={assetsQuery.isFetchingNextPage}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {assetsQuery.isFetchingNextPage && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
            {assetsQuery.isFetchingNextPage ? 'Loading files…' : 'Load more'}
          </button>
        </div>
      )}

      {assetToDelete && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="presentation">
          <section role="dialog" aria-modal="true" aria-labelledby="delete-media-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 text-rose-600"><Trash2 className="size-4" aria-hidden="true" /></span>
              <div className="min-w-0">
                <h2 id="delete-media-title" className="text-sm font-semibold text-slate-900">Delete this media file?</h2>
                <p className="mt-1 break-words text-xs leading-5 text-slate-500">{assetToDelete.originalFileName} will be removed from storage. Files used by an active draft or queued post cannot be deleted.</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setAssetToDelete(null)} disabled={deleteMutation.isPending} className="h-9 rounded-lg border border-slate-200 px-3.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Keep file</button>
              <button type="button" onClick={() => deleteMutation.mutate(assetToDelete)} disabled={deleteMutation.isPending} className="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-3.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                {deleteMutation.isPending && <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />}
                Delete file
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MediaAssetCard({
  asset,
  organizationId,
  viewMode,
  canManage,
  selectionMode,
  onSelect,
  onDelete,
}: {
  asset: MediaAsset;
  organizationId: string;
  viewMode: ViewMode;
  canManage: boolean;
  selectionMode: boolean;
  onSelect?: (asset: MediaAsset) => void;
  onDelete: () => void;
}) {
  const previewUrl = mediaAssetContentUrl(organizationId, asset.id);
  const isList = viewMode === 'LIST';
  return (
    <article className={`group overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md ${isList ? 'flex items-center gap-3 p-2.5 sm:gap-4 sm:p-3' : ''}`}>
      <div className={`relative overflow-hidden bg-slate-100 ${isList ? 'size-[72px] shrink-0 rounded-xl sm:size-20' : 'aspect-square'}`}>
        {asset.mediaKind === 'IMAGE' ? (
          // The authenticated same-origin proxy streams the bytes without using the Next image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={asset.originalFileName} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
        ) : (
          <video src={previewUrl} aria-label={`${asset.originalFileName} preview`} controls preload="metadata" className="size-full object-cover" />
        )}
        {!isList && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-slate-950/60 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur-sm">{asset.mediaKind === 'IMAGE' ? <ImageIcon className="size-3" aria-hidden="true" /> : <Film className="size-3" aria-hidden="true" />}{asset.mediaKind === 'IMAGE' ? 'Image' : 'Video'}</span>}
      </div>
      <div className={`min-w-0 ${isList ? 'flex-1' : 'p-3'}`}>
        <p title={asset.originalFileName} className="truncate text-xs font-semibold text-slate-800">{asset.originalFileName}</p>
        <p className="mt-1 truncate text-[10px] text-slate-500">{formatFileDetails(asset)}</p>
        <div className={`mt-3 flex items-center gap-2 ${isList ? 'sm:mt-0 sm:justify-end' : ''}`}>
          {selectionMode ? (
            <button type="button" onClick={() => onSelect?.(asset)} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 text-[10px] font-semibold text-white transition hover:bg-indigo-700 sm:text-[11px]">
              <Check className="size-3.5" aria-hidden="true" /> Select file
            </button>
          ) : (
            <Link href={`/instagram/compose?mediaAssetId=${encodeURIComponent(asset.id)}`} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 text-[10px] font-semibold text-white transition hover:bg-indigo-700 sm:text-[11px]">
              <Check className="size-3.5" aria-hidden="true" /> Use in Composer
            </Link>
          )}
          {canManage && <button type="button" onClick={onDelete} aria-label={`Delete ${asset.originalFileName}`} className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-3.5" aria-hidden="true" /></button>}
        </div>
      </div>
    </article>
  );
}

function formatFileDetails(asset: MediaAsset): string {
  const size = asset.sizeBytes >= 1024 * 1024
    ? `${(asset.sizeBytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(asset.sizeBytes / 1024))} KB`;
  const dimensions = asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : '';
  return `${size}${dimensions} · ${new Date(asset.createdAt).toLocaleDateString()}`;
}
