import { AutomationActionType, AutomationTriggerType } from "@prisma/client";
import {
  evaluateAutomationConditions,
  isAutomationActions,
  isAutomationConditions,
} from "./automation-rule.schema";

describe("automation rule schema", () => {
  it("validates supported conditions and evaluates them deterministically without case sensitivity", () => {
    const conditions = {
      match: "ALL",
      rules: [{ field: "text", operator: "CONTAINS", value: "launch" }],
    };
    expect(isAutomationConditions(conditions)).toBe(true);
    expect(
      evaluateAutomationConditions(conditions as never, {
        text: "Launching a new product",
        eventType: "instagram.change",
        field: "comments",
        senderId: null,
        commentId: "c1",
        mediaId: null,
        conversationId: null,
      }),
    ).toBe(true);
  });

  it("rejects unsupported fields, arbitrary configuration keys and multiple outbound actions", () => {
    expect(
      isAutomationConditions({
        match: "ALL",
        rules: [{ field: "password", operator: "EQUALS", value: "x" }],
      }),
    ).toBe(false);
    expect(
      isAutomationActions([
        { type: AutomationActionType.REPLY_COMMENT, text: "Thanks" },
        { type: AutomationActionType.SEND_MESSAGE, text: "Hello" },
      ]),
    ).toBe(false);
    expect(
      isAutomationActions([
        {
          type: AutomationActionType.NOTIFY_OPERATOR,
          message: "safe",
          recipient: "all",
        },
      ]),
    ).toBe(false);
  });

  it("accepts the minimal comment keyword rule", () => {
    expect(AutomationTriggerType.COMMENT_RECEIVED).toBe("COMMENT_RECEIVED");
    expect(
      isAutomationActions([
        {
          type: AutomationActionType.REPLY_COMMENT,
          text: "Thanks for commenting!",
        },
      ]),
    ).toBe(true);
  });
});
