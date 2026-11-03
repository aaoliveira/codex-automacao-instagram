import { backendRequest } from "@/lib/api/client";
import type { AutomationAction, AutomationConditions, AutomationRule, AutomationTrigger } from "@/lib/api/automations";

export type AutomationTemplateScope = "SYSTEM" | "ORGANIZATION";
export type AutomationTemplateCategory = "CUSTOMER_SUPPORT" | "MODERATION" | "LEAD_GENERATION" | "NOTIFICATIONS";
export type TemplateVariableType = "STRING" | "NUMBER" | "BOOLEAN" | "ENUM";

export interface TemplateVariableDefinition {
  key: string;
  label: string;
  type: TemplateVariableType;
  required: boolean;
  description?: string;
  defaultValue?: string | number | boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: string[];
}

export interface AutomationTemplate {
  id: string;
  scope: AutomationTemplateScope;
  organizationId: string | null;
  name: string;
  description: string | null;
  category: AutomationTemplateCategory;
  version: number;
  schemaVersion: number;
  triggerType: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  variables: TemplateVariableDefinition[];
  active: boolean;
  archivedAt: string | null;
  authorUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationTemplateDefinition {
  name: string;
  description?: string | null;
  category: AutomationTemplateCategory;
  schemaVersion: number;
  triggerType: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
  variables: TemplateVariableDefinition[];
  active?: boolean;
}

export interface AutomationTemplateExport {
  format: "instagram-automation-template";
  version: 1;
  template: Omit<AutomationTemplateDefinition, "active">;
}

export interface TemplateValidationResult {
  valid: boolean;
  values: Record<string, string | number | boolean>;
  errors: string[];
}

export interface TemplateRulePreview {
  instagramAccountId: string;
  name: string;
  active: false;
  triggerType: AutomationTrigger;
  conditions: AutomationConditions;
  actions: AutomationAction[];
}

export const automationTemplatesQueryKey = (organizationId: string) => [
  "automation-templates",
  organizationId,
] as const;

export function listAutomationTemplates(
  organizationId: string,
  params: { category?: AutomationTemplateCategory | ""; search?: string; includeArchived?: boolean } = {},
): Promise<AutomationTemplate[]> {
  const query = new URLSearchParams();
  if (params.category) query.set("category", params.category);
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.includeArchived) query.set("includeArchived", "true");
  const suffix = query.size ? `?${query.toString()}` : "";
  return backendRequest<AutomationTemplate[]>(
    `organizations/${organizationId}/automation-templates${suffix}`,
  );
}

export function getAutomationTemplate(organizationId: string, templateId: string) {
  return backendRequest<AutomationTemplate>(
    `organizations/${organizationId}/automation-templates/${templateId}`,
  );
}

export function createAutomationTemplate(organizationId: string, input: AutomationTemplateDefinition) {
  return backendRequest<AutomationTemplate>(
    `organizations/${organizationId}/automation-templates`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateAutomationTemplate(organizationId: string, templateId: string, input: Partial<AutomationTemplateDefinition>) {
  return backendRequest<AutomationTemplate>(
    `organizations/${organizationId}/automation-templates/${templateId}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function duplicateAutomationTemplate(organizationId: string, templateId: string, name?: string) {
  return backendRequest<AutomationTemplate>(
    `organizations/${organizationId}/automation-templates/${templateId}/duplicate`,
    { method: "POST", body: JSON.stringify(name ? { name } : {}) },
  );
}

export function archiveAutomationTemplate(organizationId: string, templateId: string) {
  return backendRequest<AutomationTemplate>(
    `organizations/${organizationId}/automation-templates/${templateId}/archive`,
    { method: "POST" },
  );
}

export function restoreAutomationTemplate(organizationId: string, templateId: string) {
  return backendRequest<AutomationTemplate>(
    `organizations/${organizationId}/automation-templates/${templateId}/restore`,
    { method: "POST" },
  );
}

export function validateAutomationTemplateVariables(organizationId: string, templateId: string, variables: Record<string, unknown>) {
  return backendRequest<TemplateValidationResult>(
    `organizations/${organizationId}/automation-templates/${templateId}/validate`,
    { method: "POST", body: JSON.stringify({ variables }) },
  );
}

export function previewAutomationTemplate(
  organizationId: string,
  templateId: string,
  input: { instagramAccountId: string; variables: Record<string, unknown>; ruleName?: string },
) {
  return backendRequest<TemplateRulePreview>(
    `organizations/${organizationId}/automation-templates/${templateId}/preview`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function applyAutomationTemplate(
  organizationId: string,
  templateId: string,
  input: { instagramAccountId: string; variables: Record<string, unknown>; ruleName?: string },
) {
  return backendRequest<AutomationRule>(
    `organizations/${organizationId}/automation-templates/${templateId}/apply`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function importAutomationTemplate(organizationId: string, document: unknown) {
  return backendRequest<AutomationTemplate>(
    `organizations/${organizationId}/automation-templates/import`,
    { method: "POST", body: JSON.stringify({ document }) },
  );
}

export function exportAutomationTemplate(organizationId: string, templateId: string) {
  return backendRequest<AutomationTemplateExport>(
    `organizations/${organizationId}/automation-templates/${templateId}/export`,
  );
}

export function createTemplateFromRuleInput(
  rule: AutomationRule,
  category: AutomationTemplateCategory,
): AutomationTemplateDefinition {
  return {
    name: rule.name,
    description: `Template copied from automation rule “${rule.name}”.`,
    category,
    schemaVersion: 1,
    triggerType: rule.triggerType,
    conditions: rule.conditions,
    actions: rule.actions,
    variables: [],
    active: true,
  };
}
