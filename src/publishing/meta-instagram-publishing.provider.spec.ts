import { ConfigService } from "@nestjs/config";
import { PublicationMediaType } from "@prisma/client";
import {
  InstagramPublishingProviderError,
} from "./instagram-publishing-provider";
import { MetaInstagramPublishingProvider } from "./meta-instagram-publishing.provider";

describe("MetaInstagramPublishingProvider", () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn() as unknown as jest.MockedFunction<typeof fetch>;
  const config = {
    getOrThrow: jest.fn().mockReturnValue("v25.0"),
  } as unknown as ConfigService;
  const provider = new MetaInstagramPublishingProvider(config);
  const account = {
    externalAccountId: "17841400000000000",
    accessToken: "secret-instagram-access-token",
  };

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("creates a photo container using only documented media parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "container-photo" }));
    const content = {
      publicationId: "pub-photo",
      mediaType: PublicationMediaType.PHOTO,
      mediaUrl: "https://cdn.example.test/photo.jpg",
      caption: "Photo caption",
      altText: "Sunset",
      shareToFeed: null,
    };

    await expect(provider.createContainer(account, content)).resolves.toBe(
      "container-photo",
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://graph.instagram.com/v25.0/17841400000000000/media",
    );
    const form = init?.body as URLSearchParams;
    expect(form.get("image_url")).toBe(content.mediaUrl);
    expect(form.get("caption")).toBe("Photo caption");
    expect(form.get("alt_text")).toBe("Sunset");
    expect(form.get("media_type")).toBeNull();
    expect(init?.headers).toMatchObject({
      Authorization: `Bearer ${account.accessToken}`,
    });
    expect(String(url)).not.toContain(account.accessToken);
  });

  it.each([
    [PublicationMediaType.VIDEO, "VIDEO"],
    [PublicationMediaType.REEL, "REELS"],
  ] as const)("uses %s container parameters", async (mediaType, metaMediaType) => {
    fetchMock.mockResolvedValue(jsonResponse({ id: `container-${metaMediaType}` }));
    await provider.createContainer(account, {
      publicationId: `pub-${mediaType}`,
      mediaType,
      mediaUrl: "https://cdn.example.test/video.mp4",
      caption: "Video caption",
      altText: null,
      shareToFeed: mediaType === PublicationMediaType.REEL ? false : null,
    });

    const form = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
    expect(form.get("media_type")).toBe(metaMediaType);
    expect(form.get("video_url")).toBe("https://cdn.example.test/video.mp4");
    expect(form.get("caption")).toBe("Video caption");
    expect(form.get("share_to_feed")).toBe(
      mediaType === PublicationMediaType.REEL ? "false" : null,
    );
  });

  it("checks the container readiness status and publishes it by creation_id", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ status_code: "FINISHED" }))
      .mockResolvedValueOnce(jsonResponse({ id: "published-media-id" }));

    await expect(
      provider.getContainerStatus(account, "container-id"),
    ).resolves.toBe("FINISHED");
    await expect(
      provider.publishContainer(account, "container-id"),
    ).resolves.toBe("published-media-id");

    const statusUrl = new URL(fetchMock.mock.calls[0][0] as string);
    expect(statusUrl.origin).toBe("https://graph.instagram.com");
    expect(statusUrl.pathname).toBe("/v25.0/container-id");
    expect(statusUrl.searchParams.get("fields")).toBe("status_code,status");

    const [publishUrl, publishInit] = fetchMock.mock.calls[1];
    expect(String(publishUrl)).toBe(
      "https://graph.instagram.com/v25.0/17841400000000000/media_publish",
    );
    expect((publishInit?.body as URLSearchParams).get("creation_id")).toBe(
      "container-id",
    );
  });

  it("normalizes Meta errors and marks explicit throttling as retryable without exposing details", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 4,
            is_transient: true,
            message: "secret provider response must not escape",
          },
        },
        429,
      ),
    );

    let captured: unknown;
    try {
      await provider.publishContainer(account, "container-id");
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(InstagramPublishingProviderError);
    expect(captured).toMatchObject({
      code: "META_4",
      retryable: true,
      safeToRepeatPublish: true,
    });
    expect((captured as Error).message).not.toContain("secret provider response");
    expect(JSON.stringify(captured)).not.toContain(account.accessToken);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
