"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { InstagramAccount } from "@/lib/api/types";
import type {
  AutomationAction,
  AutomationActionType,
  AutomationCondition,
  AutomationConditionField,
  AutomationConditionOperator,
  AutomationRule,
  AutomationRuleInput,
  AutomationTrigger,
} from "@/lib/api/automations";

const inputClass =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";
const labelClass = "space-y-1.5 text-xs font-medium text-slate-600";

const conditionFields: Array<{
  value: AutomationConditionField;
  label: string;
}> = [
  { value: "text", label: "Text" },
  { value: "eventType", label: "Event type" },
  { value: "field", label: "Event field" },
  { value: "senderId", label: "Sender ID" },
  { value: "commentId", label: "Comment ID" },
  { value: "mediaId", label: "Media ID" },
  { value: "conversationId", label: "Conversation ID" },
];

const operators: Array<{ value: AutomationConditionOperator; label: string }> =
  [
    { value: "CONTAINS", label: "contains" },
    { value: "EQUALS", label: "equals" },
    { value: "STARTS_WITH", label: "starts with" },
    { value: "ENDS_WITH", label: "ends with" },
  ];

const triggerOptions: Array<{
  value: AutomationTrigger;
  label: string;
  description: string;
}> = [
  {
    value: "COMMENT_RECEIVED",
    label: "Comment received",
    description: "A new comment arrives on the connected account.",
  },
  {
    value: "MESSAGE_RECEIVED",
    label: "Message received",
    description: "A new direct message arrives.",
  },
  {
    value: "WEBHOOK_EVENT_RECEIVED",
    label: "Webhook event received",
    description: "Any supported Instagram webhook event arrives.",
  },
];

const actionOptions: Array<{ value: AutomationActionType; label: string }> = [
  { value: "REGISTER_EVENT", label: "Register event" },
  { value: "REPLY_COMMENT", label: "Reply to comment" },
  { value: "SEND_MESSAGE", label: "Send a message" },
  { value: "TAG_CONTACT", label: "Tag contact" },
  { value: "NOTIFY_OPERATOR", label: "Notify operator" },
];

export function AutomationRuleEditor({
  accounts,
  initialRule,
  saving,
  onCancel,
  onSave,
}: {
  accounts: InstagramAccount[];
  initialRule?: AutomationRule;
  saving: boolean;
  onCancel: () => void;
  onSave: (input: AutomationRuleInput, id?: string) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(
    initialRule?.instagramAccountId ?? accounts[0]?.id ?? "",
  );
  const [name, setName] = useState(initialRule?.name ?? "");
  const [triggerType, setTriggerType] = useState<AutomationTrigger>(
    initialRule?.triggerType ?? "COMMENT_RECEIVED",
  );
  const [match, setMatch] = useState<"ALL" | "ANY">(
    initialRule?.conditions.match ?? "ALL",
  );
  const [conditions, setConditions] = useState<AutomationCondition[]>(
    initialRule
      ? initialRule.conditions.rules
      : [{ field: "text", operator: "CONTAINS", value: "" }],
  );
  const [actions, setActions] = useState<AutomationAction[]>(
    initialRule?.actions?.length
      ? initialRule.actions
      : [{ type: "REGISTER_EVENT" }],
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function updateCondition(
    index: number,
    update: Partial<AutomationCondition>,
  ) {
    setConditions((current) =>
      current.map((condition, itemIndex) =>
        itemIndex === index ? { ...condition, ...update } : condition,
      ),
    );
    setValidationError(null);
  }

  function updateAction(index: number, action: AutomationAction) {
    setActions((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? action : item)),
    );
    setValidationError(null);
  }

  function selectAction(index: number, type: AutomationActionType) {
    const next: AutomationAction =
      type === "REGISTER_EVENT"
        ? { type }
        : type === "TAG_CONTACT"
          ? { type, tag: "" }
          : type === "NOTIFY_OPERATOR"
            ? { type, message: "" }
            : { type, text: "" };
    updateAction(index, next);
  }

  function validate(): string | null {
    if (!accountId) return "Select a connected Instagram account.";
    if (!name.trim()) return "Give this rule a name.";
    if (name.trim().length > 120)
      return "The rule name can contain up to 120 characters.";
    if (conditions.length > 20) return "A rule can have up to 20 conditions.";
    if (actions.length < 1 || actions.length > 10)
      return "Add between 1 and 10 actions.";
    if (conditions.some((condition) => !condition.value.trim()))
      return "Complete each condition or remove the blank row.";
    if (conditions.some((condition) => condition.value.length > 500))
      return "Condition values can contain up to 500 characters.";
    if (
      actions.some((action) => {
        if (action.type === "REGISTER_EVENT") return false;
        const value =
          action.type === "TAG_CONTACT"
            ? action.tag
            : action.type === "NOTIFY_OPERATOR"
              ? action.message
              : action.text;
        return (
          !value.trim() ||
          value.length > (action.type === "TAG_CONTACT" ? 64 : 500)
        );
      })
    )
      return "Complete each action. Text is limited to 500 characters and tags to 64.";
    const outboundCount = actions.filter(
      (action) =>
        action.type === "SEND_MESSAGE" || action.type === "REPLY_COMMENT",
    ).length;
    if (outboundCount > 1)
      return "Use at most one message or comment reply action per rule.";
    return null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = validate();
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    try {
      await onSave(
        {
          instagramAccountId: accountId,
          name: name.trim(),
          active: initialRule?.active ?? true,
          triggerType,
          conditions: {
            match,
            rules: conditions.map((condition) => ({
              ...condition,
              value: condition.value.trim(),
            })),
          },
          actions: actions.map((action) =>
            action.type === "REGISTER_EVENT"
              ? action
              : action.type === "TAG_CONTACT"
                ? { ...action, tag: action.tag.trim() }
                : action.type === "NOTIFY_OPERATOR"
                  ? { ...action, message: action.message.trim() }
                  : { ...action, text: action.text.trim() },
          ),
        },
        initialRule?.id,
      );
    } catch {
      setValidationError(
        "The rule could not be saved. Check the fields and try again.",
      );
    }
  }

  return (
    <section
      aria-labelledby="rule-editor-title"
      className="rounded-[22px] border border-indigo-200 bg-white p-5 shadow-sm shadow-indigo-950/[0.03] sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">
            Rule setup
          </p>
          <h2
            id="rule-editor-title"
            className="mt-1 text-xl font-semibold tracking-tight text-slate-950"
          >
            {initialRule ? "Edit automation" : "Create automation"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Choose a trigger, add simple conditions, then set the actions.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close rule editor"
          className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      <form className="mt-6 space-y-6" onSubmit={submit} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={labelClass}>
            Rule name
            <input
              aria-label="Rule name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setValidationError(null);
              }}
              maxLength={120}
              className={inputClass}
              placeholder="Launch comment reply"
            />
          </label>
          <label className={labelClass}>
            Instagram account
            <select
              aria-label="Automation Instagram account"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className={inputClass}
            >
              <option value="">Select an account</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.username
                    ? `@${account.username}`
                    : (account.name ?? "Instagram account")}{" "}
                  · {account.provider}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className={`${labelClass} block`}>
          When this happens
          <select
            aria-label="Automation trigger"
            value={triggerType}
            onChange={(event) =>
              setTriggerType(event.target.value as AutomationTrigger)
            }
            className={inputClass}
          >
            {triggerOptions.map((trigger) => (
              <option key={trigger.value} value={trigger.value}>
                {trigger.label}
              </option>
            ))}
          </select>
          <span className="block text-[11px] font-normal text-slate-400">
            {
              triggerOptions.find((trigger) => trigger.value === triggerType)
                ?.description
            }
          </span>
        </label>

        <fieldset className="space-y-3 rounded-2xl border border-slate-200 p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
            <div>
              <legend className="text-sm font-semibold text-slate-900">
                Conditions
              </legend>
              <p className="mt-1 text-xs text-slate-500">
                {conditions.length
                  ? "The event must match these conditions."
                  : "No conditions means every event with this trigger matches."}
              </p>
            </div>
            {conditions.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                <span>Match</span>
                <select
                  aria-label="Condition matching mode"
                  value={match}
                  onChange={(event) =>
                    setMatch(event.target.value as "ALL" | "ANY")
                  }
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-indigo-400"
                >
                  <option value="ALL">all conditions</option>
                  <option value="ANY">any condition</option>
                </select>
              </label>
            )}
          </div>
          <div className="space-y-2.5">
            {conditions.map((condition, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[1fr_1fr_1.25fr_auto]"
              >
                <label className="sr-only" htmlFor={`condition-field-${index}`}>
                  Condition field {index + 1}
                </label>
                <select
                  id={`condition-field-${index}`}
                  aria-label={`Condition field ${index + 1}`}
                  value={condition.field}
                  onChange={(event) =>
                    updateCondition(index, {
                      field: event.target.value as AutomationConditionField,
                    })
                  }
                  className={inputClass}
                >
                  {conditionFields.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </select>
                <label
                  className="sr-only"
                  htmlFor={`condition-operator-${index}`}
                >
                  Condition operator {index + 1}
                </label>
                <select
                  id={`condition-operator-${index}`}
                  aria-label={`Condition operator ${index + 1}`}
                  value={condition.operator}
                  onChange={(event) =>
                    updateCondition(index, {
                      operator: event.target
                        .value as AutomationConditionOperator,
                    })
                  }
                  className={inputClass}
                >
                  {operators.map((operator) => (
                    <option key={operator.value} value={operator.value}>
                      {operator.label}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`condition-value-${index}`}>
                  Condition value {index + 1}
                </label>
                <input
                  id={`condition-value-${index}`}
                  aria-label={`Condition value ${index + 1}`}
                  value={condition.value}
                  maxLength={500}
                  onChange={(event) =>
                    updateCondition(index, { value: event.target.value })
                  }
                  className={inputClass}
                  placeholder="e.g. launch"
                />
                <button
                  type="button"
                  aria-label={`Remove condition ${index + 1}`}
                  onClick={() =>
                    setConditions((current) =>
                      current.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 px-3 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={conditions.length >= 20}
            onClick={() =>
              setConditions((current) => [
                ...current,
                { field: "text", operator: "CONTAINS", value: "" },
              ])
            }
            className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden="true" /> Add condition
          </button>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl border border-slate-200 p-4 sm:p-5">
          <div>
            <legend className="text-sm font-semibold text-slate-900">
              Actions
            </legend>
            <p className="mt-1 text-xs text-slate-500">
              Run in order. A rule can send or reply at most once per event.
            </p>
          </div>
          <div className="space-y-3">
            {actions.map((action, index) => (
              <div
                key={index}
                className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 sm:p-4"
              >
                <div className="flex items-center gap-2">
                  <label
                    className="sr-only"
                    htmlFor={`automation-action-${index}`}
                  >
                    Action {index + 1}
                  </label>
                  <select
                    id={`automation-action-${index}`}
                    aria-label={`Action ${index + 1}`}
                    value={action.type}
                    onChange={(event) =>
                      selectAction(
                        index,
                        event.target.value as AutomationActionType,
                      )
                    }
                    className={inputClass}
                  >
                    {actionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove action ${index + 1}`}
                    onClick={() =>
                      setActions((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    className="inline-flex h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
                {action.type === "REGISTER_EVENT" ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Keep a record of the event in the execution history.
                  </p>
                ) : action.type === "TAG_CONTACT" ? (
                  <label className={`${labelClass} mt-3 block`}>
                    Contact tag
                    <input
                      aria-label={`Action tag ${index + 1}`}
                      maxLength={64}
                      value={action.tag}
                      onChange={(event) =>
                        updateAction(index, {
                          ...action,
                          tag: event.target.value,
                        })
                      }
                      className={inputClass}
                      placeholder="e.g. launch-interest"
                    />
                  </label>
                ) : action.type === "NOTIFY_OPERATOR" ? (
                  <label className={`${labelClass} mt-3 block`}>
                    Notification
                    <textarea
                      aria-label={`Action message ${index + 1}`}
                      maxLength={500}
                      value={action.message}
                      onChange={(event) =>
                        updateAction(index, {
                          ...action,
                          message: event.target.value,
                        })
                      }
                      className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      placeholder="Describe what the operator should review"
                    />
                  </label>
                ) : (
                  <label className={`${labelClass} mt-3 block`}>
                    Reply text
                    <textarea
                      aria-label={`Action message ${index + 1}`}
                      maxLength={500}
                      value={action.text}
                      onChange={(event) =>
                        updateAction(index, {
                          ...action,
                          text: event.target.value,
                        })
                      }
                      className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                      placeholder="Write a short response"
                    />
                  </label>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={actions.length >= 10}
            onClick={() =>
              setActions((current) => [...current, { type: "REGISTER_EVENT" }])
            }
            className="inline-flex h-9 items-center gap-2 rounded-lg px-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden="true" /> Add action
          </button>
        </fieldset>

        {validationError && (
          <p
            className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-medium text-rose-700"
            role="alert"
          >
            {validationError}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || accounts.length === 0}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              "Saving…"
            ) : (
              <>
                <Check className="size-3.5" aria-hidden="true" />{" "}
                {initialRule ? "Save changes" : "Create rule"}
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
