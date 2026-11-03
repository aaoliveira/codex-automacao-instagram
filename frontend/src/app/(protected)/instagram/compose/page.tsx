import InstagramComposer from './composer-client';

export default async function InstagramComposePage({
  searchParams,
}: {
  searchParams: Promise<{ mediaAssetId?: string | string[] }>;
}) {
  const params = await searchParams;
  const mediaAssetId = Array.isArray(params.mediaAssetId) ? params.mediaAssetId[0] : params.mediaAssetId;
  return <InstagramComposer initialMediaAssetId={mediaAssetId ?? null} />;
}
