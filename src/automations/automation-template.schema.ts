import { AutomationActionType, AutomationTemplateCategory, AutomationTriggerType, Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { isAutomationActions, isAutomationConditions } from "./automation-rule.schema";

export type TemplateVariable = {
  key: string;
  label: string;
  type: "STRING" | "NUMBER" | "BOOLEAN" | "ENUM";
  required: boolean;
  description?: string;
  defaultValue?: string | number | boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: string[];
};

export type TemplateContent = {
  name: string;
  description?: string | null;
  category: AutomationTemplateCategory;
  schemaVersion: number;
  triggerType: AutomationTriggerType;
  conditions: unknown;
  actions: unknown;
  variables: unknown;
  active: boolean;
};

const MAX_TEMPLATE_BYTES = 32_768;
const MAX_VARIABLES = 20;
const SECRET_KEY = /(token|secret|password|credential|api.?key)/i;
const CATEGORY_ACTIONS: Record<AutomationTemplateCategory, Set<AutomationActionType>> = {
  CUSTOMER_SUPPORT: new Set(Object.values(AutomationActionType)),
  MODERATION: new Set([AutomationActionType.REGISTER_EVENT, AutomationActionType.TAG_CONTACT, AutomationActionType.NOTIFY_OPERATOR]),
  LEAD_GENERATION: new Set([AutomationActionType.REGISTER_EVENT, AutomationActionType.REPLY_COMMENT, AutomationActionType.SEND_MESSAGE, AutomationActionType.TAG_CONTACT, AutomationActionType.NOTIFY_OPERATOR]),
  NOTIFICATIONS: new Set([AutomationActionType.REGISTER_EVENT, AutomationActionType.NOTIFY_OPERATOR]),
};

export function assertTemplateContent(content: TemplateContent): TemplateVariable[] {
  if (content.schemaVersion !== 1) throw new BadRequestException("Unsupported template schemaVersion");
  if (!Object.values(AutomationTemplateCategory).includes(content.category) || !Object.values(AutomationTriggerType).includes(content.triggerType)) throw new BadRequestException("Unsupported template category or trigger");
  if (typeof content.name !== "string" || !content.name.trim() || content.name.trim().length > 120) throw new BadRequestException("Template name must contain 1 to 120 characters");
  if (content.description != null && (typeof content.description !== "string" || content.description.length > 2_000)) throw new BadRequestException("Template description must not exceed 2000 characters");
  if (typeof content.active !== "boolean") throw new BadRequestException("Template active must be a boolean");
  if (!isAutomationConditions(content.conditions) || !isAutomationActions(content.actions)) throw new BadRequestException("Template conditions or actions do not match the supported automation schema");
  const variables = validateVariableSchema(content.variables);
  const actions = content.actions as Array<Record<string, unknown>>;
  for (const action of actions) {
    const type = action.type as AutomationActionType;
    if (!CATEGORY_ACTIONS[content.category]?.has(type)) throw new BadRequestException(`Action ${type} is not supported in category ${content.category}`);
    if (type === AutomationActionType.SEND_MESSAGE && content.triggerType !== AutomationTriggerType.MESSAGE_RECEIVED) throw new BadRequestException("SEND_MESSAGE requires MESSAGE_RECEIVED trigger");
    if (type === AutomationActionType.REPLY_COMMENT && content.triggerType !== AutomationTriggerType.COMMENT_RECEIVED) throw new BadRequestException("REPLY_COMMENT requires COMMENT_RECEIVED trigger");
  }
  const keys = new Set(variables.map((variable) => variable.key));
  const templated = templateStrings(content.conditions, content.actions);
  const referenced = new Set<string>();
  for (const value of templated) for (const key of validatePlaceholders(value, keys)) referenced.add(key);
  for (const variable of variables) if (referenced.has(variable.key) && !variable.required && variable.defaultValue === undefined) throw new BadRequestException(`Optional variable ${variable.key} must have a default when used in a template`);
  const bytes = Buffer.byteLength(JSON.stringify({ conditions: content.conditions, actions: content.actions, variables }), "utf8");
  if (bytes > MAX_TEMPLATE_BYTES) throw new BadRequestException("Template definition exceeds 32 KB");
  return variables;
}

export function validateVariableSchema(value: unknown): TemplateVariable[] {
  if (!Array.isArray(value) || value.length > MAX_VARIABLES) throw new BadRequestException("variables must be an array of at most 20 definitions");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!isRecord(item)) throw new BadRequestException("Each variable definition must be an object");
    const allowed = new Set(["key", "label", "type", "required", "description", "defaultValue", "minLength", "maxLength", "min", "max", "options"]);
    if (Object.keys(item).some((key) => !allowed.has(key))) throw new BadRequestException("Variable definition contains unsupported properties");
    const { key, label, type, required } = item;
    if (typeof key !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(key) || SECRET_KEY.test(key) || seen.has(key)) throw new BadRequestException("Variable keys must be unique safe identifiers");
    if (typeof label !== "string" || !label.trim() || label.length > 100) throw new BadRequestException(`Variable ${key} must have a label of at most 100 characters`);
    if (!["STRING", "NUMBER", "BOOLEAN", "ENUM"].includes(String(type)) || typeof required !== "boolean") throw new BadRequestException(`Variable ${key} has an unsupported type or required flag`);
    if (item.description !== undefined && (typeof item.description !== "string" || item.description.length > 500)) throw new BadRequestException(`Variable ${key} description is too long`);
    for (const bound of ["minLength", "maxLength", "min", "max"] as const) {
      if (item[bound] !== undefined && (typeof item[bound] !== "number" || !Number.isFinite(item[bound]))) throw new BadRequestException(`Variable ${key} has an invalid bound`);
    }
    if (item.minLength !== undefined && (type !== "STRING" || item.minLength < 0 || item.minLength > 500)) throw new BadRequestException(`Variable ${key} has an invalid minLength`);
    if (item.maxLength !== undefined && (type !== "STRING" || item.maxLength < 1 || item.maxLength > 500 || (item.minLength !== undefined && item.maxLength < item.minLength))) throw new BadRequestException(`Variable ${key} has an invalid maxLength`);
    if (item.min !== undefined && (type !== "NUMBER" || (item.max !== undefined && item.max < item.min))) throw new BadRequestException(`Variable ${key} has an invalid minimum`);
    if (item.max !== undefined && type !== "NUMBER") throw new BadRequestException(`Variable ${key} has an invalid maximum`);
    if (type === "ENUM") {
      if (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > 50 || item.options.some((option) => typeof option !== "string" || !option || option.length > 100) || new Set(item.options).size !== item.options.length) throw new BadRequestException(`ENUM variable ${key} requires 1 to 50 unique string options`);
    } else if (item.options !== undefined) throw new BadRequestException(`Only ENUM variables can define options`);
    if (item.defaultValue !== undefined) validateValue(item as unknown as TemplateVariable, item.defaultValue, true);
    seen.add(key);
    return item as unknown as TemplateVariable;
  });
}

export function resolveTemplateVariables(schema: TemplateVariable[], input: unknown): Record<string, string | number | boolean> {
  if (input === undefined) input = {};
  if (!isRecord(input) || Buffer.byteLength(JSON.stringify(input), "utf8") > 8_192) throw new BadRequestException("variables must be a JSON object of at most 8 KB");
  const definitions = new Map(schema.map((variable) => [variable.key, variable]));
  if (Object.keys(input).some((key) => !definitions.has(key))) throw new BadRequestException("Unknown template variable supplied");
  const result: Record<string, string | number | boolean> = {};
  for (const definition of schema) {
    const supplied = input[definition.key];
    const value = supplied === undefined ? definition.defaultValue : supplied;
    if (value === undefined) {
      if (definition.required) throw new BadRequestException(`Variable ${definition.key} is required`);
      continue;
    }
    validateValue(definition, value, false);
    result[definition.key] = value as string | number | boolean;
  }
  return result;
}

export function renderTemplate(content: Pick<TemplateContent, "conditions" | "actions">, variables: Record<string, string | number | boolean>) {
  const render = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(/\{\{([a-z][a-z0-9_]{0,39})\}\}/g, (_match, key: string) => String(variables[key]));
    if (Array.isArray(value)) return value.map(render);
    if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)]));
    return value;
  };
  return { conditions: render(content.conditions), actions: render(content.actions) };
}

export function exportTemplate(content: TemplateContent) {
  return {
    format: "instagram-automation-template" as const,
    version: 1,
    template: {
      name: content.name,
      description: content.description ?? null,
      category: content.category,
      schemaVersion: content.schemaVersion,
      triggerType: content.triggerType,
      conditions: content.conditions,
      actions: content.actions,
      variables: content.variables,
    },
  };
}

export function parseTemplateImport(value: unknown): Omit<TemplateContent, "active"> {
  if (!isRecord(value) || Object.keys(value).some((key) => !["format", "version", "template"].includes(key)) || value.format !== "instagram-automation-template" || value.version !== 1 || !isRecord(value.template)) throw new BadRequestException("Invalid automation template export document");
  const template = value.template;
  const allowed = new Set(["name", "description", "category", "schemaVersion", "triggerType", "conditions", "actions", "variables"]);
  if (Object.keys(template).some((key) => !allowed.has(key))) throw new BadRequestException("Import document contains unsupported fields");
  const content = { ...template, active: true } as unknown as TemplateContent;
  assertTemplateContent(content);
  return content;
}

export function templateSnapshot(content: TemplateContent): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify({ ...content, description: content.description ?? null })) as Prisma.InputJsonObject;
}

function validateValue(definition: TemplateVariable, value: unknown, fromDefault: boolean): void {
  let valid = false;
  switch (definition.type) {
    case "STRING": valid = typeof value === "string" && value.trim().length > 0 && value.length <= (definition.maxLength ?? 500) && value.length >= (definition.minLength ?? 0); break;
    case "NUMBER": valid = typeof value === "number" && Number.isFinite(value) && (definition.min === undefined || value >= definition.min) && (definition.max === undefined || value <= definition.max); break;
    case "BOOLEAN": valid = typeof value === "boolean"; break;
    case "ENUM": valid = typeof value === "string" && definition.options?.includes(value) === true; break;
  }
  if (!valid) throw new BadRequestException(`${fromDefault ? "Default" : "Value"} for variable ${definition.key} does not match its schema`);
}

function templateStrings(conditions: unknown, actions: unknown): string[] {
  const result: string[] = [];
  const conditionRules = (conditions as { rules: Array<{ value: string }> }).rules;
  result.push(...conditionRules.map((rule) => rule.value));
  for (const action of actions as Array<Record<string, unknown>>) {
    const key = action.type === "TAG_CONTACT" ? "tag" : action.type === "NOTIFY_OPERATOR" ? "message" : "text";
    if (key in action) result.push(action[key] as string);
  }
  return result;
}

function validatePlaceholders(value: string, keys: Set<string>): Set<string> {
  const referenced = new Set<string>();
  const stripped = value.replace(/\{\{([a-z][a-z0-9_]{0,39})\}\}/g, (_match, key: string) => {
    if (!keys.has(key)) throw new BadRequestException(`Template references undefined variable ${key}`);
    referenced.add(key);
    return "";
  });
  if (/[{}]/.test(stripped)) throw new BadRequestException("Templates support only {{variable_name}} placeholders; expressions and scripts are prohibited");
  return referenced;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
