"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, Bot, CheckCircle2, CircleAlert, Copy, Download, FileUp, LoaderCircle, Plus, Search, Sparkles, WandSparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useSession } from "@/components/session-context";
import { InlineError, LoadingState } from "@/components/ui/states";
import { listAutomationRules, automationRulesQueryKey } from "@/lib/api/automations";
import {
  applyAutomationTemplate,
  archiveAutomationTemplate,
  automationTemplatesQueryKey,
  createAutomationTemplate,
  duplicateAutomationTemplate,
  exportAutomationTemplate,
  importAutomationTemplate,
  listAutomationTemplates,
  previewAutomationTemplate,
  restoreAutomationTemplate,
  validateAutomationTemplateVariables,
  getAutomationTemplate,
  updateAutomationTemplate,
  type AutomationTemplate,
  type AutomationTemplateCategory,
  type AutomationTemplateDefinition,
} from "@/lib/api/automation-templates";
import { listInstagramAccounts } from "@/lib/api/instagram";
import { canManageTeam, roleLabel } from "@/lib/auth/permissions";
import {
  categoryLabel,
  isOfficialApiAction,
  readableError,
  ruleTriggerLabel,
  ScopePill,
  TemplateDetailDialog,
  TemplateEditorDialog,
  TemplateUseDialog,
} from "./template-dialogs";

const categories: Array<{ value: AutomationTemplateCategory | ""; label: string }> = [
  { value: "", label: "All categories" },
  { value: "CUSTOMER_SUPPORT", label: "Customer support" },
  { value: "MODERATION", label: "Moderation" },
  { value: "LEAD_GENERATION", label: "Lead generation" },
  { value: "NOTIFICATIONS", label: "Notifications" },
];

type Notice = { tone: "success" | "error"; message: string };

export default function AutomationTemplatesClient() {
  const session = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const organizationId = session.membership.organization.id;
  const canManage = canManageTeam(session.membership.role);
  const importInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<AutomationTemplateCategory | "">("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [useTarget, setUseTarget] = useState<AutomationTemplate | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<AutomationTemplate | undefined>();
  const [archiveTarget, setArchiveTarget] = useState<AutomationTemplate | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const listKey = [...automationTemplatesQueryKey(organizationId), search, category, includeArchived] as const;
  const templatesQuery = useQuery({
    queryKey: listKey,
    queryFn: () => listAutomationTemplates(organizationId, { search, category, includeArchived }),
  });
  const templates = templatesQuery.data ?? [];
  const selectedTemplate = templates.find((template) => template.id === detailId) ?? null;
  const detailQuery = useQuery({
    queryKey: [...automationTemplatesQueryKey(organizationId), "detail", detailId],
    queryFn: () => getAutomationTemplate(organizationId, detailId!),
    enabled: Boolean(detailId),
  });
  const detail = detailQuery.data ?? selectedTemplate;
  const accountsQuery = useQuery({
    queryKey: ["instagram-accounts", organizationId],
    queryFn: () => listInstagramAccounts(organizationId),
    enabled: Boolean(useTarget),
  });
  const connectedAccounts = useMemo(
    () => (accountsQuery.data ?? []).filter((account) => account.status === "CONNECTED"),
    [accountsQuery.data],
  );
  const rulesQuery = useQuery({
    queryKey: automationRulesQueryKey(organizationId),
    queryFn: () => listAutomationRules(organizationId),
    enabled: canManage && editorOpen,
  });

  async function refreshTemplates() {
    await queryClient.invalidateQueries({ queryKey: automationTemplatesQueryKey(organizationId) });
  }

  const saveMutation = useMutation({
    mutationFn: ({ input, id }: { input: AutomationTemplateDefinition; id?: string }) => id
      ? updateAutomationTemplate(organizationId, id, input)
      : createAutomationTemplate(organizationId, input),
    onSuccess: async (template, variables) => {
      await refreshTemplates();
      setEditorOpen(false);
      setEditingTemplate(undefined);
      setDetailId(template.id);
      setNotice({ tone: "success", message: variables.id ? `Saved version ${template.version} of “${template.name}”.` : `Created “${template.name}”.` });
    },
    onError: (error) => setNotice({ tone: "error", message: readableError(error) }),
  });
  const duplicateMutation = useMutation({
    mutationFn: (template: AutomationTemplate) => duplicateAutomationTemplate(organizationId, template.id),
    onSuccess: async (copy) => {
      await refreshTemplates();
      setDetailId(copy.id);
      setNotice({ tone: "success", message: `Created organization copy “${copy.name}”.` });
    },
    onError: (error) => setNotice({ tone: "error", message: readableError(error) }),
  });
  const archiveMutation = useMutation({
    mutationFn: (template: AutomationTemplate) => archiveAutomationTemplate(organizationId, template.id),
    onSuccess: async (template) => {
      await refreshTemplates();
      setArchiveTarget(null);
      setDetailId(template.id);
      setNotice({ tone: "success", message: `Archived “${template.name}”.` });
    },
    onError: (error) => setNotice({ tone: "error", message: readableError(error) }),
  });
  const restoreMutation = useMutation({
    mutationFn: (template: AutomationTemplate) => restoreAutomationTemplate(organizationId, template.id),
    onSuccess: async (template) => {
      await refreshTemplates();
      setDetailId(template.id);
      setNotice({ tone: "success", message: `Restored “${template.name}”.` });
    },
    onError: (error) => setNotice({ tone: "error", message: readableError(error) }),
  });
  const importMutation = useMutation({
    mutationFn: (document: unknown) => importAutomationTemplate(organizationId, document),
    onSuccess: async (template) => {
      await refreshTemplates();
      setDetailId(template.id);
      setNotice({ tone: "success", message: `Imported “${template.name}”. Nothing was executed.` });
    },
    onError: (error) => setNotice({ tone: "error", message: readableError(error) }),
  });
  const exportMutation = useMutation({
    mutationFn: (template: AutomationTemplate) => exportAutomationTemplate(organizationId, template.id),
    onSuccess: (document, template) => {
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = documentElementAnchor(url, `${fileSlug(template.name)}.json`);
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", message: `Exported “${template.name}” as validated JSON.` });
    },
    onError: (error) => setNotice({ tone: "error", message: readableError(error) }),
  });
  const validateMutation = useMutation({
    mutationFn: (variables: Record<string, unknown>) => validateAutomationTemplateVariables(organizationId, useTarget!.id, variables),
  });
  const previewMutation = useMutation({
    mutationFn: (input: { instagramAccountId: string; variables: Record<string, unknown>; ruleName?: string }) => previewAutomationTemplate(organizationId, useTarget!.id, input),
  });
  const applyMutation = useMutation({
    mutationFn: (input: { instagramAccountId: string; variables: Record<string, unknown>; ruleName?: string }) => applyAutomationTemplate(organizationId, useTarget!.id, input),
    onSuccess: async (rule) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: automationRulesQueryKey(organizationId) }),
        queryClient.invalidateQueries({ queryKey: ["automation-executions", organizationId] }),
      ]);
      setUseTarget(null);
      router.push(`/automations?ruleId=${encodeURIComponent(rule.id)}`);
    },
  });

  async function importFile(file?: File) {
    if (!file) return;
    setNotice(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      await importMutation.mutateAsync(parsed);
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof SyntaxError ? "The selected file is not valid JSON." : readableError(error) });
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  }

  function openEditor(template?: AutomationTemplate) {
    setEditingTemplate(template);
    setEditorOpen(true);
    setDetailId(null);
  }

  const systemTemplates = templates.filter((template) => template.scope === "SYSTEM");
  const organizationTemplates = templates.filter((template) => template.scope === "ORGANIZATION");
  const anyPending = duplicateMutation.isPending || archiveMutation.isPending || restoreMutation.isPending || exportMutation.isPending || importMutation.isPending;

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">Automation library</p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">Automation templates</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Start from a supported workflow, fill in its variables, then review the paused rule before enabling it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 shadow-sm">{roleLabel(session.membership.role)} access</span>
          <Link href="/automations" className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"><Bot className="size-3.5" aria-hidden="true" /> Automation rules</Link>
          {canManage && <>
            <button type="button" onClick={() => openEditor()} className="inline-flex h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"><Plus className="size-3.5" aria-hidden="true" /> Create template</button>
            <button type="button" onClick={() => openEditor()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700"><WandSparkles className="size-3.5" aria-hidden="true" /> From a rule</button>
          </>}
        </div>
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-6 py-6 text-white shadow-xl shadow-indigo-950/10 sm:px-8">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="relative flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="max-w-2xl"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100"><Sparkles className="size-3.5" aria-hidden="true" /> Reusable building blocks</div><h2 className="text-2xl font-semibold tracking-tight">Structured templates, ready for review.</h2><p className="mt-2 max-w-xl text-xs leading-5 text-slate-300">Templates only produce a rule definition. Applying one never starts it. Message and comment actions depend on the connected provider and its official API permissions.</p></div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => importInput.current?.click()} disabled={!canManage || importMutation.isPending} title={!canManage ? "Only Owners and Admins can import templates" : undefined} className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/15 bg-white/[0.07] px-3.5 text-xs font-semibold text-white hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-45"><FileUp className="size-3.5" aria-hidden="true" /> Import JSON</button><input ref={importInput} type="file" accept=".json,application/json" aria-label="Import automation template JSON" className="hidden" onChange={(event) => void importFile(event.target.files?.[0])} /><span className="inline-flex h-10 items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[10px] text-slate-300">Import stores data only · no code runs</span></div>
        </div>
      </section>

      {notice && <div role={notice.tone === "error" ? "alert" : "status"} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-medium ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}><span className="flex items-center gap-2">{notice.tone === "success" ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <CircleAlert className="size-4" aria-hidden="true" />}{notice.message}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)} className="rounded-md p-1 hover:bg-white/70"><X className="size-3.5" aria-hidden="true" /></button></div>}
      {!canManage && <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-800">You can browse templates and preview them for accounts you can access. An Owner or Admin manages organization templates and applies rules.</div>}

      <section aria-label="Template filters" className="grid gap-3 rounded-[20px] border border-slate-200/80 bg-white p-4 shadow-sm sm:grid-cols-[minmax(220px,1fr)_220px_auto] sm:items-end">
        <label className="block space-y-1.5 text-xs font-medium text-slate-600">Search templates<span className="relative block"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" /><input aria-label="Search templates" className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100" placeholder="Name or description" value={search} onChange={(event) => setSearch(event.target.value)} /></span></label>
        <label className="block space-y-1.5 text-xs font-medium text-slate-600">Category<select aria-label="Filter templates by category" value={category} onChange={(event) => setCategory(event.target.value as AutomationTemplateCategory | "")} className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100">{categories.map((item) => <option value={item.value} key={item.value || "all"}>{item.label}</option>)}</select></label>
        <label className="flex h-10 items-center gap-2 rounded-xl px-1 text-xs font-medium text-slate-600"><input aria-label="Include archived templates" type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Include archived</label>
      </section>

      {templatesQuery.isLoading ? <LoadingState label="Loading automation templates" /> : templatesQuery.error ? <InlineError message={readableError(templatesQuery.error)} retry={() => void templatesQuery.refetch()} /> : (
        <div className="space-y-8">
          <TemplateSection title="SYSTEM templates" subtitle="Built-in templates maintained by the platform. They are read-only; duplicate one to customize it." templates={systemTemplates} canManage={canManage} busy={anyPending} onDetail={(template) => setDetailId(template.id)} onUse={setUseTarget} onDuplicate={(template) => duplicateMutation.mutate(template)} onExport={(template) => exportMutation.mutate(template)} onRestore={(template) => restoreMutation.mutate(template)} onArchive={(template) => setArchiveTarget(template)} />
          <TemplateSection title="Organization templates" subtitle="Templates saved in this workspace, with a version history." templates={organizationTemplates} canManage={canManage} busy={anyPending} onDetail={(template) => setDetailId(template.id)} onUse={setUseTarget} onDuplicate={(template) => duplicateMutation.mutate(template)} onExport={(template) => exportMutation.mutate(template)} onRestore={(template) => restoreMutation.mutate(template)} onArchive={(template) => setArchiveTarget(template)} onEdit={(template) => openEditor(template)} emptyAction={canManage ? <button type="button" onClick={() => openEditor()} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700"><Plus className="size-3.5" aria-hidden="true" /> Create a template</button> : undefined} />
        </div>
      )}

      {detail && <TemplateDetailDialog template={detailQuery.data ?? detail} canManage={canManage} onClose={() => setDetailId(null)} onUse={() => { setUseTarget(detail); setDetailId(null); }} onEdit={() => openEditor(detail)} onDuplicate={() => duplicateMutation.mutate(detail)} onArchive={() => setArchiveTarget(detail)} onRestore={() => restoreMutation.mutate(detail)} />}
      {detailId && detailQuery.error && <InlineError message={readableError(detailQuery.error)} retry={() => void detailQuery.refetch()} />}
      {useTarget && <TemplateUseDialog key={useTarget.id} template={useTarget} canApply={canManage} accounts={connectedAccounts} accountsLoading={accountsQuery.isLoading} accountsError={accountsQuery.error ? readableError(accountsQuery.error) : undefined} onClose={() => setUseTarget(null)} onValidate={(variables) => validateMutation.mutateAsync(variables)} onPreview={(input) => previewMutation.mutateAsync(input)} onApply={async (input) => { await applyMutation.mutateAsync(input); }} />}
      {editorOpen && <TemplateEditorDialog key={editingTemplate?.id ?? "new-template"} template={editingTemplate} rules={rulesQuery.data ?? []} onClose={() => { setEditorOpen(false); setEditingTemplate(undefined); }} onSave={async (input, id) => { await saveMutation.mutateAsync({ input, id }); }} />}
      {archiveTarget && <ArchiveConfirmation template={archiveTarget} pending={archiveMutation.isPending} onCancel={() => setArchiveTarget(null)} onConfirm={() => archiveMutation.mutate(archiveTarget)} />}
    </div>
  );
}

function TemplateSection({
  title, subtitle, templates, canManage, busy, onDetail, onUse, onDuplicate, onExport, onRestore, onArchive, onEdit, emptyAction,
}: {
  title: string;
  subtitle: string;
  templates: AutomationTemplate[];
  canManage: boolean;
  busy: boolean;
  onDetail: (template: AutomationTemplate) => void;
  onUse: (template: AutomationTemplate) => void;
  onDuplicate: (template: AutomationTemplate) => void;
  onExport: (template: AutomationTemplate) => void;
  onRestore: (template: AutomationTemplate) => void;
  onArchive: (template: AutomationTemplate) => void;
  onEdit?: (template: AutomationTemplate) => void;
  emptyAction?: React.ReactNode;
}) {
  return <section aria-labelledby={`heading-${title.replaceAll(" ", "-")}`}>
    <div className="mb-4 flex items-end justify-between gap-3"><div><h2 id={`heading-${title.replaceAll(" ", "-")}`} className="text-base font-semibold tracking-tight text-slate-950">{title}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{subtitle}</p></div><span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500">{templates.length} {templates.length === 1 ? "template" : "templates"}</span></div>
    {templates.length ? <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{templates.map((template) => <TemplateCard key={template.id} template={template} canManage={canManage} busy={busy} onDetail={() => onDetail(template)} onUse={() => onUse(template)} onDuplicate={() => onDuplicate(template)} onExport={() => onExport(template)} onRestore={() => onRestore(template)} onArchive={() => onArchive(template)} onEdit={() => onEdit?.(template)} />)}</div> : <div className="rounded-[20px] border border-dashed border-slate-300 bg-white px-5 py-9 text-center"><span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Bot className="size-5" aria-hidden="true" /></span><p className="mt-3 text-sm font-semibold text-slate-800">No templates match these filters</p><p className="mt-1 text-xs text-slate-500">Try another category or search term.</p>{emptyAction}</div>}
  </section>;
}

function TemplateCard({ template, canManage, busy, onDetail, onUse, onDuplicate, onExport, onRestore, onArchive, onEdit }: {
  template: AutomationTemplate; canManage: boolean; busy: boolean; onDetail: () => void; onUse: () => void; onDuplicate: () => void; onExport: () => void; onRestore: () => void; onArchive: () => void; onEdit: () => void;
}) {
  const actionsSummary = template.actions.map((action) => action.type === "REGISTER_EVENT" ? "Register event" : action.type === "REPLY_COMMENT" ? "Reply to comment" : action.type === "SEND_MESSAGE" ? "Send message" : action.type === "TAG_CONTACT" ? "Tag contact" : "Notify operator");
  const compatible = template.schemaVersion === 1;
  const archived = Boolean(template.archivedAt);
  return <article aria-label={`Template ${template.name}`} className="flex min-h-[250px] flex-col rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-200 hover:shadow-md">
    <div className="flex items-start justify-between gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600"><Sparkles className="size-5" aria-hidden="true" /></span><div className="flex flex-wrap justify-end gap-1.5"><ScopePill scope={template.scope} /><span className={`rounded-full px-2 py-1 text-[9px] font-semibold ${compatible ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{compatible ? `v${template.schemaVersion} compatible` : `v${template.schemaVersion} unsupported`}</span></div></div>
    <button type="button" onClick={onDetail} className="mt-4 text-left"><span className="block text-sm font-semibold text-slate-900">{template.name}</span><span className="mt-1 block line-clamp-2 min-h-10 text-xs leading-5 text-slate-500">{template.description || "No description provided."}</span></button>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]"><span className="rounded-full bg-indigo-50 px-2.5 py-1 font-semibold text-indigo-700">{categoryLabel(template.category)}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600">{ruleTriggerLabel(template.triggerType)}</span><span className="text-slate-400">Template v{template.version}</span>{archived && <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-800">Archived</span>}</div>
    <div className="mt-3 flex flex-wrap gap-1.5">{actionsSummary.map((action, index) => <span key={`${action}-${index}`} className="rounded-md border border-slate-200 px-2 py-1 text-[9px] font-medium text-slate-500">{action}{template.actions[index] && isOfficialApiAction(template.actions[index]) ? " · API dependent" : ""}</span>)}</div>
    {template.variables.length > 0 && <p className="mt-3 text-[10px] text-slate-400">{template.variables.length} variable{template.variables.length === 1 ? "" : "s"} to configure</p>}
    <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
      {!archived && template.active && compatible && <button type="button" onClick={onUse} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[11px] font-semibold text-white hover:bg-indigo-700">Use template <ArrowRight className="size-3.5" aria-hidden="true" /></button>}
      <button type="button" onClick={onDetail} className="h-9 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">Details</button>
      <div className="ml-auto flex items-center gap-1">
        {canManage && <button type="button" onClick={onDuplicate} disabled={busy} aria-label={`Duplicate template ${template.name}`} title="Duplicate into organization" className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"><Copy className="size-3.5" aria-hidden="true" /></button>}
        <button type="button" onClick={onExport} disabled={busy} aria-label={`Export template ${template.name}`} title="Export JSON" className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"><Download className="size-3.5" aria-hidden="true" /></button>
        {canManage && template.scope === "ORGANIZATION" && !archived && <>
          <button type="button" onClick={onEdit} aria-label={`Edit template ${template.name}`} title="Edit" className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-500 transition hover:bg-slate-50">Edit</button>
          <button type="button" onClick={onArchive} disabled={busy} aria-label={`Archive template ${template.name}`} title="Archive" className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"><Archive className="size-3.5" aria-hidden="true" /></button>
        </>}
        {canManage && template.scope === "ORGANIZATION" && archived && <button type="button" onClick={onRestore} disabled={busy} aria-label={`Restore template ${template.name}`} className="inline-flex h-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[10px] font-semibold text-emerald-700 disabled:opacity-50">Restore</button>}
      </div>
    </div>
  </article>;
}

function ArchiveConfirmation({ template, pending, onCancel, onConfirm }: { template: AutomationTemplate; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 p-4"><section role="alertdialog" aria-modal="true" aria-label="Archive automation template?" className="w-full max-w-md rounded-[22px] bg-white p-6 shadow-2xl"><div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><Archive className="size-5" aria-hidden="true" /></div><h2 className="mt-4 text-lg font-semibold text-slate-950">Archive this template?</h2><p className="mt-2 text-sm leading-6 text-slate-500">“{template.name}” will no longer appear in the default gallery. You can restore it later. Existing rules will not change.</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} className="button-secondary">Keep template</button><button type="button" onClick={onConfirm} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{pending ? <LoaderCircle className="size-4 animate-spin" /> : null}Archive template</button></div></section></div>;
}

function documentElementAnchor(url: string, filename: string): HTMLAnchorElement {
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  return anchor;
}

function fileSlug(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "automation-template";
}
