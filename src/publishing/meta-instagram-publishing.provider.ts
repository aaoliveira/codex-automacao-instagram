import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  InstagramProviderType,
  PublicationMediaType,
} from "@prisma/client";
import {
  InstagramMediaContainerStatus,
  InstagramPublicationContent,
  InstagramPublishingAccount,
  InstagramPublishingProvider,
  InstagramPublishingProviderError,
} from "./instagram-publishing-provider";

type MetaError = {
  code?: unknown;
  is_transient?: unknown;
};

type MetaResponse = {
  id?: unknown;
  status_code?: unknown;
  error?: MetaError;
};

type MetaOperation = "create" | "status" | "publish";

@Injectable()
export class MetaInstagramPublishingProvider
  implements InstagramPublishingProvider
{
  readonly type = InstagramProviderType.META;

  constructor(private readonly config: ConfigService) {}

  async createContainer(
    account: InstagramPublishingAccount,
    content: InstagramPublicationContent,
  ): Promise<string> {
    const form = new URLSearchParams();
    if (content.mediaType === PublicationMediaType.PHOTO) {
      form.set("image_url", content.mediaUrl);
      if (content.altText) form.set("alt_text", content.altText);
    } else {
      form.set(
        "media_type",
        content.mediaType === PublicationMediaType.REEL ? "REELS" : "VIDEO",
      );
      form.set("video_url", content.mediaUrl);
      if (
        content.mediaType === PublicationMediaType.REEL &&
        content.shareToFeed !== null
      ) {
        form.set("share_to_feed", String(content.shareToFeed));
      }
    }
    if (content.caption) form.set("caption", content.caption);

    const response = await this.requestJson(
      this.accountUrl(account.externalAccountId, "media"),
      account.accessToken,
      { method: "POST", body: form },
      "create",
    );
    return this.requiredId(response.id, "META_CONTAINER_RESPONSE_INVALID");
  }

  async getContainerStatus(
    account: InstagramPublishingAccount,
    containerId: string,
  ): Promise<InstagramMediaContainerStatus> {
    const url = this.graphUrl(encodeURIComponent(containerId));
    url.searchParams.set("fields", "status_code,status");
    const response = await this.requestJson(
      url.toString(),
      account.accessToken,
      { method: "GET" },
      "status",
    );
    const status = response.status_code;
    if (
      status === "IN_PROGRESS" ||
      status === "FINISHED" ||
      status === "PUBLISHED" ||
      status === "ERROR" ||
      status === "EXPIRED"
    ) {
      return status;
    }
    throw new InstagramPublishingProviderError(
      "META_CONTAINER_STATUS_INVALID",
      false,
    );
  }

  async publishContainer(
    account: InstagramPublishingAccount,
    containerId: string,
  ): Promise<string> {
    const form = new URLSearchParams({ creation_id: containerId });
    const response = await this.requestJson(
      this.accountUrl(account.externalAccountId, "media_publish"),
      account.accessToken,
      { method: "POST", body: form },
      "publish",
    );
    return this.requiredId(response.id, "META_PUBLISH_RESPONSE_INVALID");
  }

  private async requestJson(
    url: string,
    accessToken: string,
    init: RequestInit,
    operation: MetaOperation,
  ): Promise<MetaResponse> {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        signal: AbortSignal.timeout(15_000),
      });
      let payload: MetaResponse | null = null;
      try {
        payload = (await response.json()) as MetaResponse;
      } catch {
        if (response.ok) {
          throw new InstagramPublishingProviderError(
            "META_RESPONSE_INVALID",
            true,
          );
        }
      }

      if (!response.ok || payload?.error) {
        const metaError = payload?.error;
        const isTransient = metaError?.is_transient === true;
        const retryable =
          isTransient ||
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        const safeToRepeatPublish =
          operation === "publish" &&
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 408;
        throw new InstagramPublishingProviderError(
          normalizeMetaErrorCode(metaError?.code),
          retryable,
          "Instagram rejected the publication request.",
          safeToRepeatPublish,
        );
      }
      if (!payload || typeof payload !== "object") {
        throw new InstagramPublishingProviderError(
          "META_RESPONSE_INVALID",
          true,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof InstagramPublishingProviderError) throw error;
      throw new InstagramPublishingProviderError(
        `META_${operation.toUpperCase()}_NETWORK_ERROR`,
        true,
        "Instagram could not be reached. The publication will be reconciled before another publish attempt.",
      );
    }
  }

  private accountUrl(accountId: string, edge: string): string {
    return `${this.graphUrl(encodeURIComponent(accountId)).toString()}/${edge}`;
  }

  private graphUrl(nodeId: string): URL {
    const configuredVersion = this.config.getOrThrow<string>(
      "META_INSTAGRAM_GRAPH_API_VERSION",
    );
    const version = configuredVersion.startsWith("v")
      ? configuredVersion
      : `v${configuredVersion}`;
    return new URL(`https://graph.instagram.com/${version}/${nodeId}`);
  }

  private requiredId(value: unknown, errorCode: string): string {
    if (typeof value === "string" && value.length > 0) return value;
    throw new InstagramPublishingProviderError(errorCode, true);
  }
}

function normalizeMetaErrorCode(value: unknown): string {
  if (typeof value === "number" && Number.isInteger(value)) {
    return `META_${value}`;
  }
  return "META_API_ERROR";
}
