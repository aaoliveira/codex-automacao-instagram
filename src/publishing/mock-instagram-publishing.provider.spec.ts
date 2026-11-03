import { PublicationMediaType } from "@prisma/client";
import { MockInstagramPublishingProvider } from "./mock-instagram-publishing.provider";

describe("MockInstagramPublishingProvider", () => {
  it.each([
    PublicationMediaType.PHOTO,
    PublicationMediaType.VIDEO,
    PublicationMediaType.REEL,
  ])("simulates a %s through container readiness and publication", async (mediaType) => {
    const provider = new MockInstagramPublishingProvider();
    const account = {
      externalAccountId: "mock-account-1",
      accessToken: "mock-access-token",
    };
    const content = {
      publicationId: `publication-${mediaType}`,
      mediaType,
      mediaUrl: `https://cdn.example.test/${mediaType.toLowerCase()}`,
      caption: "A test publication",
      altText: mediaType === PublicationMediaType.PHOTO ? "A sample photo" : null,
      shareToFeed: mediaType === PublicationMediaType.REEL ? true : null,
    };

    const containerId = await provider.createContainer(account, content);
    expect(containerId).toBe(
      `mock-container-${mediaType.toLowerCase()}-${content.publicationId}`,
    );
    await expect(provider.getContainerStatus(account, containerId)).resolves.toBe(
      "FINISHED",
    );

    const firstMediaId = await provider.publishContainer(account, containerId);
    const repeatedMediaId = await provider.publishContainer(account, containerId);
    expect(firstMediaId).toMatch(
      new RegExp(`^mock-media-${mediaType.toLowerCase()}-[a-f0-9]{20}$`),
    );
    expect(repeatedMediaId).toBe(firstMediaId);
    await expect(provider.getContainerStatus(account, containerId)).resolves.toBe(
      "PUBLISHED",
    );
  });
});
