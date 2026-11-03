import { AutomationTemplateCategory, AutomationTriggerType } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { assertTemplateContent, renderTemplate, resolveTemplateVariables, TemplateVariable } from "./automation-template.schema";

const variables: TemplateVariable[] = [
  { key: "keyword", label: "Keyword", type: "STRING", required: true, minLength: 1, maxLength: 40 },
  { key: "brand", label: "Brand", type: "STRING", required: false, defaultValue: "Our team", maxLength: 40 },
];
const content = {
  name: "Comment response",
  category: AutomationTemplateCategory.CUSTOMER_SUPPORT,
  schemaVersion: 1,
  triggerType: AutomationTriggerType.COMMENT_RECEIVED,
  conditions: { match: "ALL", rules: [{ field: "text", operator: "CONTAINS", value: "{{keyword}}" }] },
  actions: [{ type: "REGISTER_EVENT" }, { type: "REPLY_COMMENT", text: "Thanks, {{brand}}" }],
  variables,
  active: true,
};

describe("automation template schema", () => {
  it("validates typed variables, applies defaults and renders a safe rule definition", () => {
    const definition = assertTemplateContent(content);
    const values = resolveTemplateVariables(definition, { keyword: "pricing" });
    expect(values).toEqual({ keyword: "pricing", brand: "Our team" });
    expect(renderTemplate(content, values)).toEqual({
      conditions: { match: "ALL", rules: [{ field: "text", operator: "CONTAINS", value: "pricing" }] },
      actions: [{ type: "REGISTER_EVENT" }, { type: "REPLY_COMMENT", text: "Thanks, Our team" }],
    });
  });

  it("rejects missing values, secret-like variable keys and executable expressions", () => {
    expect(() => resolveTemplateVariables(variables, {})).toThrow(BadRequestException);
    expect(() => assertTemplateContent({
      ...content,
      variables: [{ key: "access_token", label: "Token", type: "STRING", required: true }],
    })).toThrow(BadRequestException);
    expect(() => assertTemplateContent({
      ...content,
      actions: [{ type: "REPLY_COMMENT", text: "{{keyword.toUpperCase()}}" }],
    })).toThrow(BadRequestException);
  });

  it("rejects a category/action combination and unsupported schema versions", () => {
    expect(() => assertTemplateContent({
      ...content,
      category: AutomationTemplateCategory.MODERATION,
      actions: [{ type: "REPLY_COMMENT", text: "{{brand}}" }],
    })).toThrow(BadRequestException);
    expect(() => assertTemplateContent({ ...content, schemaVersion: 2 })).toThrow(BadRequestException);
  });

  it("validates number, boolean and enum variables and enforces the definition size limit", () => {
    const typed = [
      { key: "score", label: "Score", type: "NUMBER", required: true, min: 1, max: 10 },
      { key: "enabled", label: "Enabled", type: "BOOLEAN", required: true },
      { key: "channel", label: "Channel", type: "ENUM", required: true, options: ["sales", "support"] },
    ] as const;
    expect(resolveTemplateVariables(typed as never, { score: 4, enabled: false, channel: "sales" })).toEqual({ score: 4, enabled: false, channel: "sales" });
    expect(() => resolveTemplateVariables(typed as never, { score: 11, enabled: false, channel: "sales" })).toThrow(BadRequestException);
    const oversizedVariables = Array.from({ length: 7 }, (_, index) => ({
      key: `choice_${index}`,
      label: `Choice ${index}`,
      type: "ENUM",
      required: true,
      options: Array.from({ length: 50 }, (_unused, option) => `${"x".repeat(95)}${option}`),
    }));
    expect(() => assertTemplateContent({
      ...content,
      conditions: { match: "ALL", rules: [] },
      actions: [{ type: "REGISTER_EVENT" }],
      variables: oversizedVariables,
    })).toThrow(BadRequestException);
  });
});
