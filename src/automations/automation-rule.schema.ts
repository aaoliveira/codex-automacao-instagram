import { AutomationActionType, AutomationTriggerType } from "@prisma/client";

export type AutomationConditionField =
  | "text"
  | "eventType"
  | "field"
  | "senderId"
  | "commentId"
  | "mediaId"
  | "conversationId";

export type AutomationConditionOperator =
  "EQUALS" | "CONTAINS" | "STARTS_WITH" | "ENDS_WITH";

export interface AutomationCondition {
  field: AutomationConditionField;
  operator: AutomationConditionOperator;
  value: string;
}

export interface AutomationConditions {
  match: "ALL" | "ANY";
  rules: AutomationCondition[];
}

export type AutomationAction =
  | { type: "REGISTER_EVENT" }
  | { type: "SEND_MESSAGE"; text: string }
  | { type: "REPLY_COMMENT"; text: string }
  | { type: "TAG_CONTACT"; tag: string }
  | { type: "NOTIFY_OPERATOR"; message: string };

export interface AutomationRuleDefinition {
  triggerType: AutomationTriggerType;
  conditions: AutomationConditions;
  actions: AutomationAction[];
}

const CONDITION_FIELDS = new Set<AutomationConditionField>([
  "text",
  "eventType",
  "field",
  "senderId",
  "commentId",
  "mediaId",
  "conversationId",
]);
const CONDITION_OPERATORS = new Set<AutomationConditionOperator>([
  "EQUALS",
  "CONTAINS",
  "STARTS_WITH",
  "ENDS_WITH",
]);
const TRIGGER_TYPES = new Set<string>(Object.values(AutomationTriggerType));
const ACTION_TYPES = new Set<string>(Object.values(AutomationActionType));
const ALLOWED_ACTION_KEYS: Record<AutomationActionType, string[]> = {
  REGISTER_EVENT: ["type"],
  SEND_MESSAGE: ["type", "text"],
  REPLY_COMMENT: ["type", "text"],
  TAG_CONTACT: ["type", "tag"],
  NOTIFY_OPERATOR: ["type", "message"],
};

export function isAutomationConditions(
  value: unknown,
): value is AutomationConditions {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !["match", "rules"].includes(key)))
    return false;
  if (value.match !== "ALL" && value.match !== "ANY") return false;
  if (!Array.isArray(value.rules) || value.rules.length > 20) return false;
  return value.rules.every((condition) => {
    if (!isRecord(condition)) return false;
    if (
      Object.keys(condition).some(
        (key) => !["field", "operator", "value"].includes(key),
      )
    ) {
      return false;
    }
    return (
      typeof condition.field === "string" &&
      CONDITION_FIELDS.has(condition.field as AutomationConditionField) &&
      typeof condition.operator === "string" &&
      CONDITION_OPERATORS.has(
        condition.operator as AutomationConditionOperator,
      ) &&
      typeof condition.value === "string" &&
      condition.value.length > 0 &&
      condition.value.length <= 500
    );
  });
}

export function isAutomationActions(
  value: unknown,
): value is AutomationAction[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) {
    return false;
  }
  let outboundActionCount = 0;
  for (const action of value) {
    if (!isRecord(action) || typeof action.type !== "string") return false;
    if (!ACTION_TYPES.has(action.type)) return false;
    const type = action.type as AutomationActionType;
    if (
      Object.keys(action).some(
        (key) => !ALLOWED_ACTION_KEYS[type].includes(key),
      )
    ) {
      return false;
    }
    if (type === AutomationActionType.REGISTER_EVENT) continue;
    if (type === AutomationActionType.SEND_MESSAGE) outboundActionCount += 1;
    if (type === AutomationActionType.REPLY_COMMENT) outboundActionCount += 1;

    const textValue =
      type === AutomationActionType.SEND_MESSAGE ||
      type === AutomationActionType.REPLY_COMMENT
        ? action.text
        : type === AutomationActionType.TAG_CONTACT
          ? action.tag
          : action.message;
    const maxLength = type === AutomationActionType.TAG_CONTACT ? 64 : 500;
    if (
      typeof textValue !== "string" ||
      textValue.trim().length === 0 ||
      textValue.length > maxLength
    ) {
      return false;
    }
  }
  return outboundActionCount <= 1;
}

export function isAutomationRuleDefinition(
  value: unknown,
): value is AutomationRuleDefinition {
  return (
    isRecord(value) &&
    typeof value.triggerType === "string" &&
    TRIGGER_TYPES.has(value.triggerType) &&
    isAutomationConditions(value.conditions) &&
    isAutomationActions(value.actions)
  );
}

export function evaluateAutomationConditions(
  conditions: AutomationConditions,
  values: Record<AutomationConditionField, string | null>,
): boolean {
  if (conditions.rules.length === 0) return true;
  const outcomes = conditions.rules.map((condition) => {
    const actual = values[condition.field];
    if (actual === null) return false;
    const candidate = actual.toLocaleLowerCase("en-US");
    const expected = condition.value.toLocaleLowerCase("en-US");
    switch (condition.operator) {
      case "EQUALS":
        return candidate === expected;
      case "CONTAINS":
        return candidate.includes(expected);
      case "STARTS_WITH":
        return candidate.startsWith(expected);
      case "ENDS_WITH":
        return candidate.endsWith(expected);
    }
  });
  return conditions.match === "ALL"
    ? outcomes.every(Boolean)
    : outcomes.some(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
