import InstagramAccountsClient from "./accounts-client";

type AccountsPageProps = {
  searchParams: Promise<{ connection?: string | string[] }>;
};

export default async function InstagramAccountsPage({
  searchParams,
}: AccountsPageProps) {
  const params = await searchParams;
  const result = params.connection;
  const connectionResult =
    result === "success" || result === "error" ? result : undefined;

  return <InstagramAccountsClient connectionResult={connectionResult} />;
}
