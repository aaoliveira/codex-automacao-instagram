import {
  InstagramProviderType,
  PublicationMediaType,
} from "@prisma/client";

export const INSTAGRAM_PUBLISHING_PROVIDER = Symbol(
  "INSTAGRAM_PUBLISHING_PROVIDER",
);

export interface InstagramPublishingAccount {
  externalAccountId: string;
  accessToken: string;
}

export interface InstagramPublicationContent {
  publicationId: string;
  mediaType: PublicationMediaType;
  mediaUrl: string;
  caption: string | null;
  altText: string | null;
  shareToFeed: boolean | null;
}

export type InstagramMediaContainerStatus =
  | "IN_PROGRESS"
  | "FINISHED"
  | "PUBLISHED"
  | "ERROR"
  | "EXPIRED";

export interface InstagramPublishingProvider {
  readonly type: InstagramProviderType;
  createContainer(
    account: InstagramPublishingAccount,
    content: InstagramPublicationContent,
  ): Promise<string>;
  getContainerStatus(
    account: InstagramPublishingAccount,
    containerId: string,
  ): Promise<InstagramMediaContainerStatus>;
  publishContainer(
    account: InstagramPublishingAccount,
    containerId: string,
  ): Promise<string>;
}

export class InstagramPublishingProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = "Instagram could not complete this publication request.",
    readonly safeToRepeatPublish = false,
  ) {
    super(message);
    this.name = "InstagramPublishingProviderError";
  }
}
