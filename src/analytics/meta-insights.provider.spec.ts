import { ConfigService } from "@nestjs/config";
import {
  AnalyticsDataOrigin,
  AnalyticsSnapshotStatus,
  PublicationMediaType,
} from "@prisma/client";
import { MetaInsightsProvider } from "./meta-insights.provider";

describe("MetaInsightsProvider", () => {
  const input = {
    publicationId: "publication-1",
    externalMediaId: "meta-media-1",
    mediaType: PublicationMediaType.PHOTO,
  };
  const makeProvider = (scopes = "instagram_business_manage_insights") =>
    new MetaInsightsProvider({
      get: (key: string) =>
        key === "META_INSTAGRAM_SCOPES" ? scopes : undefined,
      getOrThrow: () => "v25.0",
    } as unknown as ConfigService);

  afterEach(() => jest.restoreAllMocks());

  it("uses the documented allowlisted metric identifiers and never turns missing metrics into zero", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            data: [{ name: "reach", total_value: { value: 14 } }],
          }),
          { status: 200 },
        ),
      );
    const result = await makeProvider().readPublicationInsights(
      "secret-token",
      input,
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/v25.0/meta-media-1/insights");
    expect(String(url)).not.toContain("secret-token");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
    expect(result.find((metric) => metric.metricKey === "reach")).toMatchObject(
      {
        value: 14,
        status: AnalyticsSnapshotStatus.AVAILABLE,
        origin: AnalyticsDataOrigin.META,
      },
    );
    expect(result.find((metric) => metric.metricKey === "likes")).toMatchObject(
      { value: null, status: AnalyticsSnapshotStatus.UNAVAILABLE },
    );
  });

  it("classifies permission failures and refuses account media types whose product is ambiguous", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 200, message: "permission denied" },
          }),
          { status: 403 },
        ),
      );
    const denied = await makeProvider().readPublicationInsights(
      "secret-token",
      input,
    );
    expect(denied[0]).toMatchObject({
      value: null,
      status: AnalyticsSnapshotStatus.PERMISSION_MISSING,
    });
    const video = await makeProvider().readPublicationInsights("secret-token", {
      ...input,
      mediaType: PublicationMediaType.VIDEO,
    });
    expect(video[0]).toMatchObject({
      value: null,
      status: AnalyticsSnapshotStatus.NOT_SUPPORTED,
      reasonCode: "MEDIA_PRODUCT_TYPE_UNKNOWN",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfigured insights scope before making a provider request", async () => {
    const fetchMock = jest.spyOn(global, "fetch");
    const result = await makeProvider(
      "instagram_business_basic",
    ).readPublicationInsights("secret-token", input);
    expect(result[0]).toMatchObject({
      value: null,
      status: AnalyticsSnapshotStatus.PERMISSION_MISSING,
      reasonCode: "META_INSIGHTS_SCOPE_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps expired insight windows distinct from expired credentials", async () => {
    jest
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 100, message: "Insight window has expired" },
          }),
          { status: 400 },
        ),
      );
    const result = await makeProvider().readPublicationInsights(
      "secret-token",
      input,
    );
    expect(result[0]).toMatchObject({
      value: null,
      status: AnalyticsSnapshotStatus.WINDOW_EXPIRED,
      reasonCode: "META_INSIGHT_WINDOW_EXPIRED",
    });
  });
});
