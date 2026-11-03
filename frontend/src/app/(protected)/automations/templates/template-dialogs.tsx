"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Check, CircleAlert, LoaderCircle, X } from "lucide-react";
import type { AutomationAction, AutomationRule, AutomationTrigger } from "@/lib/api/automations";
import type {
  AutomationTemplate,
  AutomationTemplateCategory,
  AutomationTemplateDefinition,
  TemplateRulePreview,
  TemplateValidationResult,
  TemplateVariableDefinition,
} from "@/lib/api/automation-templates";
import type { InstagramAccount } from "@/lib/api/types";

const fieldClass = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";
const labelClass = "block space-y-1.5 text-xs font-medium text-slate-600";
const buttonPrimary = "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700";
const buttonSecondary = "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 transition hover:bg-slate-50";
const categoryOptions: Array<{ value: AutomationTemplateCategory; label: string }> = [
  { value: "CUSTOMER_SUPPORT", label: "Customer support" },
  { value: "MODERATION", label: "Moderation" },
  { value: "LEAD_GENERATION", label: "Lead generation" },
  { value: "NOTIFICATIONS", label: "Notifications" },
];
const triggerLabels: Record<AutomationTrigger, string> = {
  COMMENT_RECEIVED: "Comment received",
  MESSAGE_RECEIVED: "Message received",
  WEBHOOK_EVENT_RECEIVED: "Webhook event received",
};

export function TemplateDetailDialog({
  template,
  canManage,
  onClose,
  onUse,
  onEdit,
  onDuplicate,
  onArchive,
  onRestore,
}: {
  template: AutomationTemplate;
  canManage: boolean;
  onClose: () => void;
  onUse: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <DialogFrame title={template.name} eyebrow="Template details" onClose={onClose}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <ScopePill scope={template.scope} />
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-semibold text-indigo-700">{categoryLabel(template.category)}</span>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${template.schemaVersion === 1 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {template.schemaVersion === 1 ? `Compatible · schema v${template.schemaVersion}` : `Unsupported · schema v${template.schemaVersion}`}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600">Template v{template.version}</span>
          {template.archivedAt && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800">Archived</span>}
        </div>
        <p className="text-sm leading-6 text-slate-600">{template.description || "No description provided."}</p>
        <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Trigger</p>
          <p className="mt-1.5 text-sm font-semibold text-slate-800">{triggerLabels[template.triggerType]}</p>
        </section>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Actions</h3>
          <div className="mt-2 space-y-2">
            {template.actions.map((action, index) => <ActionCard action={action} index={index} key={`${action.type}-${index}`} />)}
          </div>
        </section>
        <section>
          <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">Requirements</h3>
          {template.variables.length ? (
            <div className="mt-2 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {template.variables.map((variable) => <VariableRequirement variable={variable} key={variable.key} />)}
            </div>
          ) : <p className="mt-2 text-xs text-slate-500">No variables required. Choose a connected account to continue.</p>}
        </section>
        {(template.actions.some(isOfficialApiAction) || template.triggerType === "MESSAGE_RECEIVED") && (
          <div className="flex gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-xs leading-5 text-sky-900">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Availability for message and comment actions depends on the connected provider and the current official Instagram API permissions and limits.
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          {canManage && template.scope === "ORGANIZATION" && !template.archivedAt && <button type="button" onClick={onEdit} className={buttonSecondary}>Edit template</button>}
          {canManage && <button type="button" onClick={onDuplicate} className={buttonSecondary}>Duplicate</button>}
          {canManage && template.scope === "ORGANIZATION" && (template.archivedAt
            ? <button type="button" onClick={onRestore} className={buttonSecondary}>Restore</button>
            : <button type="button" onClick={onArchive} className={`${buttonSecondary} text-rose-700`}>Archive</button>)}
          {!template.archivedAt && template.active && template.schemaVersion === 1 && <button type="button" onClick={onUse} className={buttonPrimary}>Use template</button>}
        </div>
      </div>
    </DialogFrame>
  );
}

export function TemplateUseDialog({
  template,
  canApply,
  accounts,
  accountsLoading,
  accountsError,
  onClose,
  onValidate,
  onPreview,
  onApply,
}: {
  template: AutomationTemplate;
  canApply: boolean;
  accounts: InstagramAccount[];
  accountsLoading: boolean;
  accountsError?: string;
  onClose: () => void;
  onValidate: (variables: Record<string, unknown>) => Promise<TemplateValidationResult>;
  onPreview: (input: { instagramAccountId: string; variables: Record<string, unknown>; ruleName?: string }) => Promise<TemplateRulePreview>;
  onApply: (input: { instagramAccountId: string; variables: Record<string, unknown>; ruleName?: string }) => Promise<void>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [ruleName, setRuleName] = useState(template.name);
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(template.variables.map((item) => [item.key, item.defaultValue ?? (item.type === "BOOLEAN" ? false : "")])));
  const [validated, setValidated] = useState<Record<string, string | number | boolean> | null>(null);
  const [preview, setPreview] = useState<TemplateRulePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateValue(key: string, value: unknown) {
    setValues((current) => ({ ...current, [key]: value }));
    setValidated(null);
    setPreview(null);
    setError(null);
  }

  function getInputValues() {
    return Object.fromEntries(template.variables.flatMap((variable) => {
      const value = values[variable.key];
      if (!variable.required && (value === "" || value === undefined || value === null)) return [];
      if (variable.type === "NUMBER" && typeof value === "string" && value.trim()) return [[variable.key, Number(value)]];
      return [[variable.key, value]];
    }));
  }

  async function validate() {
    if (!accountId) { setError("Select a connected Instagram account first."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await onValidate(getInputValues());
      if (!result.valid) { setError(result.errors.join(" ") || "Check the required values and try again."); return; }
      setValidated(result.values);
      setValues((current) => ({ ...current, ...result.values }));
    } catch (caught) { setError(readableError(caught)); }
    finally { setBusy(false); }
  }

  async function showPreview() {
    if (!validated || !accountId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onPreview({ instagramAccountId: accountId, variables: validated, ruleName: ruleName.trim() || undefined });
      setPreview(result);
    } catch (caught) { setError(readableError(caught)); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!validated || !accountId || !preview) return;
    setBusy(true);
    setError(null);
    try { await onApply({ instagramAccountId: accountId, variables: validated, ruleName: ruleName.trim() || undefined }); }
    catch (caught) { setError(readableError(caught)); setBusy(false); }
  }

  return (
    <DialogFrame title={`Use ${template.name}`} eyebrow="Template assistant" onClose={onClose} wide>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <ScopePill scope={template.scope} /><span>Template v{template.version}</span><span>·</span><span>Schema v{template.schemaVersion}</span>
          <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">Generated rule starts paused</span>
        </div>
        {accountsLoading ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">Loading connected accounts…</div> : accounts.length ? (
          <label className={labelClass}>Instagram account
            <select aria-label="Template Instagram account" className={fieldClass} value={accountId} onChange={(event) => { setAccountId(event.target.value); setPreview(null); }}>
              <option value="">Select an account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.username ? `@${account.username}` : account.name || "Instagram account"} · {account.provider}{account.provider === "MOCK" ? " · MOCK" : ""}</option>)}
            </select>
          </label>
        ) : (
          <div role={accountsError ? "alert" : undefined} className={`rounded-xl border p-4 text-xs leading-5 ${accountsError ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>{accountsError || "No connected account is available to this user. Connect an account or ask an admin for access."}</div>
        )}
        <label className={labelClass}>Rule name
          <input aria-label="Generated rule name" className={fieldClass} maxLength={120} value={ruleName} onChange={(event) => setRuleName(event.target.value)} />
        </label>
        {template.variables.length > 0 && <section className="space-y-3 rounded-2xl border border-slate-200 p-4">
          <div><h3 className="text-sm font-semibold text-slate-900">Set template variables</h3><p className="mt-1 text-xs text-slate-500">Values are checked by the backend and inserted as plain text.</p></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {template.variables.map((variable) => <VariableInput variable={variable} key={variable.key} value={values[variable.key]} onChange={(value) => updateValue(variable.key, value)} />)}
          </div>
        </section>}
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-5 text-rose-800">{error}</p>}
        {validated && <p role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs font-medium text-emerald-800"><Check className="size-4" aria-hidden="true" />Variables validated. Review the generated rule before applying.</p>}
        {preview && <PreviewCard preview={preview} />}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} className={buttonSecondary}>Cancel</button>
          {!preview ? <>
            <button type="button" onClick={() => void validate()} disabled={busy || accountsLoading || !accounts.length} className={`${buttonSecondary} disabled:opacity-50`}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}Validate values</button>
            <button type="button" onClick={() => void showPreview()} disabled={busy || !validated} className={`${buttonPrimary} disabled:opacity-50`}>Preview rule</button>
          </> : canApply ? <button type="button" onClick={() => void apply()} disabled={busy} className={`${buttonPrimary} disabled:opacity-50`}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}Apply as paused rule</button> : <div className="flex flex-col items-end gap-2"><p className="text-right text-[11px] text-slate-500">Only an Owner or Admin can create a rule from this preview.</p><button type="button" disabled className={`${buttonPrimary} cursor-not-allowed opacity-45`}>Apply as paused rule</button></div>}
        </div>
      </div>
    </DialogFrame>
  );
}

export function TemplateEditorDialog({
  template,
  rules,
  onClose,
  onSave,
}: {
  template?: AutomationTemplate;
  rules: AutomationRule[];
  onClose: () => void;
  onSave: (input: AutomationTemplateDefinition, templateId?: string) => Promise<void>;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [category, setCategory] = useState<AutomationTemplateCategory>(template?.category ?? "CUSTOMER_SUPPORT");
  const [triggerType, setTriggerType] = useState<AutomationTrigger>(template?.triggerType ?? "COMMENT_RECEIVED");
  const [conditions, setConditions] = useState(JSON.stringify(template?.conditions ?? { match: "ALL", rules: [] }, null, 2));
  const [actions, setActions] = useState(JSON.stringify(template?.actions ?? [{ type: "REGISTER_EVENT" }], null, 2));
  const [variables, setVariables] = useState(JSON.stringify(template?.variables ?? [], null, 2));
  const [active, setActive] = useState(template?.active ?? true);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRule = useMemo(() => rules.find((rule) => rule.id === selectedRuleId), [rules, selectedRuleId]);

  function chooseRule(ruleId: string) {
    setSelectedRuleId(ruleId);
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) return;
    setName(rule.name);
    setDescription(`Template copied from automation rule “${rule.name}”.`);
    setTriggerType(rule.triggerType);
    setConditions(JSON.stringify(rule.conditions, null, 2));
    setActions(JSON.stringify(rule.actions, null, 2));
    setVariables("[]");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Enter a template name."); return; }
    try {
      const input: AutomationTemplateDefinition = {
        name: name.trim(), description: description.trim() || null, category, schemaVersion: 1, triggerType,
        conditions: JSON.parse(conditions) as AutomationTemplateDefinition["conditions"],
        actions: JSON.parse(actions) as AutomationTemplateDefinition["actions"],
        variables: JSON.parse(variables) as AutomationTemplateDefinition["variables"],
        active,
      };
      setSaving(true);
      await onSave(input, template?.id);
    } catch (caught) {
      setError(caught instanceof SyntaxError ? "Conditions, actions and variables must each contain valid JSON." : readableError(caught));
    } finally { setSaving(false); }
  }

  return (
    <DialogFrame title={template ? "Edit organization template" : selectedRule ? "Create template from rule" : "Create organization template"} eyebrow="Template editor" onClose={onClose} wide>
      <form className="space-y-4" onSubmit={submit}>
        {!template && <label className={labelClass}>Start from an existing rule (optional)
          <select aria-label="Template source rule" className={fieldClass} value={selectedRuleId} onChange={(event) => chooseRule(event.target.value)}>
            <option value="">Start with a blank definition</option>
            {rules.map((rule) => <option value={rule.id} key={rule.id}>{rule.name} · {triggerLabels[rule.triggerType]}</option>)}
          </select>
          {!rules.length && <span className="block text-[11px] font-normal text-slate-400">No existing rules available. You can still create a template below.</span>}
        </label>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>Template name<input aria-label="Template name" className={fieldClass} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className={labelClass}>Category<select aria-label="Template category" className={fieldClass} value={category} onChange={(event) => setCategory(event.target.value as AutomationTemplateCategory)}>{categoryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        </div>
        <label className={labelClass}>Description<textarea aria-label="Template description" className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>Trigger<select aria-label="Template trigger" className={fieldClass} value={triggerType} onChange={(event) => setTriggerType(event.target.value as AutomationTrigger)}>{Object.entries(triggerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label className="flex items-center gap-2 self-end pb-3 text-xs font-medium text-slate-600"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />Available to apply</label>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          <JsonEditor label="Conditions JSON" value={conditions} onChange={setConditions} />
          <JsonEditor label="Actions JSON" value={actions} onChange={setActions} />
          <JsonEditor label="Variables JSON" value={variables} onChange={setVariables} />
        </div>
        <p className="rounded-xl border border-sky-100 bg-sky-50 px-3.5 py-3 text-[11px] leading-5 text-sky-900">Only the existing structured trigger/action schema is accepted. Variables use <code>{"{{variable_name}}"}</code>. Imported or edited content is stored as data and is never executed as code.</p>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-5 text-rose-800">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={onClose} className={buttonSecondary}>Cancel</button><button type="submit" disabled={saving} className={`${buttonPrimary} disabled:opacity-50`}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : null}{template ? "Save new version" : "Create template"}</button></div>
      </form>
    </DialogFrame>
  );
}

function VariableInput({ variable, value, onChange }: { variable: TemplateVariableDefinition; value: unknown; onChange: (value: unknown) => void }) {
  const control = variable.type === "BOOLEAN" ? (
    <input aria-label={variable.label} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
  ) : variable.type === "ENUM" ? (
    <select aria-label={variable.label} className={fieldClass} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)}><option value="">Select an option</option>{variable.options?.map((option) => <option value={option} key={option}>{option}</option>)}</select>
  ) : (
    <input aria-label={variable.label} className={fieldClass} type={variable.type === "NUMBER" ? "number" : "text"} min={variable.type === "NUMBER" ? variable.min : undefined} max={variable.type === "NUMBER" ? variable.max : undefined} minLength={variable.type === "STRING" ? variable.minLength : undefined} maxLength={variable.type === "STRING" ? variable.maxLength : undefined} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />
  );
  return <label className={labelClass}><span className="flex items-center gap-1">{variable.label}{variable.required && <span className="text-rose-600" aria-label="required">*</span>}<span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">{variable.type.toLowerCase()}</span></span>{control}{variable.description && <span className="block text-[10px] font-normal leading-4 text-slate-400">{variable.description}</span>}{variable.defaultValue !== undefined && <span className="block text-[10px] font-normal text-slate-400">Default: {String(variable.defaultValue)}</span>}</label>;
}

function VariableRequirement({ variable }: { variable: TemplateVariableDefinition }) {
  return <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5 text-xs"><span className="font-semibold text-slate-800">{variable.label}</span><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase text-slate-500">{variable.type}</span><span className="text-slate-400">{variable.required ? "Required" : "Optional"}{variable.defaultValue !== undefined ? ` · default: ${String(variable.defaultValue)}` : ""}</span><span className="ml-auto text-[10px] text-slate-400">{`{{${variable.key}}}`}</span></div>;
}

function ActionCard({ action, index }: { action: AutomationAction; index: number }) {
  const label = action.type === "REGISTER_EVENT" ? "Register event" : action.type === "REPLY_COMMENT" ? "Reply to comment" : action.type === "SEND_MESSAGE" ? "Send a message" : action.type === "TAG_CONTACT" ? "Tag contact" : "Notify operator";
  const value = action.type === "REGISTER_EVENT" ? null : action.type === "TAG_CONTACT" ? action.tag : action.type === "NOTIFY_OPERATOR" ? action.message : action.text;
  return <div className="rounded-xl border border-slate-200 px-3.5 py-3"><div className="flex items-center gap-2"><span className="flex size-6 items-center justify-center rounded-md bg-indigo-50 text-[10px] font-bold text-indigo-700">{index + 1}</span><span className="text-xs font-semibold text-slate-800">{label}</span>{isOfficialApiAction(action) && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-semibold text-sky-800">Provider/API dependent</span>}</div>{value && <p className="mt-2 break-words rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">{value}</p>}</div>;
}

function PreviewCard({ preview }: { preview: TemplateRulePreview }) {
  return <section aria-label="Generated rule preview" className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-slate-900">Review generated rule</h3><span className="rounded-full bg-slate-200 px-2.5 py-1 text-[10px] font-semibold text-slate-600">Paused · requires activation</span></div><div className="grid gap-3 text-xs sm:grid-cols-2"><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Rule name</p><p className="mt-1 font-semibold text-slate-800">{preview.name}</p></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Trigger</p><p className="mt-1 font-semibold text-slate-800">{triggerLabels[preview.triggerType]}</p></div></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Conditions</p><pre className="mt-1 overflow-x-auto rounded-xl bg-white p-3 text-[10px] leading-4 text-slate-600">{JSON.stringify(preview.conditions, null, 2)}</pre></div><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Actions</p><div className="mt-1 space-y-2">{preview.actions.map((action, index) => <ActionCard action={action} index={index} key={`${action.type}-${index}`} />)}</div></div><p className="text-[11px] leading-5 text-indigo-900">Applying stores this rule independently from the template. You can review it in Automations; it remains inactive until an Owner or Admin activates it.</p></section>;
}

function JsonEditor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className={labelClass}>{label}<textarea aria-label={label} spellCheck={false} className="min-h-44 w-full rounded-xl border border-slate-200 bg-slate-950 px-3 py-2.5 font-mono text-[10px] leading-5 text-slate-100 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function DialogFrame({ title, eyebrow, onClose, wide, children }: { title: string; eyebrow: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"><section role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-2xl sm:rounded-[24px] sm:p-6 ${wide ? "max-w-4xl" : "max-w-2xl"}`}><div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-100 pb-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.13em] text-indigo-600">{eyebrow}</p><h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{title}</h2></div><button type="button" aria-label="Close dialog" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" aria-hidden="true" /></button></div>{children}</section></div>;
}

export function ScopePill({ scope }: { scope: AutomationTemplate["scope"] }) {
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${scope === "SYSTEM" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-700"}`}>{scope === "SYSTEM" ? "SYSTEM · read-only" : "Organization"}</span>;
}

export function categoryLabel(category: AutomationTemplateCategory) {
  return categoryOptions.find((item) => item.value === category)?.label ?? category;
}

export function isOfficialApiAction(action: AutomationAction) {
  return action.type === "SEND_MESSAGE" || action.type === "REPLY_COMMENT";
}

export function readableError(error: unknown): string {
  if (error && typeof error === "object" && "status" in error && (error as { status: unknown }).status === 403) return "You do not have permission for this action. Ask an organization Owner or Admin.";
  if (error instanceof Error) return error.message;
  return "The request could not be completed. Try again.";
}

export function ruleTriggerLabel(trigger: AutomationTrigger) {
  return triggerLabels[trigger];
}
