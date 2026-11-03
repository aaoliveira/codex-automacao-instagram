'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  Camera,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  Image as ImageIcon,
  Images,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Play,
  ShieldCheck,
  Sparkles,
  Video,
  X,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState } from '@/components/ui/states';
import { instagramAccountsQueryKey, listInstagramAccounts } from '@/lib/api/instagram';
import {
  createPublicationDraft,
  publishPublication,
  publicationsQueryKey,
  type CreatePublicationInput,
  type PublicationMediaType,
} from '@/lib/api/publications';
import type { InstagramAccount } from '@/lib/api/types';
import { canManageTeam } from '@/lib/auth/permissions';
import { getMediaAsset, mediaAssetContentUrl, type MediaAsset } from '@/lib/api/media';
import { MediaLibraryBrowser } from '@/components/media/media-library-browser';

type ComposerValues = {
  instagramAccountId: string;
  mediaType: PublicationMediaType;
  mediaUrl: string;
  mediaAssetId: string;
  caption: string;
  altText: string;
  shareToFeed: boolean;
};

type CreateMode = 'DRAFT' | 'PUBLISH_NOW';
type Notice = { tone: 'success' | 'error' | 'info'; message: string };

const INITIAL_VALUES: ComposerValues = {
  instagramAccountId: '',
  mediaType: 'PHOTO',
  mediaUrl: '',
  mediaAssetId: '',
  caption: '',
  altText: '',
  shareToFeed: true,
};

const mediaChoices: Array<{
  value: PublicationMediaType;
  label: string;
  detail: string;
  icon: typeof ImageIcon;
}> = [
  { value: 'PHOTO', label: 'Photo', detail: 'Single image', icon: ImageIcon },
  { value: 'VIDEO', label: 'Video', detail: 'Feed video', icon: Video },
  { value: 'REEL', label: 'Reel', detail: 'Vertical video', icon: Play },
];

export default function InstagramComposer({ initialMediaAssetId = null }: { initialMediaAssetId?: string | null }) {
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const organizationId = session.membership.organization.id;
  const canPublish = canManageTeam(session.membership.role);
  const idempotencyKey = useRef<string | null>(null);
  const [values, setValues] = useState<ComposerValues>(INITIAL_VALUES);
  const [showValidation, setShowValidation] = useState(false);
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [selectedMediaAsset, setSelectedMediaAsset] = useState<MediaAsset | null>(null);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [assetLoadCompleteId, setAssetLoadCompleteId] = useState<string | null>(null);
  const loadingInitialAsset = Boolean(initialMediaAssetId && assetLoadCompleteId !== initialMediaAssetId);

  const accountsQuery = useQuery({
    queryKey: instagramAccountsQueryKey(organizationId),
    queryFn: () => listInstagramAccounts(organizationId),
  });
  const accounts = useMemo(
    () => (accountsQuery.data ?? []).filter(isConnectedAccount),
    [accountsQuery.data],
  );
  const selectedAccount = accounts.find(
    (account) => account.id === values.instagramAccountId,
  );
  const assetMediaError = selectedMediaAsset && values.mediaAssetId
    ? (values.mediaType === 'PHOTO' && selectedMediaAsset.mediaKind !== 'IMAGE') || (values.mediaType !== 'PHOTO' && selectedMediaAsset.mediaKind !== 'VIDEO')
      ? `Choose a ${values.mediaType === 'PHOTO' ? 'photo' : 'video'} for this post type.`
      : null
    : values.mediaAssetId ? 'The selected library file could not be loaded.' : null;
  const mediaError = values.mediaAssetId ? assetMediaError : validateMediaUrl(values.mediaUrl);
  const mediaReady = values.mediaAssetId
    ? Boolean(selectedMediaAsset && !assetMediaError)
    : Boolean(values.mediaUrl.trim() && !mediaError);
  const mediaPreviewUrl = selectedMediaAsset && values.mediaAssetId
    ? mediaAssetContentUrl(organizationId, selectedMediaAsset.id)
    : values.mediaUrl;
  const captionError = values.caption.length > 2200;
  const altTextError = values.altText.length > 1000;
  const publishMutation = useMutation({
    mutationFn: (publicationId: string) =>
      publishPublication(organizationId, publicationId),
    onSuccess: (publication) => {
      void queryClient.invalidateQueries({
        queryKey: publicationsQueryKey(organizationId),
      });
      router.push(`/instagram/publications/${publication.id}`);
    },
    onError: (error) => {
      setNotice({
        tone: 'error',
        message: `The draft was saved, but could not be queued: ${error.message}`,
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ input, mode }: { input: CreatePublicationInput; mode: CreateMode }) =>
      createPublicationDraft(organizationId, input).then((publication) => ({ publication, mode })),
    onSuccess: ({ publication, mode }) => {
      setSavedDraftId(publication.id);
      void queryClient.invalidateQueries({
        queryKey: publicationsQueryKey(organizationId),
      });
      if (mode === 'PUBLISH_NOW') {
        setNotice({ tone: 'info', message: 'Draft saved. Sending it to the publishing queue…' });
        publishMutation.mutate(publication.id);
      } else {
        setNotice({ tone: 'success', message: 'Draft saved to your publishing history.' });
      }
    },
  });

  const isBusy = createMutation.isPending || publishMutation.isPending;
  const readyToSubmit = Boolean(
    canPublish &&
      selectedAccount &&
      mediaReady &&
      !captionError &&
      !altTextError,
  );

  function updateValue<Key extends keyof ComposerValues>(
    key: Key,
    value: ComposerValues[Key],
  ) {
    setValues((current) => ({
      ...current,
      [key]: value,
      ...(key === 'mediaUrl' ? { mediaAssetId: '' } : {}),
    }));
    if (key === 'mediaUrl') setSelectedMediaAsset(null);
    idempotencyKey.current = newIdempotencyKey();
    setSavedDraftId(null);
    setNotice(null);
    setPreviewFailed(false);
  }

  function selectMediaAsset(asset: MediaAsset) {
    setSelectedMediaAsset(asset);
    setValues((current) => ({
      ...current,
      mediaAssetId: asset.id,
      mediaUrl: '',
      mediaType: asset.mediaKind === 'IMAGE' ? 'PHOTO' : 'VIDEO',
      altText: asset.mediaKind === 'IMAGE' ? current.altText : '',
    }));
    setMediaPickerOpen(false);
    idempotencyKey.current = newIdempotencyKey();
    setSavedDraftId(null);
    setNotice(null);
    setPreviewFailed(false);
  }

  function clearSelectedMedia() {
    setSelectedMediaAsset(null);
    setValues((current) => ({ ...current, mediaAssetId: '' }));
    idempotencyKey.current = newIdempotencyKey();
    setSavedDraftId(null);
    setNotice(null);
    setPreviewFailed(false);
  }

  useEffect(() => {
    if (!initialMediaAssetId) return;
    let active = true;
    getMediaAsset(organizationId, initialMediaAssetId)
      .then((asset) => {
        if (active) selectMediaAsset(asset);
      })
      .catch((error: Error) => {
        if (active) setNotice({ tone: 'error', message: `Could not load the selected media file: ${error.message}` });
      })
      .finally(() => {
        if (active) setAssetLoadCompleteId(initialMediaAssetId);
      });
    return () => { active = false; };
    // This deep link is applied once on mount. Subsequent selections happen through the picker.
  }, [initialMediaAssetId, organizationId]);

  function updateMediaType(mediaType: PublicationMediaType) {
    setValues((current) => ({
      ...current,
      mediaType,
      altText: mediaType === 'PHOTO' ? current.altText : '',
      shareToFeed: mediaType === 'REEL' ? current.shareToFeed : true,
    }));
    idempotencyKey.current = newIdempotencyKey();
    setSavedDraftId(null);
    setNotice(null);
    setPreviewFailed(false);
  }

  function submit(mode: CreateMode) {
    setShowValidation(true);
    setNotice(null);
    if (!readyToSubmit || !selectedAccount) return;

    if (!idempotencyKey.current) idempotencyKey.current = newIdempotencyKey();
    const input: CreatePublicationInput = {
      instagramAccountId: values.instagramAccountId,
      mediaType: values.mediaType,
      ...(values.mediaAssetId ? { mediaAssetId: values.mediaAssetId } : { mediaUrl: values.mediaUrl.trim() }),
      idempotencyKey: idempotencyKey.current,
      ...(values.caption ? { caption: values.caption } : {}),
      ...(values.mediaType === 'PHOTO' && values.altText
        ? { altText: values.altText }
        : {}),
      ...(values.mediaType === 'REEL'
        ? { shareToFeed: values.shareToFeed }
        : {}),
    };
    createMutation.mutate({ input, mode });
  }

  const validationItems = [
    {
      label: 'Connected Instagram account',
      ready: Boolean(selectedAccount),
      detail: selectedAccount ? `@${selectedAccount.username ?? selectedAccount.name ?? 'Instagram account'}` : 'Choose an account',
    },
    {
      label: 'Media file',
      ready: mediaReady,
      detail: selectedMediaAsset && !mediaError ? selectedMediaAsset.originalFileName : mediaError ?? 'Choose a library file or add a public HTTPS URL',
    },
    {
      label: 'Caption',
      ready: !captionError,
      detail: captionError ? 'Caption is over the 2,200 character limit' : `${values.caption.length}/2,200 characters`,
    },
    ...(values.mediaType === 'PHOTO'
      ? [{
          label: 'Image alt text',
          ready: !altTextError,
          detail: altTextError ? 'Alt text is over the 1,000 character limit' : 'Optional accessibility description',
        }]
      : []),
  ];

  if (accountsQuery.isLoading) return <LoadingState label="Loading connected Instagram accounts" />;
  if (accountsQuery.isError) {
    return (
      <InlineError
        message={accountsQuery.error.message}
        retry={() => void accountsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            Publishing studio
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Create a post<span className="text-indigo-600">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Shape your content, check the preview, and publish to a connected professional account.
          </p>
        </div>
        <Link
          href="/instagram/publications"
          className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:self-auto"
        >
          <Clock3 className="size-3.5" aria-hidden="true" /> Publishing history
        </Link>
      </div>

      {!canPublish && (
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm text-indigo-900">
          <LockKeyhole className="mt-0.5 size-4 shrink-0 text-indigo-600" aria-hidden="true" />
          <p className="leading-5">You can review publishing content. An owner or admin can create and publish posts.</p>
        </div>
      )}

      {notice && <NoticeBanner notice={notice} draftId={savedDraftId} />}

      {accounts.length === 0 ? (
        <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-6 py-14 text-center shadow-sm">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Camera className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-lg font-semibold tracking-tight text-slate-900">Connect an account to get started</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
            Add a professional Instagram account to choose where your content should go.
          </p>
          {canPublish && (
            <Link
              href="/instagram/accounts"
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700"
            >
              Connect Instagram account <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)] xl:gap-6">
          <section className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-indigo-600">01 · Content</p>
              <h2 className="mt-1.5 text-base font-semibold tracking-tight text-slate-900">Build your post</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500">Choose a format, account, and the media link Instagram can access.</p>
            </div>

            <div className="space-y-6 px-5 py-6 sm:px-7">
              <fieldset>
                <legend className="mb-2.5 text-xs font-semibold text-slate-700">Content format</legend>
                <div role="radiogroup" aria-label="Content format" className="grid grid-cols-3 gap-2">
                  {mediaChoices.map(({ value, label, detail, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={values.mediaType === value}
                      onClick={() => updateMediaType(value)}
                      disabled={isBusy}
                      className={`flex min-w-0 flex-col items-start rounded-xl border px-3 py-3 text-left transition ${values.mediaType === value ? 'border-indigo-300 bg-indigo-50/70 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'} disabled:opacity-60`}
                    >
                      <span className={`flex size-8 items-center justify-center rounded-lg ${values.mediaType === value ? 'bg-white text-indigo-600 shadow-sm' : 'bg-slate-100 text-slate-500'}`}>
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="mt-2.5 text-xs font-semibold text-slate-800">{label}</span>
                      <span className="mt-0.5 text-[10px] text-slate-500">{detail}</span>
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="block space-y-2 text-xs font-semibold text-slate-700">
                Instagram account
                <select
                  aria-label="Instagram account"
                  value={values.instagramAccountId}
                  onChange={(event) => updateValue('instagramAccountId', event.target.value)}
                  disabled={isBusy || !canPublish}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
                >
                  <option value="">Choose a connected account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.username ? `@${account.username}` : account.name || 'Instagram account'} · {account.provider}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-3 text-xs font-semibold text-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>Media</span>
                  <button
                    type="button"
                    onClick={() => setMediaPickerOpen(true)}
                    disabled={isBusy || !canPublish}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                  >
                    <Images className="size-3.5" aria-hidden="true" /> Choose from library
                  </button>
                </div>
                {selectedMediaAsset && values.mediaAssetId && (
                  <div className="flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5">
                    <span className="relative size-12 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                      {selectedMediaAsset.mediaKind === 'IMAGE' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaPreviewUrl} alt={selectedMediaAsset.originalFileName} className="size-full object-cover" />
                      ) : <video src={mediaPreviewUrl} aria-label={`${selectedMediaAsset.originalFileName} preview`} className="size-full object-cover" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-800">{selectedMediaAsset.originalFileName}</span>
                      <span className="mt-0.5 block text-[10px] font-normal text-slate-500">{selectedMediaAsset.mediaKind === 'IMAGE' ? 'Image' : 'Video'} · {formatComposerMediaSize(selectedMediaAsset.sizeBytes)}</span>
                    </span>
                    <button type="button" onClick={clearSelectedMedia} disabled={isBusy} className="shrink-0 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-white hover:text-slate-900">Remove</button>
                  </div>
                )}
                {loadingInitialAsset && <p role="status" className="text-[11px] font-normal text-slate-500">Loading selected media…</p>}
                <label className="block space-y-2 font-semibold text-slate-700">
                  Public media URL <span className="font-normal text-slate-400">(optional)</span>
                  <span className="relative block">
                  <Link2 className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    aria-label="Public media URL"
                    type="url"
                    inputMode="url"
                    placeholder="https://cdn.example.com/your-photo.jpg"
                    value={values.mediaUrl}
                    onChange={(event) => updateValue('mediaUrl', event.target.value)}
                    disabled={isBusy || !canPublish}
                    aria-invalid={showValidation && Boolean(mediaError)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-sm font-normal text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
                  />
                </span>
                <span className="block text-[11px] font-normal leading-5 text-slate-500">
                  Use a public HTTPS link, or choose a file already uploaded to your organization’s media library.
                </span>
                {showValidation && mediaError && <span className="block text-[11px] font-medium text-rose-600">{mediaError}</span>}
              </label>
              </div>

              <label className="block space-y-2 text-xs font-semibold text-slate-700">
                Caption
                <textarea
                  aria-label="Caption"
                  rows={6}
                  maxLength={2400}
                  placeholder="Write a caption for your community…"
                  value={values.caption}
                  onChange={(event) => updateValue('caption', event.target.value)}
                  disabled={isBusy || !canPublish}
                  aria-invalid={captionError}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-normal leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
                />
                <span className={`block text-right text-[10px] font-normal ${captionError ? 'text-rose-600' : 'text-slate-400'}`}>
                  {values.caption.length.toLocaleString()}/2,200
                </span>
              </label>

              {values.mediaType === 'PHOTO' && (
                <label className="block space-y-2 text-xs font-semibold text-slate-700">
                  Alt text <span className="font-normal text-slate-400">(optional)</span>
                  <input
                    aria-label="Alt text"
                    type="text"
                    maxLength={1100}
                    placeholder="Describe the image for accessibility"
                    value={values.altText}
                    onChange={(event) => updateValue('altText', event.target.value)}
                    disabled={isBusy || !canPublish}
                    aria-invalid={altTextError}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-normal text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
                  />
                  {showValidation && altTextError && <span className="block text-[11px] font-medium text-rose-600">Alt text must be 1,000 characters or fewer.</span>}
                </label>
              )}

              {values.mediaType === 'REEL' && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                  <input
                    aria-label="Also share to feed"
                    type="checkbox"
                    checked={values.shareToFeed}
                    onChange={(event) => updateValue('shareToFeed', event.target.checked)}
                    disabled={isBusy || !canPublish}
                    className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-slate-800">Also share to feed</span>
                    <span className="mt-1 block text-[11px] leading-4 text-slate-500">Show this Reel in the account’s main feed.</span>
                  </span>
                </label>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <Link href="/instagram/publications" className="inline-flex h-10 items-center justify-center rounded-xl px-3 text-xs font-semibold text-slate-600 transition hover:bg-white hover:text-slate-900">
                Cancel
              </Link>
              <div className="grid gap-2 sm:flex sm:items-center">
                <button
                  type="button"
                  onClick={() => submit('DRAFT')}
                  disabled={!canPublish || isBusy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createMutation.isPending && createMutation.variables?.mode === 'DRAFT' ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={() => submit('PUBLISH_NOW')}
                  disabled={!canPublish || isBusy}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isBusy ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : <ArrowRight className="size-3.5" aria-hidden="true" />}
                  {publishMutation.isPending ? 'Queueing…' : createMutation.isPending && createMutation.variables?.mode === 'PUBLISH_NOW' ? 'Saving…' : 'Publish now'}
                </button>
              </div>
            </div>
          </section>

          <aside className="space-y-5 xl:sticky xl:top-[96px]">
            <section aria-label="Content preview" className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-indigo-600">02 · Preview</p>
                  <h2 className="mt-1 text-sm font-semibold text-slate-900">Instagram preview</h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-semibold text-slate-500">
                  <Sparkles className="size-3 text-indigo-500" aria-hidden="true" /> Preview
                </span>
              </div>
              <div className="p-4 sm:p-5">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex items-center gap-2.5 px-3.5 py-3">
                    <AccountAvatar account={selectedAccount} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold text-slate-900">
                        {selectedAccount?.username ? `@${selectedAccount.username}` : selectedAccount?.name ?? 'Your account'}
                      </p>
                      <p className="text-[9px] text-slate-400">{selectedAccount?.provider ?? 'Instagram'}</p>
                    </div>
                    <Camera className="size-4 text-slate-500" aria-hidden="true" />
                  </div>
                  <div className="relative aspect-square overflow-hidden bg-slate-100">
                    {mediaPreviewUrl && mediaReady && !previewFailed ? (
                      values.mediaType === 'PHOTO' ? (
                        <Image
                          key={mediaPreviewUrl}
                          src={mediaPreviewUrl}
                          alt={values.altText || 'Instagram post preview'}
                          fill
                          sizes="(max-width: 1280px) 90vw, 390px"
                          unoptimized
                          onError={() => setPreviewFailed(true)}
                          className="object-cover"
                        />
                      ) : (
                        <video
                          key={mediaPreviewUrl}
                          aria-label={`${values.mediaType === 'REEL' ? 'Reel' : 'Video'} preview`}
                          src={mediaPreviewUrl}
                          controls
                          playsInline
                          preload="none"
                          className="size-full object-cover"
                        />
                      )
                    ) : (
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-fuchsia-50 px-6 text-center">
                        <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-indigo-500 shadow-sm ring-1 ring-indigo-100">
                          {values.mediaType === 'PHOTO' ? <ImageIcon className="size-5" aria-hidden="true" /> : <Play className="size-5" aria-hidden="true" />}
                        </span>
                        <p className="mt-3 text-xs font-semibold text-slate-700">Your {values.mediaType.toLowerCase()} preview</p>
                        <p className="mt-1 text-[10px] leading-4 text-slate-500">Choose a library file or add a public media URL to preview it.</p>
                      </div>
                    )}
                  </div>
                  <div className="min-h-[78px] px-3.5 py-3">
                    <p className="line-clamp-3 whitespace-pre-wrap text-[11px] leading-5 text-slate-700">
                      {values.caption || <span className="text-slate-400">Your caption will appear here.</span>}
                    </p>
                    <p className="mt-2 text-[9px] text-slate-400">Just now</p>
                  </div>
                </div>
                <p className="mt-3 text-[10px] leading-4 text-slate-400">Preview is an approximation; the final layout is controlled by Instagram.</p>
              </div>
            </section>

            <section className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Ready to publish</h2>
                  <p className="mt-1 text-[11px] text-slate-500">A few checks before sending.</p>
                </div>
                <ShieldCheck className="size-5 text-indigo-600" aria-hidden="true" />
              </div>
              <ul className="mt-4 space-y-3">
                {validationItems.map((item) => (
                  <li key={item.label} className="flex items-start gap-2.5">
                    <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${item.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                      {item.ready ? <Check className="size-2.5" strokeWidth={3} aria-hidden="true" /> : <span className="size-1 rounded-full bg-current" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-slate-700">{item.label}</span>
                      <span className={`mt-0.5 block break-words text-[10px] leading-4 ${showValidation && !item.ready ? 'text-rose-600' : 'text-slate-400'}`}>{item.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-indigo-50/70 p-3 text-[10px] leading-4 text-indigo-900">
                <LockKeyhole className="mt-0.5 size-3 shrink-0 text-indigo-600" aria-hidden="true" />
                Connected tokens stay protected by the backend and are never shown here.
              </div>
            </section>

            <section className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-slate-400" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-slate-700">Scheduling is coming later</p>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">This composer publishes now or saves a draft. Scheduled publishing is not active yet.</p>
              </div>
            </section>
          </aside>
        </div>
      )}

      {createMutation.isError && (
        <InlineError
          message={createMutation.error.message}
          retry={() => submit(createMutation.variables?.mode ?? 'DRAFT')}
        />
      )}
      {publishMutation.isError && savedDraftId && (
        <div className="flex flex-col gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Your draft is safe. Queueing failed: {publishMutation.error.message}</span>
          <Link href={`/instagram/publications/${savedDraftId}`} className="shrink-0 font-semibold underline underline-offset-2">Open saved draft</Link>
        </div>
      )}

      {mediaPickerOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMediaPickerOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="media-picker-title" className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-[#f6f7fb] shadow-2xl">
            <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
              <div>
                <h2 id="media-picker-title" className="text-sm font-semibold text-slate-900">Choose media</h2>
                <p className="mt-1 text-[11px] text-slate-500">Select a file from your organization’s library.</p>
              </div>
              <button type="button" aria-label="Close media picker" onClick={() => setMediaPickerOpen(false)} className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"><X className="size-4" aria-hidden="true" /></button>
            </header>
            <div className="overflow-y-auto p-4 sm:p-6"><MediaLibraryBrowser selectionMode onSelect={selectMediaAsset} /></div>
          </section>
        </div>
      )}
    </div>
  );
}

function isConnectedAccount(account: InstagramAccount): boolean {
  return account.status === 'CONNECTED' && Boolean(account.externalAccountId);
}

function validateMediaUrl(value: string): string | null {
  if (!value.trim()) return 'A media link is required.';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname) return 'Use a valid public HTTPS URL.';
    return null;
  } catch {
    return 'Enter a valid HTTPS URL.';
  }
}

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatComposerMediaSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function AccountAvatar({ account }: { account?: InstagramAccount }) {
  if (account?.avatarUrl) {
    return (
      <span className="relative size-8 shrink-0 overflow-hidden rounded-full bg-slate-100">
        <Image src={account.avatarUrl} alt="" fill sizes="32px" unoptimized className="object-cover" />
      </span>
    );
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 text-white">
      <Camera className="size-3.5" aria-hidden="true" />
    </span>
  );
}

function NoticeBanner({ notice, draftId }: { notice: Notice; draftId: string | null }) {
  const icon = notice.tone === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : notice.tone === 'error' ? <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden="true" />;
  const color = notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : notice.tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-indigo-200 bg-indigo-50 text-indigo-800';
  return (
    <div className={`flex flex-col gap-2 rounded-2xl border p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${color}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <span className="flex items-start gap-2">{icon}{notice.message}</span>
      {draftId && notice.tone === 'success' && (
        <Link href={`/instagram/publications/${draftId}`} className="shrink-0 font-semibold underline underline-offset-2">Open draft</Link>
      )}
    </div>
  );
}
