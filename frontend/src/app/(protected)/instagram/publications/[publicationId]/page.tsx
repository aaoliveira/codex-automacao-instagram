import PublicationDetails from './details-client';

export default async function PublicationDetailsPage({
  params,
}: {
  params: Promise<{ publicationId: string }>;
}) {
  const { publicationId } = await params;
  return <PublicationDetails publicationId={publicationId} />;
}
