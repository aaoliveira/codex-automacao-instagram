import {
  AnalyticsDataOrigin,
  AnalyticsSnapshotStatus,
  InstagramProviderType,
} from "@prisma/client";
import { MockInsightsProvider } from "./mock-insights.provider";

describe("MockInsightsProvider", () => {
  it("returns deterministic synthetic data, explicitly marked MOCK, and a derived percentage", async () => {
    const provider = new MockInsightsProvider();
    const input = {
      publicationId: "publication-1",
      externalMediaId: "mock-media-1",
      mediaType: "PHOTO" as const,
    };
    const first = await provider.readPublicationInsights("unused", input);
    const second = await provider.readPublicationInsights("unused", input);
    expect(provider.type).toBe(InstagramProviderType.MOCK);
    expect(first).toEqual(second);
    expect(
      first.filter((value) => value.origin === AnalyticsDataOrigin.MOCK),
    ).toHaveLength(7);
    expect(
      first.every(
        (value) => value.status === AnalyticsSnapshotStatus.AVAILABLE,
      ),
    ).toBe(true);
    expect(
      first.find((value) => value.metricKey === "engagement_rate_by_reach")
        ?.origin,
    ).toBe(AnalyticsDataOrigin.DERIVED);
    expect(
      first.find((value) => value.metricKey === "engagement_rate_by_reach")
        ?.value,
    ).toBeGreaterThan(0);
  });
});
