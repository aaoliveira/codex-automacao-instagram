import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  AnalyticsDataOrigin,
  AnalyticsSnapshotStatus,
  InstagramProviderType,
  PublicationMediaType,
} from "@prisma/client";
import {
  META_INSIGHTS_PERMISSION,
  PUBLICATION_METRIC_KEYS,
  PublicationInsightsInput,
  PublicationMetricValue,
  InstagramInsightsProvider,
} from "./insights-provider";

type MetaInsight = {
  name?: unknown;
  values?: Array<{ value?: unknown }>;
  total_value?: { value?: unknown };
};
type MetaError = {
  code?: unknown;
  error_subcode?: unknown;
  is_transient?: unknown;
  message?: unknown;
};
type MetaResponse = { data?: MetaInsight[]; error?: MetaError };

@Injectable()
export class MetaInsightsProvider implements InstagramInsightsProvider {
  readonly type = InstagramProviderType.META;

  constructor(private readonly config: ConfigService) {}

  async readPublicationInsights(
    accessToken: string,
    publication: PublicationInsightsInput,
  ): Promise<PublicationMetricValue[]> {
    if (!accessToken) {
      return this.all(
        AnalyticsSnapshotStatus.PERMISSION_MISSING,
        "META_ACCESS_TOKEN_UNAVAILABLE",
      );
    }
    const configuredScopes = (
      this.config.get<string>("META_INSTAGRAM_SCOPES") ?? ""
    )
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean);
    if (!configuredScopes.includes(META_INSIGHTS_PERMISSION)) {
      return this.all(
        AnalyticsSnapshotStatus.PERMISSION_MISSING,
        "META_INSIGHTS_SCOPE_NOT_CONFIGURED",
      );
    }
    if (publication.mediaType === PublicationMediaType.VIDEO) {
      return this.all(
        AnalyticsSnapshotStatus.NOT_SUPPORTED,
        "MEDIA_PRODUCT_TYPE_UNKNOWN",
      );
    }

    try {
      const versionValue = this.config.getOrThrow<string>(
        "META_INSTAGRAM_GRAPH_API_VERSION",
      );
      const version = versionValue.startsWith("v")
        ? versionValue
        : `v${versionValue}`;
      const url = new URL(
        `https://graph.instagram.com/${version}/${encodeURIComponent(publication.externalMediaId)}/insights`,
      );
      url.searchParams.set("metric", PUBLICATION_METRIC_KEYS.join(","));
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
      const payload = (await response
        .json()
        .catch(() => null)) as MetaResponse | null;
      if (!response.ok || payload?.error) {
        const normalized = normalizeMetaError(payload?.error, response.status);
        return this.all(normalized.status, normalized.reasonCode);
      }
      const metrics = Array.isArray(payload?.data) ? payload.data : [];
      const results = PUBLICATION_METRIC_KEYS.map(
        (metricKey): PublicationMetricValue => {
          const item = metrics.find(
            (candidate) => candidate.name === metricKey,
          );
          const value = readNumericValue(item);
          return value === null
            ? {
                metricKey,
                origin: AnalyticsDataOrigin.META,
                status: AnalyticsSnapshotStatus.UNAVAILABLE,
                value: null,
                reasonCode: "METRIC_NOT_RETURNED",
              }
            : {
                metricKey,
                origin: AnalyticsDataOrigin.META,
                status: AnalyticsSnapshotStatus.AVAILABLE,
                value,
                reasonCode: null,
              };
        },
      );
      return [...results, deriveEngagementRate(results)];
    } catch {
      return this.all(
        AnalyticsSnapshotStatus.TRANSIENT_ERROR,
        "PROVIDER_NETWORK_ERROR",
      );
    }
  }

  private all(
    status: AnalyticsSnapshotStatus,
    reasonCode: string,
  ): PublicationMetricValue[] {
    const base = PUBLICATION_METRIC_KEYS.map((metricKey) => ({
      metricKey,
      origin: AnalyticsDataOrigin.META,
      status,
      value: null,
      reasonCode,
    }));
    return [
      ...base,
      {
        metricKey: "engagement_rate_by_reach",
        origin: AnalyticsDataOrigin.DERIVED,
        status: AnalyticsSnapshotStatus.UNAVAILABLE,
        value: null,
        reasonCode: "INPUT_METRICS_UNAVAILABLE",
      },
    ];
  }
}

function readNumericValue(item?: MetaInsight): number | null {
  const raw = item?.total_value?.value ?? item?.values?.[0]?.value;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function deriveEngagementRate(
  results: PublicationMetricValue[],
): PublicationMetricValue {
  const interactions = results.find(
    (item) => item.metricKey === "total_interactions",
  );
  const reach = results.find((item) => item.metricKey === "reach");
  if (
    interactions?.status !== AnalyticsSnapshotStatus.AVAILABLE ||
    reach?.status !== AnalyticsSnapshotStatus.AVAILABLE ||
    interactions.value === null ||
    reach.value === null ||
    reach.value === 0
  ) {
    return {
      metricKey: "engagement_rate_by_reach",
      origin: AnalyticsDataOrigin.DERIVED,
      status: AnalyticsSnapshotStatus.UNAVAILABLE,
      value: null,
      reasonCode:
        reach?.value === 0
          ? "ZERO_REACH_DENOMINATOR"
          : "INPUT_METRICS_UNAVAILABLE",
    };
  }
  return {
    metricKey: "engagement_rate_by_reach",
    origin: AnalyticsDataOrigin.DERIVED,
    status: AnalyticsSnapshotStatus.AVAILABLE,
    value: Number(((interactions.value / reach.value) * 100).toFixed(4)),
    reasonCode: null,
  };
}

function normalizeMetaError(error: MetaError | undefined, statusCode: number) {
  const code = typeof error?.code === "number" ? error.code : null;
  const subcode =
    typeof error?.error_subcode === "number" ? error.error_subcode : null;
  const message =
    typeof error?.message === "string" ? error.message.toLowerCase() : "";
  if (
    error?.is_transient === true ||
    statusCode === 408 ||
    statusCode === 429 ||
    statusCode >= 500
  ) {
    return {
      status: AnalyticsSnapshotStatus.TRANSIENT_ERROR,
      reasonCode: "META_TRANSIENT_ERROR",
    };
  }
  if (
    message.includes("24 hour") ||
    message.includes("24-hour") ||
    message.includes("insight window") ||
    message.includes("time window") ||
    message.includes("not enough viewers")
  ) {
    return {
      status: AnalyticsSnapshotStatus.WINDOW_EXPIRED,
      reasonCode: "META_INSIGHT_WINDOW_EXPIRED",
    };
  }
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    code === 10 ||
    code === 200 ||
    code === 190 ||
    message.includes("permission") ||
    message.includes("not authorized")
  ) {
    return {
      status: AnalyticsSnapshotStatus.PERMISSION_MISSING,
      reasonCode: "META_PERMISSION_MISSING",
    };
  }
  if (code === 100 || subcode !== null) {
    return {
      status: AnalyticsSnapshotStatus.NOT_SUPPORTED,
      reasonCode: "META_METRIC_NOT_SUPPORTED",
    };
  }
  return {
    status: AnalyticsSnapshotStatus.UNAVAILABLE,
    reasonCode: "META_INSIGHT_UNAVAILABLE",
  };
}
