import { Injectable } from "@nestjs/common";
import { InstagramProviderType } from "@prisma/client";
import { createHash } from "node:crypto";
import {
  AutomationProviderAccount,
  AutomationProviderResult,
  InstagramAutomationProvider,
} from "./instagram-automation-provider";

export interface MockAutomationReceipt {
  kind: "MESSAGE" | "COMMENT_REPLY";
  accountId: string;
  recipientId: string;
  text: string;
  externalId: string;
}

@Injectable()
export class MockInstagramAutomationProvider implements InstagramAutomationProvider {
  readonly type = InstagramProviderType.MOCK;
  private readonly receipts: MockAutomationReceipt[] = [];

  async sendMessage(
    account: AutomationProviderAccount,
    recipientId: string,
    text: string,
  ): Promise<AutomationProviderResult> {
    return this.record("MESSAGE", account.externalAccountId, recipientId, text);
  }

  async replyComment(
    account: AutomationProviderAccount,
    commentId: string,
    text: string,
  ): Promise<AutomationProviderResult> {
    return this.record(
      "COMMENT_REPLY",
      account.externalAccountId,
      commentId,
      text,
    );
  }

  getReceipts(): MockAutomationReceipt[] {
    return [...this.receipts];
  }

  private record(
    kind: MockAutomationReceipt["kind"],
    accountId: string,
    recipientId: string,
    text: string,
  ): AutomationProviderResult {
    const digest = createHash("sha256")
      .update(`${kind}:${accountId}:${recipientId}:${this.receipts.length}`)
      .digest("hex")
      .slice(0, 20);
    const externalId = `mock-${kind.toLowerCase()}-${digest}`;
    this.receipts.push({ kind, accountId, recipientId, text, externalId });
    return { externalId };
  }
}
