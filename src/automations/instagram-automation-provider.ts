import { InstagramProviderType } from "@prisma/client";

export interface AutomationProviderAccount {
  externalAccountId: string;
  accessToken: string;
}

export interface AutomationProviderResult {
  externalId: string;
}

export interface InstagramAutomationProvider {
  readonly type: InstagramProviderType;
  sendMessage(
    account: AutomationProviderAccount,
    recipientId: string,
    text: string,
  ): Promise<AutomationProviderResult>;
  replyComment(
    account: AutomationProviderAccount,
    commentId: string,
    text: string,
  ): Promise<AutomationProviderResult>;
}

export class InstagramAutomationProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super("Instagram automation provider request failed");
    this.name = "InstagramAutomationProviderError";
  }
}
