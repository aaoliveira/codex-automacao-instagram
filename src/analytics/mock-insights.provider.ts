import { Injectable } from "@nestjs/common";
import {
  AnalyticsDataOrigin,
  AnalyticsSnapshotStatus,
  InstagramProviderType,
} from "@prisma/client";
import { createHash } from "node:crypto";
import {
  PUBLICATION_METRIC_KEYS,
  PublicationInsightsInput,
  PublicationMetricValue,
  InstagramInsightsProvider,
} from "./insights-provider";

@Injectable()
export class MockInsightsProvider implements InstagramInsightsProvider {
  readonly type = InstagramProviderType.MOCK;

  async readPublicationInsights(
    _accessToken: string,
    publication: PublicationInsightsInput,
  ): Promise<PublicationMetricValue[]> {
    const digest = createHash("sha256")
      .update(publication.publicationId)
      .digest();
    const likes = 8 + (digest[0] % 180);
    const comments = digest[1] % 32;
    const saved = digest[2] % 55;
    const shares = digest[3] % 24;
    const reach = 120 + digest.readUInt16BE(4);
    const views = reach + digest.readUInt16BE(6);
    const interactions = likes + comments + saved + shares;
    const values: Record<(typeof PUBLICATION_METRIC_KEYS)[number], number> = {
      reach,
      views,
      likes,
      comments,
      saved,
      shares,
      total_interactions: interactions,
    };
    const base = PUBLICATION_METRIC_KEYS.map((metricKey) => ({
      metricKey,
      origin: AnalyticsDataOrigin.MOCK,
      status: AnalyticsSnapshotStatus.AVAILABLE,
      value: values[metricKey],
      reasonCode: null,
    }));
    return [
      ...base,
      {
        metricKey: "engagement_rate_by_reach",
        origin: AnalyticsDataOrigin.DERIVED,
        status:
          reach > 0
            ? AnalyticsSnapshotStatus.AVAILABLE
            : AnalyticsSnapshotStatus.UNAVAILABLE,
        value:
          reach > 0 ? Number(((interactions / reach) * 100).toFixed(4)) : null,
        reasonCode: reach > 0 ? null : "ZERO_REACH_DENOMINATOR",
      },
    ];
  }
}
