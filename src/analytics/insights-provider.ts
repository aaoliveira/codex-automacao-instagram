import {
  AnalyticsDataOrigin,
  AnalyticsSnapshotStatus,
  InstagramProviderType,
  PublicationMediaType,
} from "@prisma/client";

export const ANALYTICS_INSIGHTS_PROVIDER = Symbol(
  "ANALYTICS_INSIGHTS_PROVIDER",
);

export const PUBLICATION_METRIC_KEYS = [
  "reach",
  "views",
  "likes",
  "comments",
  "saved",
  "shares",
  "total_interactions",
] as const;

export type PublicationMetricKey = (typeof PUBLICATION_METRIC_KEYS)[number];
export type AnalyticsMetricKey =
  PublicationMetricKey | "engagement_rate_by_reach";

export interface PublicationMetricValue {
  metricKey: AnalyticsMetricKey;
  origin: AnalyticsDataOrigin;
  status: AnalyticsSnapshotStatus;
  value: number | null;
  reasonCode: string | null;
}

export interface PublicationInsightsInput {
  publicationId: string;
  externalMediaId: string;
  mediaType: PublicationMediaType;
  caption?: string | null;
}

export interface InstagramInsightsProvider {
  readonly type: InstagramProviderType;
  readPublicationInsights(
    accessToken: string,
    publication: PublicationInsightsInput,
  ): Promise<PublicationMetricValue[]>;
}

export const META_INSIGHTS_PERMISSION = "instagram_business_manage_insights";
