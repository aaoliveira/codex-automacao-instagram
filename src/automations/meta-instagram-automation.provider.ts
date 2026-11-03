import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InstagramProviderType } from "@prisma/client";
import {
  AutomationProviderAccount,
  AutomationProviderResult,
  InstagramAutomationProvider,
  InstagramAutomationProviderError,
} from "./instagram-automation-provider";

type MetaResponse = {
  id?: unknown;
  message_id?: unknown;
  error?: { code?: unknown; is_transient?: unknown };
};

@Injectable()
export class MetaInstagramAutomationProvider implements InstagramAutomationProvider {
  readonly type = InstagramProviderType.META;

  constructor(private readonly config: ConfigService) {}

  async sendMessage(
    account: AutomationProviderAccount,
    recipientId: string,
    text: string,
  ): Promise<AutomationProviderResult> {
    const response = await this.post(
      `${this.userUrl(account.externalAccountId)}/messages`,
      account.accessToken,
      {
        recipient: { id: recipientId },
        message: { text },
      },
    );
    return { externalId: this.readId(response.message_id ?? response.id) };
  }

  async replyComment(
    account: AutomationProviderAccount,
    commentId: string,
    text: string,
  ): Promise<AutomationProviderResult> {
    const response = await this.post(
      `${this.userUrl(encodeURIComponent(commentId))}/replies`,
      account.accessToken,
      { message: text },
    );
    return { externalId: this.readId(response.id) };
  }

  private async post(
    url: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<MetaResponse> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new InstagramAutomationProviderError("META_NETWORK_ERROR", true);
    }

    let payload: MetaResponse | null = null;
    try {
      payload = (await response.json()) as MetaResponse;
    } catch {
      if (response.ok) {
        throw new InstagramAutomationProviderError("META_RESPONSE_INVALID");
      }
    }

    if (!response.ok || payload?.error) {
      const transient = payload?.error?.is_transient === true;
      throw new InstagramAutomationProviderError(
        normalizeMetaError(payload?.error?.code),
        transient || response.status === 429 || response.status >= 500,
      );
    }
    if (!payload) {
      throw new InstagramAutomationProviderError("META_RESPONSE_INVALID");
    }
    return payload;
  }

  private userUrl(userId: string): string {
    const version = this.config
      .getOrThrow<string>("META_INSTAGRAM_GRAPH_API_VERSION")
      .replace(/^v?/, "v");
    return `https://graph.instagram.com/${version}/${userId}`;
  }

  private readId(value: unknown): string {
    if (typeof value === "string" && value.length > 0) return value;
    throw new InstagramAutomationProviderError("META_RESPONSE_INVALID");
  }
}

function normalizeMetaError(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value)
    ? `META_${value}`
    : "META_API_ERROR";
}
