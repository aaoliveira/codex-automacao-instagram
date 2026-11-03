import { Injectable } from "@nestjs/common";
import { InstagramProviderType, PublicationMediaType } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  InstagramMediaContainerStatus,
  InstagramPublicationContent,
  InstagramPublishingAccount,
  InstagramPublishingProvider,
  InstagramPublishingProviderError,
} from "./instagram-publishing-provider";

@Injectable()
export class MockInstagramPublishingProvider
  implements InstagramPublishingProvider
{
  readonly type = InstagramProviderType.MOCK;
  private readonly containers = new Map<string, PublicationMediaType>();
  private readonly publishedContainers = new Map<string, string>();

  async createContainer(
    _account: InstagramPublishingAccount,
    content: InstagramPublicationContent,
  ): Promise<string> {
    const containerId = `mock-container-${content.mediaType.toLowerCase()}-${content.publicationId}`;
    this.containers.set(containerId, content.mediaType);
    return containerId;
  }

  async getContainerStatus(
    _account: InstagramPublishingAccount,
    containerId: string,
  ): Promise<InstagramMediaContainerStatus> {
    if (!this.containers.has(containerId)) return "ERROR";
    return this.publishedContainers.has(containerId) ? "PUBLISHED" : "FINISHED";
  }

  async publishContainer(
    _account: InstagramPublishingAccount,
    containerId: string,
  ): Promise<string> {
    const existing = this.publishedContainers.get(containerId);
    if (existing) return existing;
    const mediaType = this.containers.get(containerId);
    if (!mediaType) {
      throw new InstagramPublishingProviderError(
        "MOCK_CONTAINER_NOT_FOUND",
        false,
      );
    }

    const digest = createHash("sha256").update(containerId).digest("hex");
    const mediaId = `mock-media-${mediaType.toLowerCase()}-${digest.slice(0, 20)}`;
    this.publishedContainers.set(containerId, mediaId);
    return mediaId;
  }
}
