import AutomationsClient from "./automations-client";

export default async function AutomationsPage({
  searchParams,
}: {
  searchParams: Promise<{ ruleId?: string | string[] }>;
}) {
  const params = await searchParams;
  const ruleId = typeof params.ruleId === "string" ? params.ruleId : undefined;
  return <AutomationsClient generatedRuleId={ruleId} />;
}
