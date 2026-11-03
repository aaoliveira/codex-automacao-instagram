import { backendRequest } from "@/lib/api/client";

export type AutomationTrigger =
  "COMMENT_RECEIVED" | "MESSAGE_RECEIVED" | "WEBHOOK_EVENT_RECEIVED";
export type AutomationActionType =
  | "REGISTER_EVENT"
  | "SEND_MESSAGE"
  | "REPLY_COMMENT"
  | "TAG_CONTACT"
  | "NOTIFY_OPERATOR";
export type AutomationExecutionStatus =
  "PROCESSING" | "SUCCESS" | "FAILED" | "SKIPPED";
export type AutomationActionStatus = AutomationExecutionStatus;

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

export interface AutomationRule {
  id: string;
  organizationId: string;
  instagramAccountId: string;
  name: string;
  active: boolean;
  triggerType: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleInput {
  instagramAccountId: string;
  name: string;
  active: boolean;
  triggerType: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
}

export interface AutomationActionExecution {
  id: string;
  actionIndex: number;
  actionType: AutomationActionType;
  status: AutomationActionStatus;
  result: Record<string, unknown> | null;
  errorCode: string | null;
}

export interface AutomationExecution {
  id: string;
  instagramAccountId: string;
  automationRuleId: string;
  webhookEventId: string;
  status: AutomationExecutionStatus;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  automationRule: { id: string; name: string };
  actionExecutions: AutomationActionExecution[];
}

export interface AutomationExecutionPage {
  items: AutomationExecution[];
  page: number;
  pageSize: number;
  total: number;
}

export interface SimulateAutomationInput {
  eventType: "instagram.change" | "instagram.messaging";
  externalEventId: string;
  field?: string;
  eventTimestamp: number;
  data: Record<string, string>;
}

export interface SimulateAutomationResult {
  eventId: string;
  ruleId?: string;
  executionId?: string;
  status: AutomationExecutionStatus;
  duplicate: boolean;
}

export const automationRulesQueryKey = (organizationId: string) =>
  ["automation-rules", organizationId] as const;
export const automationExecutionsQueryKey = (organizationId: string) =>
  ["automation-executions", organizationId] as const;

export function listAutomationRules(
  organizationId: string,
): Promise<AutomationRule[]> {
  return backendRequest<AutomationRule[]>(
    `organizations/${organizationId}/automation-rules`,
  );
}

export function createAutomationRule(
  organizationId: string,
  input: AutomationRuleInput,
): Promise<AutomationRule> {
  return backendRequest<AutomationRule>(
    `organizations/${organizationId}/automation-rules`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateAutomationRule(
  organizationId: string,
  ruleId: string,
  input: Partial<AutomationRuleInput>,
): Promise<AutomationRule> {
  return backendRequest<AutomationRule>(
    `organizations/${organizationId}/automation-rules/${ruleId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteAutomationRule(
  organizationId: string,
  ruleId: string,
): Promise<{ deleted: boolean }> {
  return backendRequest<{ deleted: boolean }>(
    `organizations/${organizationId}/automation-rules/${ruleId}`,
    { method: "DELETE" },
  );
}

export function simulateAutomationRule(
  organizationId: string,
  ruleId: string,
  input: SimulateAutomationInput,
): Promise<SimulateAutomationResult> {
  return backendRequest<SimulateAutomationResult>(
    `organizations/${organizationId}/automation-rules/${ruleId}/simulate`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function listAutomationExecutions(
  organizationId: string,
  pageSize = 25,
  status?: AutomationExecutionStatus,
): Promise<AutomationExecutionPage> {
  const query = new URLSearchParams({ page: "1", pageSize: String(pageSize) });
  if (status) query.set("status", status);
  return backendRequest<AutomationExecutionPage>(
    `organizations/${organizationId}/automation-executions?${query.toString()}`,
  );
}
