"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Bot,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Copy,
  LoaderCircle,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSession } from "@/components/session-context";
import { InlineError, LoadingState } from "@/components/ui/states";
import { listInstagramAccounts } from "@/lib/api/instagram";
import type { InstagramAccount } from "@/lib/api/types";
import {
  automationExecutionsQueryKey,
  automationRulesQueryKey,
  createAutomationRule,
  deleteAutomationRule,
  listAutomationExecutions,
  listAutomationRules,
  simulateAutomationRule,
  updateAutomationRule,
  type AutomationAction,
  type AutomationExecution,
  type AutomationExecutionStatus,
  type AutomationRule,
  type AutomationRuleInput,
  type AutomationTrigger,
  type SimulateAutomationInput,
} from "@/lib/api/automations";
import { canManageTeam, roleLabel } from "@/lib/auth/permissions";
import { AutomationRuleEditor } from "./automation-rule-editor";

const triggerLabels: Record<AutomationTrigger, string> = {
  COMMENT_RECEIVED: "Comment received",
  MESSAGE_RECEIVED: "Message received",
  WEBHOOK_EVENT_RECEIVED: "Webhook event received",
};

export default function AutomationsClient() {
  const session = useSession();
  const organizationId = session.membership.organization.id;
  const canManage = canManageTeam(session.membership.role);
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | undefined>();
  const [testRule, setTestRule] = useState<AutomationRule | null>(null);
  const [testEventId, setTestEventId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const accountsQuery = useQuery({
    queryKey: ["instagram-accounts", organizationId],
    queryFn: () => listInstagramAccounts(organizationId),
  });
  const accounts = useMemo(
    () =>
      (accountsQuery.data ?? []).filter(
        (account) => account.status === "CONNECTED",
      ),
    [accountsQuery.data],
  );
  const rulesQuery = useQuery({
    queryKey: automationRulesQueryKey(organizationId),
    queryFn: () => listAutomationRules(organizationId),
  });
  const executionsQuery = useQuery({
    queryKey: automationExecutionsQueryKey(organizationId),
    queryFn: () => listAutomationExecutions(organizationId),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (execution) => execution.status === "PROCESSING",
      )
        ? 2_000
        : 8_000,
    refetchIntervalInBackground: false,
  });

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: automationRulesQueryKey(organizationId),
      }),
      queryClient.invalidateQueries({
        queryKey: automationExecutionsQueryKey(organizationId),
      }),
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AutomationRuleInput }) =>
      id
        ? updateAutomationRule(organizationId, id, input)
        : createAutomationRule(organizationId, input),
    onSuccess: async (_, variables) => {
      await refreshData();
      setEditorOpen(false);
      setEditingRule(undefined);
      setFeedback(
        variables.id ? "Rule changes saved." : "Automation rule created.",
      );
    },
  });
  const toggleMutation = useMutation({
    mutationFn: (rule: AutomationRule) =>
      updateAutomationRule(organizationId, rule.id, { active: !rule.active }),
    onSuccess: async (rule) => {
      await refreshData();
      setFeedback(rule.active ? "Rule activated." : "Rule paused.");
    },
  });
  const duplicateMutation = useMutation({
    mutationFn: (rule: AutomationRule) =>
      createAutomationRule(organizationId, {
        instagramAccountId: rule.instagramAccountId,
        name: `${rule.name.slice(0, 113).trim()} copy`,
        active: false,
        triggerType: rule.triggerType,
        conditions: rule.conditions,
        actions: rule.actions,
      }),
    onSuccess: async () => {
      await refreshData();
      setFeedback("Rule duplicated as a paused copy.");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (rule: AutomationRule) =>
      deleteAutomationRule(organizationId, rule.id),
    onSuccess: async () => {
      await refreshData();
      setDeleteTarget(null);
      setFeedback("Rule deleted.");
    },
  });
  const testMutation = useMutation({
    mutationFn: ({
      ruleId,
      input,
    }: {
      ruleId: string;
      input: SimulateAutomationInput;
    }) => simulateAutomationRule(organizationId, ruleId, input),
    onSuccess: async (result) => {
      setTestEventId(result.eventId);
      setFeedback(
        "Test event queued. The execution history will update shortly.",
      );
      await queryClient.invalidateQueries({
        queryKey: automationExecutionsQueryKey(organizationId),
      });
    },
  });

  function openCreate() {
    setEditingRule(undefined);
    setEditorOpen(true);
  }

  function openEdit(rule: AutomationRule) {
    setEditingRule(rule);
    setEditorOpen(true);
  }

  function openTest(rule: AutomationRule) {
    setTestRule(rule);
    setTestEventId(null);
    testMutation.reset();
  }

  async function saveRule(input: AutomationRuleInput, id?: string) {
    await saveMutation.mutateAsync({ input, id });
  }

  async function runTest(input: SimulateAutomationInput) {
    if (!testRule) return;
    await testMutation.mutateAsync({ ruleId: testRule.id, input });
  }

  const executionForTest = testEventId
    ? executionsQuery.data?.items.find(
        (execution) => execution.webhookEventId === testEventId,
      )
    : undefined;
  const dataError = rulesQuery.error ?? accountsQuery.error;

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            Workflow tools
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Automations
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Build simple trigger, condition, and action rules for your Instagram
            accounts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 shadow-sm">
            <ShieldCheck
              className="size-3.5 text-indigo-600"
              aria-hidden="true"
            />
            {roleLabel(session.membership.role)} access
          </span>
          {canManage && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
            >
              <Plus className="size-3.5" aria-hidden="true" /> Create rule
            </button>
          )}
        </div>
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-6 py-7 text-white shadow-xl shadow-indigo-950/10 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute right-14 top-8 size-28 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100">
              <Bot className="size-3.5" aria-hidden="true" /> Rule engine
            </div>
            <h2 className="max-w-lg text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[30px]">
              Respond to the right events, consistently.
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-slate-300">
              Rules run in order with a maximum of one reply or message action
              per event. MOCK accounts can be tested here without external
              credentials.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 backdrop-blur-sm lg:min-w-[190px]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
              <Activity className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">
                Rules in workspace
              </span>
              <span className="mt-1 block text-sm font-semibold text-white">
                {rulesQuery.data?.length ?? "—"} total
              </span>
            </span>
          </div>
        </div>
      </section>

      {feedback && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800"
        >
          <span className="flex items-center gap-2">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {feedback}
          </span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setFeedback(null)}
            className="rounded-md p-1 hover:bg-emerald-100"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {!canManage && (
        <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-800">
          You can view rules and execution history. An Owner or Admin can make
          changes.
        </div>
      )}
      {accountsQuery.isLoading && (
        <LoadingState label="Loading Instagram accounts" />
      )}
      {dataError && !accountsQuery.isLoading && !rulesQuery.isLoading && (
        <InlineError
          message={dataError.message}
          retry={() => void refreshData()}
        />
      )}

      {editorOpen && !accountsQuery.isLoading && !accountsQuery.isError && (
        <AutomationRuleEditor
          key={editingRule?.id ?? "new"}
          accounts={accounts}
          initialRule={editingRule}
          saving={saveMutation.isPending}
          onCancel={() => {
            setEditorOpen(false);
            setEditingRule(undefined);
          }}
          onSave={saveRule}
        />
      )}

      {!rulesQuery.isLoading && !rulesQuery.isError && (
        <section
          aria-labelledby="rules-heading"
          className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm"
        >
          <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <div>
              <h2
                id="rules-heading"
                className="text-sm font-semibold text-slate-900"
              >
                Your rules
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {rulesQuery.data?.length
                  ? `${rulesQuery.data.length} automation${rulesQuery.data.length === 1 ? "" : "s"} for this organization`
                  : "Rules are visible only inside this workspace."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void rulesQuery.refetch()}
              aria-label="Refresh automation rules"
              className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 sm:self-auto"
            >
              <RefreshCw
                className={`size-3.5 ${rulesQuery.isFetching ? "animate-spin" : ""}`}
                aria-hidden="true"
              />{" "}
              Refresh
            </button>
          </div>
          {rulesQuery.isLoading ? (
            <LoadingState label="Loading automation rules" />
          ) : rulesQuery.data?.length ? (
            <div className="divide-y divide-slate-100">
              {rulesQuery.data.map((rule) => {
                const account = accounts.find(
                  (item) => item.id === rule.instagramAccountId,
                );
                return (
                  <AutomationRuleCard
                    key={rule.id}
                    rule={rule}
                    account={account}
                    canManage={canManage}
                    busy={
                      toggleMutation.isPending ||
                      duplicateMutation.isPending ||
                      deleteMutation.isPending
                    }
                    onEdit={() => openEdit(rule)}
                    onTest={() => openTest(rule)}
                    onToggle={() => toggleMutation.mutate(rule)}
                    onDuplicate={() => duplicateMutation.mutate(rule)}
                    onDelete={() => setDeleteTarget(rule)}
                  />
                );
              })}
            </div>
          ) : (
            <div className="px-5 py-12 text-center sm:px-8">
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <Bot className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">
                No automation rules yet
              </h3>
              <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
                Create a rule to decide what should happen when a comment,
                message, or webhook event arrives.
              </p>
              {!accounts.length ? (
                <a
                  href="/instagram/accounts"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Connect an Instagram account{" "}
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </a>
              ) : (
                canManage && (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2.5 text-xs font-semibold text-white hover:bg-indigo-700"
                  >
                    <Plus className="size-3.5" aria-hidden="true" /> Create your
                    first rule
                  </button>
                )
              )}
            </div>
          )}
        </section>
      )}

      <ExecutionHistory
        executions={executionsQuery.data?.items ?? []}
        loading={executionsQuery.isLoading}
        error={executionsQuery.error?.message}
        onRetry={() => void executionsQuery.refetch()}
        expandedRun={expandedRun}
        onToggle={(id) =>
          setExpandedRun((current) => (current === id ? null : id))
        }
      />

      {testRule && (
        <TestRuleDialog
          key={testRule.id}
          rule={testRule}
          account={accounts.find(
            (account) => account.id === testRule.instagramAccountId,
          )}
          eventId={testEventId}
          execution={executionForTest}
          loading={testMutation.isPending}
          error={testMutation.error?.message}
          onRun={runTest}
          onClose={() => {
            setTestRule(null);
            setTestEventId(null);
            testMutation.reset();
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmDeleteDialog
          rule={deleteTarget}
          deleting={deleteMutation.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget)}
        />
      )}
    </div>
  );
}

function AutomationRuleCard({
  rule,
  account,
  canManage,
  busy,
  onEdit,
  onTest,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  rule: AutomationRule;
  account?: InstagramAccount;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onTest: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <article className="flex flex-col gap-4 px-5 py-5 transition hover:bg-slate-50/40 sm:px-6 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span
          className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl ${rule.active ? "bg-indigo-50 text-indigo-600" : "bg-slate-100 text-slate-500"}`}
        >
          <Bot className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              {rule.name}
            </h3>
            <span
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${rule.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
            >
              {rule.active ? "Active" : "Paused"}
            </span>
            {account?.provider === "MOCK" && (
              <span className="rounded-md border border-violet-100 bg-violet-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-violet-700">
                MOCK
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {triggerLabels[rule.triggerType]}{" "}
            <span className="px-1 text-slate-300">·</span>{" "}
            {account?.username
              ? `@${account.username}`
              : (account?.name ?? "Instagram account")}
          </p>
          <p className="mt-1.5 line-clamp-2 text-[11px] leading-5 text-slate-400">
            {describeRule(rule)}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        <button
          type="button"
          onClick={onTest}
          disabled={
            !canManage ||
            !rule.active ||
            !account ||
            account.provider !== "MOCK"
          }
          title={
            !canManage
              ? "Only Owners and Admins can run tests"
              : !rule.active
                ? "Activate this rule before testing"
                : account?.provider === "MOCK"
                  ? "Test with a local event"
                  : "Testing is available for MOCK accounts"
          }
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
        >
          <Play className="size-3.5" aria-hidden="true" /> Test rule
        </button>
        {canManage && (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              disabled={busy}
              aria-label={`Duplicate ${rule.name}`}
              title="Duplicate"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onToggle}
              disabled={busy}
              role="switch"
              aria-checked={rule.active}
              aria-label={`${rule.active ? "Pause" : "Activate"} ${rule.name}`}
              title={rule.active ? "Pause rule" : "Activate rule"}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${rule.active ? "bg-indigo-600" : "bg-slate-300"}`}
            >
              <span
                className={`inline-block size-4 rounded-full bg-white shadow-sm transition ${rule.active ? "translate-x-6" : "translate-x-1"}`}
              />
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label={`Delete ${rule.name}`}
              title="Delete"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function describeRule(rule: AutomationRule) {
  const conditions = rule.conditions.rules.length
    ? rule.conditions.rules
        .map(
          (condition) =>
            `${condition.field} ${condition.operator.toLowerCase().replace("_", " ")} “${condition.value}”`,
        )
        .join(rule.conditions.match === "ALL" ? " and " : " or ")
    : "Any event";
  const actions = rule.actions.map((action) => actionLabel(action)).join(" · ");
  return `If ${conditions} → ${actions}`;
}

function actionLabel(action: AutomationAction) {
  switch (action.type) {
    case "REGISTER_EVENT":
      return "Register event";
    case "REPLY_COMMENT":
      return "Reply to comment";
    case "SEND_MESSAGE":
      return "Send message";
    case "TAG_CONTACT":
      return `Tag ${action.tag}`;
    case "NOTIFY_OPERATOR":
      return "Notify operator";
  }
}

function ExecutionHistory({
  executions,
  loading,
  error,
  onRetry,
  expandedRun,
  onToggle,
}: {
  executions: AutomationExecution[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  expandedRun: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <section
      aria-labelledby="execution-history-title"
      className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm"
    >
      <div className="flex flex-col justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        <div>
          <h2
            id="execution-history-title"
            className="text-sm font-semibold text-slate-900"
          >
            Execution history
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Latest runs across rules in this organization.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
          <RefreshCw className="size-3" aria-hidden="true" /> Refreshes
          automatically
        </span>
      </div>
      {loading ? (
        <LoadingState label="Loading execution history" />
      ) : error ? (
        <div className="p-5">
          <InlineError message={error} retry={onRetry} />
        </div>
      ) : executions.length === 0 ? (
        <div className="px-5 py-9 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
            <Clock3 className="size-4" aria-hidden="true" />
          </span>
          <p className="mt-3 text-xs font-semibold text-slate-700">
            No executions yet
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Run a MOCK test or wait for an Instagram event.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {executions.map((execution) => (
            <ExecutionRow
              key={execution.id}
              execution={execution}
              expanded={expandedRun === execution.id}
              onToggle={() => onToggle(execution.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ExecutionRow({
  execution,
  expanded,
  onToggle,
}: {
  execution: AutomationExecution;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="px-5 py-4 sm:px-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <ExecutionStatus status={execution.status} />
          <div className="min-w-0">
            <h3 className="truncate text-xs font-semibold text-slate-800">
              {execution.automationRule.name}
            </h3>
            <p className="mt-1 text-[10px] text-slate-400">
              {formatDate(execution.createdAt)} ·{" "}
              {execution.actionExecutions.length} action
              {execution.actionExecutions.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="inline-flex h-8 items-center gap-1.5 self-start rounded-lg px-2.5 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-50 sm:self-auto"
        >
          {expanded ? "Hide details" : "View details"}{" "}
          <MoreHorizontal className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      {expanded && (
        <div className="mt-4 rounded-xl bg-slate-50 px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
            <span>Event {execution.webhookEventId.slice(0, 8)}…</span>
            <span>
              {execution.finishedAt
                ? `Finished ${formatDate(execution.finishedAt)}`
                : "In progress"}
            </span>
          </div>
          {execution.errorCode && (
            <p className="mt-2 text-[11px] font-medium text-rose-700">
              {execution.errorCode.replaceAll("_", " ").toLowerCase()}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {execution.actionExecutions.map((action) => (
              <li
                key={action.id}
                className="flex items-center justify-between gap-3 text-[11px]"
              >
                <span className="text-slate-600">
                  {actionLabelFromType(action.actionType)}
                </span>
                <span className="flex items-center gap-1.5">
                  <ActionStatusIcon status={action.status} />
                  <span className="font-semibold text-slate-600">
                    {action.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function ExecutionStatus({ status }: { status: AutomationExecutionStatus }) {
  const styles: Record<AutomationExecutionStatus, string> = {
    PROCESSING: "bg-amber-50 text-amber-700",
    SUCCESS: "bg-emerald-50 text-emerald-700",
    FAILED: "bg-rose-50 text-rose-700",
    SKIPPED: "bg-slate-100 text-slate-600",
  };
  return (
    <span
      data-testid="execution-status"
      className={`inline-flex min-w-[96px] items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${styles[status]}`}
    >
      <ActionStatusIcon status={status} />
      {status}
    </span>
  );
}

function ActionStatusIcon({ status }: { status: AutomationExecutionStatus }) {
  if (status === "SUCCESS")
    return <CheckCircle2 className="size-3" aria-hidden="true" />;
  if (status === "FAILED")
    return <XCircle className="size-3" aria-hidden="true" />;
  if (status === "SKIPPED")
    return <CircleAlert className="size-3" aria-hidden="true" />;
  return <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />;
}

function actionLabelFromType(type: string) {
  return actionOptionsForHistory[type] ?? type;
}

const actionOptionsForHistory: Record<string, string> = {
  REGISTER_EVENT: "Register event",
  SEND_MESSAGE: "Send a message",
  REPLY_COMMENT: "Reply to comment",
  TAG_CONTACT: "Tag contact",
  NOTIFY_OPERATOR: "Notify operator",
};

function TestRuleDialog({
  rule,
  account,
  eventId,
  execution,
  loading,
  error,
  onRun,
  onClose,
}: {
  rule: AutomationRule;
  account?: InstagramAccount;
  eventId: string | null;
  execution?: AutomationExecution;
  loading: boolean;
  error?: string;
  onRun: (input: SimulateAutomationInput) => Promise<void>;
  onClose: () => void;
}) {
  const [eventType, setEventType] = useState<
    "instagram.change" | "instagram.messaging"
  >(
    rule.triggerType === "MESSAGE_RECEIVED"
      ? "instagram.messaging"
      : "instagram.change",
  );
  const keyword =
    rule.conditions.rules.find(
      (condition) =>
        condition.field === "text" && condition.operator === "CONTAINS",
    )?.value ?? "";
  const [text, setText] = useState(
    `Test event${keyword ? `: ${keyword}` : ""}`,
  );
  const [commentId, setCommentId] = useState("mock-comment-test");
  const [commentIdEdited, setCommentIdEdited] = useState(false);
  const [senderId, setSenderId] = useState("mock-contact-test");
  const [formError, setFormError] = useState<string | null>(null);
  const accountLabel = account?.username
    ? `@${account.username}`
    : (account?.name ?? "Instagram account");
  const requiresMessage = rule.triggerType === "MESSAGE_RECEIVED";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account || account.provider !== "MOCK") {
      setFormError("Connect a MOCK Instagram account to test this rule.");
      return;
    }
    if (
      rule.triggerType === "COMMENT_RECEIVED" &&
      eventType !== "instagram.change"
    ) {
      setFormError("A comment rule needs a comment event.");
      return;
    }
    if (
      rule.triggerType === "MESSAGE_RECEIVED" &&
      eventType !== "instagram.messaging"
    ) {
      setFormError("A message rule needs a message event.");
      return;
    }
    setFormError(null);
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const submittedCommentId = commentIdEdited
      ? commentId
      : `mock-comment-${suffix}`;
    if (!commentIdEdited) setCommentId(submittedCommentId);
    const data: Record<string, string> = {
      senderId,
      ...(text ? { text } : {}),
    };
    if (eventType === "instagram.change")
      data.commentId = submittedCommentId;
    else data.messageId = `mock-message-${suffix}`;
    try {
      await onRun({
        eventType,
        externalEventId: `ui-test-${suffix}`,
        ...(eventType === "instagram.change" ? { field: "comments" } : {}),
        eventTimestamp: Date.now(),
        data,
      });
    } catch {
      setFormError("The test event could not be queued. Try again.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="test-rule-title"
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-2xl sm:rounded-[24px] sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-indigo-600">
              MOCK test · {accountLabel}
            </p>
            <h2
              id="test-rule-title"
              className="mt-1 text-xl font-semibold tracking-tight text-slate-950"
            >
              Test rule
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Send a local event through the same rule queue and review its
              execution.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close test dialog"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {rule.triggerType === "WEBHOOK_EVENT_RECEIVED" && (
            <label className="block space-y-1.5 text-xs font-medium text-slate-600">
              Event sample
              <select
                aria-label="Test event type"
                value={eventType}
                onChange={(event) =>
                  setEventType(event.target.value as typeof eventType)
                }
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              >
                <option value="instagram.change">Comment event</option>
                <option value="instagram.messaging">Message event</option>
              </select>
            </label>
          )}
          <label className="block space-y-1.5 text-xs font-medium text-slate-600">
            {eventType === "instagram.change" ? "Comment text" : "Message text"}
            <textarea
              aria-label="Test event text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={5000}
              className="min-h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              placeholder="Enter sample event text"
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {eventType === "instagram.change" && (
              <label className="block space-y-1.5 text-xs font-medium text-slate-600">
                Comment ID
                <input
                  aria-label="Test comment ID"
                  value={commentId}
                  onChange={(event) => {
                    setCommentId(event.target.value);
                    setCommentIdEdited(true);
                  }}
                  maxLength={255}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                />
              </label>
            )}
            <label className="block space-y-1.5 text-xs font-medium text-slate-600">
              Sender ID
              <input
                aria-label="Test sender ID"
                value={senderId}
                onChange={(event) => setSenderId(event.target.value)}
                maxLength={255}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              />
            </label>
          </div>
          {requiresMessage && (
            <p className="rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-3 text-[11px] leading-5 text-blue-800">
              The simulated message timestamp is current so the MOCK response
              window can be exercised safely.
            </p>
          )}
          {formError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700"
            >
              {formError}
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700"
            >
              {error}
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <LoaderCircle
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />{" "}
                  Queueing test…
                </>
              ) : (
                <>
                  <Play className="size-3.5" aria-hidden="true" /> Run test
                </>
              )}
            </button>
          </div>
        </form>
        {eventId && (
          <div
            className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4"
            aria-live="polite"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-slate-800">
                Test execution
              </p>
              {execution ? (
                <ExecutionStatus status={execution.status} />
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                  <LoaderCircle
                    className="size-3 animate-spin"
                    aria-hidden="true"
                  />
                  PROCESSING
                </span>
              )}
            </div>
            {execution ? (
              <>
                <p className="mt-2 text-[11px] text-slate-500">
                  {execution.actionExecutions.length} action
                  {execution.actionExecutions.length === 1 ? "" : "s"} recorded.
                  Event {eventId.slice(0, 8)}…
                </p>
                {execution.errorCode && (
                  <p className="mt-2 text-[11px] font-medium text-rose-700">
                    {execution.errorCode.replaceAll("_", " ").toLowerCase()}
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-[11px] text-slate-500">
                Waiting for the automation worker…
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ConfirmDeleteDialog({
  rule,
  deleting,
  onCancel,
  onConfirm,
}: {
  rule: AutomationRule;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-rule-title"
        className="w-full max-w-md rounded-t-[24px] bg-white p-6 shadow-2xl sm:rounded-[24px]"
      >
        <span className="flex size-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
          <Trash2 className="size-5" aria-hidden="true" />
        </span>
        <h2
          id="delete-rule-title"
          className="mt-4 text-lg font-semibold text-slate-950"
        >
          Delete automation rule?
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          <span className="font-medium text-slate-700">{rule.name}</span> will
          be deactivated and removed from the rules list. Existing execution
          history remains available.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Keep rule
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete rule"}
          </button>
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
