"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  CircleAlert,
  FolderKanban,
  Heart,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-context";
import { InlineError, LoadingState } from "@/components/ui/states";
import { ApiClientError } from "@/lib/api/client";
import {
  bulkMoveInstagramAccounts,
  bulkSyncInstagramAccounts,
  bulkTagInstagramAccounts,
  completeInstagramOAuth,
  createInstagramAccountGroup,
  deleteInstagramAccountGroup,
  disconnectInstagramAccount,
  getInstagramAccountSummary,
  instagramAccountManagementQueryKey,
  instagramAccountsQueryKey,
  listInstagramAccounts,
  listInstagramAccountGroups,
  listInstagramAccountPreferences,
  listManagedInstagramAccounts,
  moveInstagramAccount,
  orderInstagramAccountGroups,
  setDefaultInstagramAccount,
  setInstagramAccountFavorite,
  startInstagramConnection,
  syncInstagramAccount,
  updateInstagramAccountGroup,
  updateInstagramAccountMetadata,
} from "@/lib/api/instagram";
import type {
  InstagramAccount,
  InstagramAccountBatchItem,
  InstagramAccountGroup,
  InstagramAccountsPage,
  InstagramAccountStatus,
  InstagramConnectStart,
} from "@/lib/api/types";
import { canManageTeam } from "@/lib/auth/permissions";

type Notice = { tone: "success" | "error"; message: string };
type GroupForm = {
  mode: "create" | "edit";
  group?: InstagramAccountGroup;
  name: string;
  description: string;
};
type AccountForm = {
  account: InstagramAccount;
  alias: string;
  tags: string;
};
type BatchView = {
  action: "Moved accounts" | "Updated tags" | "Synchronized accounts";
  items: InstagramAccountBatchItem[];
};

const pageSize = 20;

export default function InstagramAccountsManagementClient({
  connectionResult,
}: {
  connectionResult?: "success" | "error";
}) {
  const session = useSession();
  const router = useRouter();
  const organizationId = session.membership.organization.id;
  const canManage = canManageTeam(session.membership.role);
  const queryClient = useQueryClient();
  const managementKey = instagramAccountManagementQueryKey(organizationId);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [groupId, setGroupId] = useState("");
  const [tag, setTag] = useState("");
  const [favorite, setFavorite] = useState("");
  const [sortBy, setSortBy] = useState<"createdAt" | "username" | "name" | "lastSyncedAt" | "internalAlias">("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(() =>
    connectionResult === "success"
      ? { tone: "success", message: "Instagram account connected successfully." }
      : connectionResult === "error"
        ? { tone: "error", message: "Instagram connection was not completed. Try again." }
        : null,
  );
  const [mockFlow, setMockFlow] = useState<InstagramConnectStart | null>(null);
  const [mockDialogOpen, setMockDialogOpen] = useState(false);
  const [mockCode, setMockCode] = useState("mock-local-creator");
  const [groupForm, setGroupForm] = useState<GroupForm | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<InstagramAccountGroup | null>(null);
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<InstagramAccount | null>(null);
  const [bulkGroupId, setBulkGroupId] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [batchView, setBatchView] = useState<BatchView | null>(null);

  const queryKey = useMemo(
    () => [
      ...managementKey,
      { page, pageSize, search, status, groupId, tag, favorite, sortBy, sortOrder },
    ],
    [managementKey, page, search, status, groupId, tag, favorite, sortBy, sortOrder],
  );
  const accountsQuery = useQuery({
    queryKey,
    queryFn: () =>
      listManagedInstagramAccounts(organizationId, {
        page,
        pageSize,
        search: search || undefined,
        status: status || undefined,
        groupId: groupId || undefined,
        tag: tag || undefined,
        favorite: favorite ? favorite === "yes" : undefined,
        sortBy,
        sortOrder,
      }),
  });
  const groupsQuery = useQuery({
    queryKey: [...managementKey, "groups"],
    queryFn: () => listInstagramAccountGroups(organizationId),
  });
  const summaryQuery = useQuery({
    queryKey: [...managementKey, "summary"],
    queryFn: () => getInstagramAccountSummary(organizationId),
  });
  const preferencesQuery = useQuery({
    queryKey: [...managementKey, "preferences"],
    queryFn: () => listInstagramAccountPreferences(organizationId),
  });
  const accounts = accountsQuery.data?.items ?? [];
  const groups = groupsQuery.data ?? [];
  const preferences = useMemo(
    () => new Map((preferencesQuery.data ?? []).map((item) => [item.accountId, item])),
    [preferencesQuery.data],
  );

  const refreshManagement = () => {
    void queryClient.invalidateQueries({ queryKey: managementKey });
    void queryClient.invalidateQueries({ queryKey: instagramAccountsQueryKey(organizationId) });
  };
  const showError = (error: Error) => {
    setNotice({ tone: "error", message: errorMessage(error) });
  };
  const showSuccess = (message: string) => setNotice({ tone: "success", message });

  const connectMutation = useMutation({
    mutationFn: () => startInstagramConnection(organizationId),
    onSuccess: (flow) => {
      queryClient.setQueryData<InstagramAccount[]>(instagramAccountsQueryKey(organizationId), (old) => [
        flow.account,
        ...(old ?? []).filter((account) => account.id !== flow.account.id),
      ]);
      if (flow.mode === "MOCK") {
        setMockFlow(flow);
        setMockDialogOpen(true);
      } else {
        window.location.assign(flow.authorizationUrl);
      }
    },
    onError: showError,
  });
  const mockCallbackMutation = useMutation({
    mutationFn: ({ state, code }: { state: string; code: string }) => completeInstagramOAuth(state, code),
    onSuccess: async () => {
      setMockDialogOpen(false);
      setMockFlow(null);
      showSuccess("Instagram account connected successfully.");
      const legacyAccounts = await listInstagramAccounts(organizationId);
      queryClient.setQueryData(instagramAccountsQueryKey(organizationId), legacyAccounts);
      refreshManagement();
    },
    onError: showError,
  });
  const groupMutation = useMutation({
    mutationFn: (input: GroupForm) =>
      input.mode === "create"
        ? createInstagramAccountGroup(organizationId, {
            name: input.name.trim(),
            description: input.description.trim() || undefined,
          })
        : updateInstagramAccountGroup(organizationId, input.group!.id, {
            name: input.name.trim(),
            description: input.description.trim() || null,
          }),
    onSuccess: (_group, input) => {
      setGroupForm(null);
      showSuccess(input.mode === "create" ? "Group created." : "Group updated.");
      refreshManagement();
    },
    onError: showError,
  });
  const deleteGroupMutation = useMutation({
    mutationFn: (id: string) => deleteInstagramAccountGroup(organizationId, id),
    onSuccess: () => {
      setDeleteGroupTarget(null);
      setGroupId("");
      showSuccess("Group deleted. Its accounts are now ungrouped.");
      refreshManagement();
    },
    onError: showError,
  });
  const orderGroupsMutation = useMutation({
    mutationFn: (groupIds: string[]) => orderInstagramAccountGroups(organizationId, groupIds),
    onSuccess: () => {
      showSuccess("Group order updated.");
      refreshManagement();
    },
    onError: showError,
  });
  const metadataMutation = useMutation({
    mutationFn: (input: AccountForm) =>
      updateInstagramAccountMetadata(organizationId, input.account.id, {
        internalAlias: input.alias.trim() || null,
        tags: parseTags(input.tags),
      }),
    onSuccess: () => {
      setAccountForm(null);
      showSuccess("Account details updated.");
      refreshManagement();
    },
    onError: showError,
  });
  const moveMutation = useMutation({
    mutationFn: ({ accountId, groupId: targetGroupId }: { accountId: string; groupId: string | null }) =>
      moveInstagramAccount(organizationId, accountId, targetGroupId),
    onSuccess: () => {
      showSuccess("Account moved.");
      refreshManagement();
    },
    onError: showError,
  });
  const syncMutation = useMutation({
    mutationFn: (accountId: string) => syncInstagramAccount(organizationId, accountId),
    onSuccess: (syncedAccount) => {
      queryClient.setQueryData<InstagramAccountsPage>(queryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((account) =>
                account.id === syncedAccount.id
                  ? mergeSyncedAccount(account, syncedAccount)
                  : account,
              ),
            }
          : current,
      );
      queryClient.setQueryData<InstagramAccount[]>(instagramAccountsQueryKey(organizationId), (current) =>
        current?.map((account) => account.id === syncedAccount.id ? mergeSyncedAccount(account, syncedAccount) : account),
      );
      void queryClient.invalidateQueries({ queryKey: [...managementKey, "summary"] });
      showSuccess("Instagram account synchronized.");
    },
    onError: showError,
  });
  const disconnectMutation = useMutation({
    mutationFn: (accountId: string) => disconnectInstagramAccount(organizationId, accountId),
    onSuccess: () => {
      setDisconnectTarget(null);
      showSuccess("Instagram account disconnected.");
      refreshManagement();
    },
    onError: showError,
  });
  const preferenceMutation = useMutation({
    mutationFn: async ({ accountId, kind, enabled }: { accountId: string; kind: "favorite" | "default"; enabled: boolean }) => {
      if (kind === "favorite") await setInstagramAccountFavorite(organizationId, accountId, enabled);
      else await setDefaultInstagramAccount(organizationId, accountId, enabled);
    },
    onSuccess: (_result, variables) => {
      showSuccess(variables.kind === "favorite" ? "Favorite preference updated." : "Default account updated.");
      void queryClient.invalidateQueries({ queryKey: [...managementKey, "preferences"] });
      void queryClient.invalidateQueries({ queryKey: managementKey });
    },
    onError: showError,
  });
  const bulkMutation = useMutation({
    mutationFn: (input: { action: "move"; groupId: string | null } | { action: "tags"; tags: string[] } | { action: "sync" }) => {
      if (input.action === "move") return bulkMoveInstagramAccounts(organizationId, selectedIds, input.groupId);
      if (input.action === "tags") return bulkTagInstagramAccounts(organizationId, selectedIds, input.tags);
      return bulkSyncInstagramAccounts(organizationId, selectedIds);
    },
    onSuccess: (result, input) => {
      const action = input.action === "move" ? "Moved accounts" : input.action === "tags" ? "Updated tags" : "Synchronized accounts";
      setBatchView({ action, items: result.items });
      setSelectedIds([]);
      showSuccess(`${action}: ${result.items.filter((item) => item.outcome === "SUCCESS").length} succeeded, ${result.items.filter((item) => item.outcome === "FAILED").length} failed.`);
      refreshManagement();
    },
    onError: showError,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    if (connectionResult) router.replace("/instagram/accounts", { scroll: false });
  }, [connectionResult, router]);

  const updateGroupOrder = (groupIndex: number, direction: -1 | 1) => {
    const target = groupIndex + direction;
    if (target < 0 || target >= groups.length) return;
    const ordered = [...groups];
    [ordered[groupIndex], ordered[target]] = [ordered[target], ordered[groupIndex]];
    orderGroupsMutation.mutate(ordered.map((group) => group.id));
  };
  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((selected) => checked ? [...new Set([...selected, id])] : selected.filter((selectedId) => selectedId !== id));
  };
  const selectCurrentPage = (checked: boolean) => setSelectedIds(checked ? accounts.map((account) => account.id) : []);
  const visibleIds = accounts.map((account) => account.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  const preferencesFor = (accountId: string) => preferences.get(accountId);

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">Channels</p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">Instagram accounts</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Organize accounts, find the right profile, and manage your workspace preferences.</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60 sm:self-auto">
            {connectMutation.isPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Connect account
          </button>
        )}
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-6 py-7 text-white shadow-xl shadow-indigo-950/10 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100"><ShieldCheck className="size-3.5" />Organization-scoped account management</div>
            <h2 className="max-w-lg text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[30px]">Every account, clearly organized.</h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-slate-300">Search profiles, group related accounts, and use bulk sync with item-level results.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-[310px]">
            <Metric label="Visible accounts" value={summaryQuery.data?.total ?? "—"} />
            <Metric label="Connected" value={summaryQuery.data?.byStatus.CONNECTED ?? "—"} />
            <Metric label="Groups" value={groups.length} />
            <Metric label="Group limit" value={summaryQuery.data?.limits.maxGroups ?? "—"} />
          </div>
        </div>
      </section>

      {!canManage && (
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm text-indigo-900">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-indigo-600" />
          <p className="leading-5">Account-level grants determine whether you can edit, move, or synchronize each account. Group administration and disconnect are limited to owners and admins; denied account actions are reported by the API.</p>
        </div>
      )}
      {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}
      {summaryQuery.isError && <InlineError message={errorMessage(summaryQuery.error)} retry={() => void summaryQuery.refetch()} />}
      {preferencesQuery.isError && <InlineError message={errorMessage(preferencesQuery.error)} retry={() => void preferencesQuery.refetch()} />}

      <section className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.02] sm:p-6" aria-label="Account filters">
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Find an account</h2>
            <p className="mt-1 text-[11px] text-slate-500">Search, filter, and sort accounts visible to your role.</p>
          </div>
          <button type="button" onClick={() => { setSearchInput(""); setSearch(""); setStatus(""); setGroupId(""); setTag(""); setFavorite(""); setPage(1); setSelectedIds([]); }} className="self-start text-[11px] font-semibold text-indigo-700 hover:text-indigo-900">Clear filters</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <label className="relative sm:col-span-2 xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input aria-label="Search Instagram accounts" value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1); setSelectedIds([]); }} placeholder="Username, name, or alias" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-xs text-slate-700 outline-none focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-500/10" />
          </label>
          <label className="sr-only" htmlFor="account-group-filter">Filter by group</label>
          <select id="account-group-filter" aria-label="Filter by group" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPage(1); setSelectedIds([]); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300">
            <option value="">All groups</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="account-status-filter">Filter by status</label>
          <select id="account-status-filter" aria-label="Filter by status" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); setSelectedIds([]); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300">
            <option value="">All statuses</option><option value="CONNECTED">Connected</option><option value="CONNECTING">Connecting</option><option value="DISCONNECTED">Disconnected</option><option value="ERROR">Error</option>
          </select>
          <label className="relative">
            <Tag className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input aria-label="Filter by tag" value={tag} onChange={(event) => { setTag(event.target.value); setPage(1); setSelectedIds([]); }} placeholder="Filter by tag" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-xs outline-none focus:border-indigo-300 focus:bg-white" />
          </label>
          <label className="sr-only" htmlFor="account-favorite-filter">Filter by favorite</label>
          <select id="account-favorite-filter" aria-label="Filter by favorite" value={favorite} onChange={(event) => { setFavorite(event.target.value); setPage(1); setSelectedIds([]); }} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-indigo-300">
            <option value="">Favorites: any</option><option value="yes">Favorites only</option><option value="no">Not favorited</option>
          </select>
        </div>
        <div className="mt-3 flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] text-slate-400">{accountsQuery.data ? `${accountsQuery.data.total} matching accounts` : "Results are scoped to your organization access."}</p>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-medium text-slate-500" htmlFor="account-sort">Sort by</label>
            <select id="account-sort" value={sortBy} onChange={(event) => { setSortBy(event.target.value as typeof sortBy); setPage(1); setSelectedIds([]); }} className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700">
              <option value="createdAt">Recently added</option><option value="username">Username</option><option value="name">Name</option><option value="lastSyncedAt">Last synced</option><option value="internalAlias">Alias</option>
            </select>
            <button type="button" aria-label={`Sort ${sortOrder === "asc" ? "descending" : "ascending"}`} onClick={() => { setSortOrder((current) => current === "asc" ? "desc" : "asc"); setPage(1); setSelectedIds([]); }} className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">{sortOrder === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}</button>
          </div>
        </div>
      </section>

      {canManage && <GroupsPanel groups={groups} limit={summaryQuery.data?.limits.maxGroups} loading={groupsQuery.isLoading} onCreate={() => setGroupForm({ mode: "create", name: "", description: "" })} onEdit={(group) => setGroupForm({ mode: "edit", group, name: group.name, description: group.description ?? "" })} onDelete={setDeleteGroupTarget} onMove={updateGroupOrder} moving={orderGroupsMutation.isPending} />}
      {groupsQuery.isError && <InlineError message={errorMessage(groupsQuery.error)} retry={() => void groupsQuery.refetch()} />}

      <section aria-label="Instagram account list" className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Accounts</h2>
          <p className="mt-1 text-[11px] text-slate-500">Select accounts on this page to move, tag, or synchronize them. Account grants are enforced by the backend.</p>
          </div>
          <span className="inline-flex self-start items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-600"><Camera className="size-3 text-fuchsia-600" />{accountsQuery.data?.total ?? 0} accounts</span>
        </div>

        {accountsQuery.isLoading ? <LoadingState label="Loading Instagram accounts" /> : accountsQuery.isError ? <InlineError message={errorMessage(accountsQuery.error)} retry={() => void accountsQuery.refetch()} /> : accounts.length === 0 ? (
          <div className="rounded-[22px] border border-slate-200/80 bg-white px-6 py-14 text-center shadow-sm">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-fuchsia-50 text-fuchsia-600"><Camera className="size-6" /></span>
            <h3 className="mt-5 text-base font-semibold text-slate-900">{accountsQuery.data?.total ? "No accounts match these filters" : "No Instagram accounts yet"}</h3>
            <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">{accountsQuery.data?.total ? "Try changing your search or filters." : "Connect a MOCK or professional Instagram account to get started."}</p>
            {!accountsQuery.data?.total && canManage && <button type="button" onClick={() => connectMutation.mutate()} className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white hover:bg-indigo-700"><Plus className="size-3.5" />Connect your first account</button>}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 sm:flex-row sm:items-center">
              <label className="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-indigo-950"><input type="checkbox" aria-label="Select all accounts on this page" checked={allVisibleSelected} onChange={(event) => selectCurrentPage(event.target.checked)} className="size-4 rounded border-slate-300 accent-indigo-600" />Select page</label>
              {selectedIds.length > 0 && <><span className="text-[10px] text-indigo-800">{selectedIds.length} selected</span><div className="ml-auto grid flex-1 gap-2 sm:grid-cols-3">
                <label className="sr-only" htmlFor="bulk-group">Move selected accounts</label><select id="bulk-group" aria-label="Move selected accounts" value={bulkGroupId} onChange={(event) => setBulkGroupId(event.target.value)} className="h-9 min-w-0 rounded-lg border border-indigo-200 bg-white px-2 text-[10px]"><option value="">Move to group…</option><option value="__none__">No group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
                <button type="button" disabled={!bulkGroupId || bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: "move", groupId: bulkGroupId === "__none__" ? null : bulkGroupId })} className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-[10px] font-semibold text-indigo-800 disabled:opacity-45">Move selected</button>
                <div className="flex gap-2"><input aria-label="Tags to replace on selected accounts" value={bulkTags} onChange={(event) => setBulkTags(event.target.value)} placeholder="Replace tags (comma separated)" className="h-9 min-w-0 flex-1 rounded-lg border border-indigo-200 bg-white px-2 text-[10px]" /><button type="button" disabled={bulkMutation.isPending || !bulkTags.trim()} onClick={() => bulkMutation.mutate({ action: "tags", tags: parseTags(bulkTags) })} className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-[10px] font-semibold text-indigo-800 disabled:opacity-45">Apply tags</button><button type="button" disabled={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: "tags", tags: [] })} className="h-9 rounded-lg border border-indigo-200 bg-white px-3 text-[10px] font-semibold text-indigo-800 disabled:opacity-45">Clear tags</button></div>
                <button type="button" disabled={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: "sync" })} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"><RefreshCw className={`size-3 ${bulkMutation.isPending ? "animate-spin" : ""}`} />Sync selected</button>
              </div></>}
            </div>

            {batchView && <BatchResults view={batchView} accounts={accounts} onDismiss={() => setBatchView(null)} />}

            <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.02]">
              <div className="divide-y divide-slate-100">
                {accounts.map((account) => {
                  const preference = preferencesFor(account.id);
                  const selected = selectedIds.includes(account.id);
                  return <AccountRow key={account.id} account={account} groups={groups} canManage={canManage} selected={selected} favorite={preference?.favorite ?? false} isDefault={preference?.isDefault ?? false} syncing={syncMutation.isPending && syncMutation.variables === account.id} moving={moveMutation.isPending && moveMutation.variables?.accountId === account.id} onSelect={(checked) => toggleSelected(account.id, checked)} onEdit={() => setAccountForm({ account, alias: account.internalAlias ?? "", tags: (account.tags ?? []).join(", ") })} onMove={(nextGroup) => moveMutation.mutate({ accountId: account.id, groupId: nextGroup || null })} onSync={() => syncMutation.mutate(account.id)} onDisconnect={() => setDisconnectTarget(account)} onFavorite={() => preferenceMutation.mutate({ accountId: account.id, kind: "favorite", enabled: !preference?.favorite })} onDefault={() => preferenceMutation.mutate({ accountId: account.id, kind: "default", enabled: !preference?.isDefault })} />;
                })}
              </div>
              <div className="flex flex-col justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <p className="text-[10px] text-slate-400">Page {accountsQuery.data?.page ?? page} of {Math.max(accountsQuery.data?.totalPages ?? 0, 1)} · {pageSize} per page</p>
                <div className="flex items-center gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1 || accountsQuery.isFetching} className="h-8 rounded-lg border border-slate-200 px-3 text-[10px] font-semibold text-slate-600 disabled:opacity-40">Previous</button><button type="button" onClick={() => setPage((value) => value + 1)} disabled={page >= (accountsQuery.data?.totalPages ?? 1) || accountsQuery.isFetching} className="h-8 rounded-lg border border-slate-200 px-3 text-[10px] font-semibold text-slate-600 disabled:opacity-40">Next</button></div>
              </div>
            </div>
          </>
        )}
      </section>

      {groupForm && <GroupDialog value={groupForm} pending={groupMutation.isPending} onChange={setGroupForm} onClose={() => setGroupForm(null)} onSubmit={(event) => { event.preventDefault(); groupMutation.mutate(groupForm); }} />}
      {deleteGroupTarget && <ConfirmDialog title="Delete account group?" body={`“${deleteGroupTarget.name}” will be removed. Accounts in this group will remain in the organization without a group.`} confirmLabel="Delete group" pending={deleteGroupMutation.isPending} onClose={() => setDeleteGroupTarget(null)} onConfirm={() => deleteGroupMutation.mutate(deleteGroupTarget.id)} />}
      {accountForm && <AccountDetailsDialog value={accountForm} pending={metadataMutation.isPending} onChange={setAccountForm} onClose={() => setAccountForm(null)} onSubmit={(event) => { event.preventDefault(); metadataMutation.mutate(accountForm); }} />}
      {disconnectTarget && <ConfirmDialog title="Disconnect Instagram account?" body={`${identityOf(disconnectTarget)} will be disconnected. If an active automation or draft/queued publication depends on it, the backend will reject this request and explain why.`} confirmLabel="Disconnect account" pending={disconnectMutation.isPending} destructive onClose={() => setDisconnectTarget(null)} onConfirm={() => disconnectMutation.mutate(disconnectTarget.id)} />}
      {mockFlow && mockDialogOpen && <MockConnectionDialog code={mockCode} setCode={setMockCode} pending={mockCallbackMutation.isPending} onClose={() => setMockDialogOpen(false)} onApprove={() => { if (mockCode.trim()) mockCallbackMutation.mutate({ state: mockFlow.state, code: mockCode.trim() }); }} />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-3"><p className="text-[9px] font-medium uppercase tracking-[0.1em] text-slate-400">{label}</p><p className="mt-1 text-lg font-semibold text-white">{value}</p></div>;
}

function GroupsPanel({ groups, limit, loading, onCreate, onEdit, onDelete, onMove, moving }: { groups: InstagramAccountGroup[]; limit?: number; loading: boolean; onCreate: () => void; onEdit: (group: InstagramAccountGroup) => void; onDelete: (group: InstagramAccountGroup) => void; onMove: (index: number, direction: -1 | 1) => void; moving: boolean }) {
  return <section className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6" aria-label="Account groups">
    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div><h2 className="text-sm font-semibold text-slate-900">Groups</h2><p className="mt-1 text-[11px] text-slate-500">Organize accounts into named folders. {limit !== undefined ? `${groups.length} of ${limit} groups used.` : ""}</p></div><button type="button" onClick={onCreate} disabled={limit !== undefined && groups.length >= limit} className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-45"><Plus className="size-3.5" />New group</button></div>
    {loading ? <p className="py-5 text-xs text-slate-400">Loading groups…</p> : groups.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-200 p-5 text-center text-[11px] text-slate-500">No groups yet. Create one to organize accounts.</div> : <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{groups.map((group, index) => <div key={group.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 ring-1 ring-slate-200"><FolderKanban className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-slate-800">{group.name}</span><span className="mt-0.5 block truncate text-[10px] text-slate-500">{group.accountCount} accounts{group.description ? ` · ${group.description}` : ""}</span></span><div className="flex shrink-0 items-center gap-1"><button type="button" aria-label={`Move ${group.name} up`} disabled={index === 0 || moving} onClick={() => onMove(index, -1)} className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"><ArrowUp className="size-3.5" /></button><button type="button" aria-label={`Move ${group.name} down`} disabled={index === groups.length - 1 || moving} onClick={() => onMove(index, 1)} className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-slate-700 disabled:opacity-30"><ArrowDown className="size-3.5" /></button><button type="button" aria-label={`Edit ${group.name}`} onClick={() => onEdit(group)} className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-indigo-700"><Pencil className="size-3.5" /></button><button type="button" aria-label={`Delete ${group.name}`} onClick={() => onDelete(group)} className="flex size-7 items-center justify-center rounded-md text-slate-400 hover:bg-white hover:text-rose-600"><Trash2 className="size-3.5" /></button></div></div>)}</div>}
  </section>;
}

function AccountRow({ account, groups, canManage, selected, favorite, isDefault, syncing, moving, onSelect, onEdit, onMove, onSync, onDisconnect, onFavorite, onDefault }: { account: InstagramAccount; groups: InstagramAccountGroup[]; canManage: boolean; selected: boolean; favorite: boolean; isDefault: boolean; syncing: boolean; moving: boolean; onSelect: (checked: boolean) => void; onEdit: () => void; onMove: (groupId: string) => void; onSync: () => void; onDisconnect: () => void; onFavorite: () => void; onDefault: () => void }) {
  const label = identityOf(account);
  return <article className="grid gap-4 px-4 py-4 transition hover:bg-slate-50/70 sm:grid-cols-[minmax(230px,1.4fr)_minmax(140px,.8fr)_minmax(140px,.8fr)_minmax(170px,.8fr)] sm:items-center sm:px-5" aria-label={`Account ${label}`}>
    <div className="flex min-w-0 items-start gap-3">
      {canManage && <input type="checkbox" aria-label={`Select account ${label}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} className="mt-3 size-4 shrink-0 rounded border-slate-300 accent-indigo-600" />}
      {account.avatarUrl ? <Image src={account.avatarUrl} alt={`${label} profile`} width={44} height={44} unoptimized referrerPolicy="no-referrer" className="size-11 shrink-0 rounded-xl border border-slate-200 object-cover" /> : <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-fuchsia-50 text-fuchsia-600"><Camera className="size-4" /></span>}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-xs font-semibold text-slate-900">{account.internalAlias || account.name || label}</h3><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${account.provider === "MOCK" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{account.provider === "MOCK" ? "MOCK · sample data" : account.provider}</span><StatusPill status={account.status} /></div><p className="mt-1 truncate text-[11px] text-slate-500">{account.username ? `@${account.username}` : account.name || "Instagram profile"}</p>{account.tags && account.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{account.tags.map((item) => <span key={item} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-600">{item}</span>)}</div>}</div>
    </div>
    <div className="grid grid-cols-2 gap-3 sm:block"><span className="block text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">Group</span><select aria-label={`Group for ${label}`} value={account.groupId ?? ""} onChange={(event) => onMove(event.target.value)} disabled={moving} className="mt-1 h-8 max-w-full rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700"><option value="">No group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></div>
    <div className="grid grid-cols-2 gap-3 sm:block"><span className="block text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-400">Last synced</span><span className="mt-1 block text-[11px] font-medium text-slate-700">{account.lastSyncedAt ? formatDateTime(account.lastSyncedAt) : "Not synced yet"}</span></div>
    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
      <button type="button" aria-label={favorite ? `Remove ${label} from favorites` : `Add ${label} to favorites`} aria-pressed={favorite} onClick={onFavorite} className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-semibold ${favorite ? "border-rose-200 bg-rose-50 text-rose-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}><Heart className={`size-3 ${favorite ? "fill-current" : ""}`} />{favorite ? "Favorite" : "Favorite"}</button>
      <button type="button" aria-label={isDefault ? `Clear default for ${label}` : `Set ${label} as default`} aria-pressed={isDefault} onClick={onDefault} className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-semibold ${isDefault ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}><Star className={`size-3 ${isDefault ? "fill-current" : ""}`} />{isDefault ? "Default" : "Set default"}</button>
      <button type="button" aria-label={`Edit details for ${label}`} onClick={onEdit} className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"><Pencil className="size-3" /><span className="hidden lg:inline">Details</span></button>{(account.status === "CONNECTED" || account.status === "ERROR") && <button type="button" aria-label={`Sync account ${label}`} disabled={syncing} onClick={onSync} className="flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50">{syncing ? <LoaderCircle className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}<span className="hidden lg:inline">Sync</span></button>}{canManage && account.status !== "DISCONNECTED" && <button type="button" aria-label={`Disconnect account ${label}`} onClick={onDisconnect} className="flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 text-[10px] font-semibold text-rose-700 hover:bg-rose-50"><Unplug className="size-3" /><span className="hidden lg:inline">Disconnect</span></button>}
    </div>
    {account.status === "ERROR" && account.lastError && <p className="sm:col-span-4 -mt-2 flex items-center gap-1.5 text-[10px] text-rose-700"><CircleAlert className="size-3 shrink-0" />{account.lastError}</p>}
  </article>;
}

function StatusPill({ status }: { status: InstagramAccountStatus }) {
  const styles: Record<InstagramAccountStatus, string> = { CONNECTED: "bg-emerald-50 text-emerald-700", CONNECTING: "bg-amber-50 text-amber-700", DISCONNECTED: "bg-slate-100 text-slate-600", ERROR: "bg-rose-50 text-rose-700" };
  const labels: Record<InstagramAccountStatus, string> = { CONNECTED: "Connected", CONNECTING: "Connecting", DISCONNECTED: "Disconnected", ERROR: "Error" };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

function GroupDialog({ value, pending, onChange, onClose, onSubmit }: { value: GroupForm; pending: boolean; onChange: (value: GroupForm) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title={value.mode === "create" ? "Create account group" : "Edit account group"} onClose={onClose}><form onSubmit={onSubmit} className="mt-5 space-y-4"><label className="block text-[11px] font-semibold text-slate-700">Group name<input autoFocus required maxLength={80} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-indigo-300" /></label><label className="block text-[11px] font-semibold text-slate-700">Description <span className="font-normal text-slate-400">(optional)</span><textarea maxLength={240} rows={3} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-indigo-300" /></label><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-xl border border-slate-200 px-4 text-[11px] font-semibold text-slate-600">Cancel</button><button type="submit" disabled={pending || !value.name.trim()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[11px] font-semibold text-white disabled:opacity-50">{pending && <LoaderCircle className="size-3 animate-spin" />}{value.mode === "create" ? "Create group" : "Save changes"}</button></div></form></Modal>;
}

function AccountDetailsDialog({ value, pending, onChange, onClose, onSubmit }: { value: AccountForm; pending: boolean; onChange: (value: AccountForm) => void; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Modal title="Edit account details" onClose={onClose}><p className="mt-1 text-xs text-slate-500">{identityOf(value.account)} · changes are internal to this workspace.</p><form onSubmit={onSubmit} className="mt-5 space-y-4"><label className="block text-[11px] font-semibold text-slate-700">Internal alias<input maxLength={100} value={value.alias} onChange={(event) => onChange({ ...value, alias: event.target.value })} placeholder="e.g. Spring campaign" className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-indigo-300" /></label><label className="block text-[11px] font-semibold text-slate-700">Tags <span className="font-normal text-slate-400">(comma separated, max 20)</span><input value={value.tags} onChange={(event) => onChange({ ...value, tags: event.target.value })} placeholder="brand, campaign" className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-indigo-300" /></label><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-xl border border-slate-200 px-4 text-[11px] font-semibold text-slate-600">Cancel</button><button type="submit" disabled={pending || parseTags(value.tags).length > 20} className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[11px] font-semibold text-white disabled:opacity-50">{pending && <LoaderCircle className="size-3 animate-spin" />}Save details</button></div></form></Modal>;
}

function ConfirmDialog({ title, body, confirmLabel, pending, destructive, onClose, onConfirm }: { title: string; body: string; confirmLabel: string; pending: boolean; destructive?: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm" role="presentation"><section role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-2xl"><span className={`flex size-11 items-center justify-center rounded-2xl ${destructive ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-700"}`}>{destructive ? <Unplug className="size-5" /> : <Trash2 className="size-5" />}</span><h2 id="confirm-title" className="mt-4 text-base font-semibold text-slate-900">{title}</h2><p className="mt-2 text-xs leading-5 text-slate-500">{body}</p><div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} disabled={pending} className="h-9 rounded-xl border border-slate-200 px-4 text-[11px] font-semibold text-slate-600">Cancel</button><button type="button" onClick={onConfirm} disabled={pending} className={`inline-flex h-9 items-center justify-center gap-2 rounded-xl px-4 text-[11px] font-semibold text-white disabled:opacity-50 ${destructive ? "bg-rose-600 hover:bg-rose-700" : "bg-rose-600 hover:bg-rose-700"}`}>{pending && <LoaderCircle className="size-3 animate-spin" />}{confirmLabel}</button></div></section></div>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm" role="presentation"><section role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><h2 className="text-base font-semibold text-slate-900">{title}</h2><button type="button" aria-label="Close dialog" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="size-4" /></button></div>{children}</section></div>;
}

function MockConnectionDialog({ code, setCode, pending, onClose, onApprove }: { code: string; setCode: (value: string) => void; pending: boolean; onClose: () => void; onApprove: () => void }) {
  return <Modal title="Complete mock connection" onClose={onClose}><div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4"><p className="text-xs font-semibold text-indigo-900"><span>MOCK provider</span> · local development</p><p className="mt-1.5 text-[11px] leading-5 text-indigo-800">No Instagram credentials are needed. Approve the simulated account to finish the connection.</p></div><label className="mt-5 block text-[11px] font-semibold text-slate-700">Mock authorization code<input value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-slate-200 px-3 text-xs" /></label><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-xl border border-slate-200 px-4 text-[11px] font-semibold text-slate-600">Close</button><button type="button" onClick={onApprove} disabled={pending || !code.trim()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-[11px] font-semibold text-white disabled:opacity-50">{pending ? <LoaderCircle className="size-3 animate-spin" /> : <Check className="size-3" />}Simulate approval</button></div></Modal>;
}

function BatchResults({ view, accounts, onDismiss }: { view: BatchView; accounts: InstagramAccount[]; onDismiss: () => void }) {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const failed = view.items.filter((item) => item.outcome === "FAILED").length;
  return <section aria-label="Batch operation results" className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4"><div><h3 className="text-xs font-semibold text-slate-900">{view.action} results</h3><p className="mt-1 text-[10px] text-slate-500">{view.items.length - failed} succeeded · {failed} failed</p></div><button type="button" aria-label="Dismiss batch results" onClick={onDismiss} className="rounded-md p-1 text-slate-400 hover:bg-slate-100"><X className="size-3.5" /></button></div><ul className="divide-y divide-slate-100">{view.items.map((item) => <li key={item.accountId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[10px]"><span className="min-w-0 truncate font-medium text-slate-700">{accountById.get(item.accountId) ? identityOf(accountById.get(item.accountId)!) : `Account ${item.accountId.slice(0, 8)}`}</span><span className={`shrink-0 rounded-full px-2 py-1 font-semibold ${item.outcome === "SUCCESS" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{item.outcome === "SUCCESS" ? "Success" : `Failed · ${friendlyBatchCode(item.code)}`}</span></li>)}</ul></section>;
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const success = notice.tone === "success";
  return <div className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${success ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`} role={success ? "status" : "alert"}><span className="mt-0.5">{success ? <Check className="size-4" /> : <CircleAlert className="size-4" />}</span><p className="flex-1 text-xs font-medium leading-5">{notice.message}</p><button type="button" aria-label="Dismiss notification" onClick={onDismiss} className="rounded-md p-0.5 opacity-60 hover:bg-black/5"><X className="size-3.5" /></button></div>;
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

function mergeSyncedAccount(current: InstagramAccount, synced: InstagramAccount): InstagramAccount {
  return {
    ...current,
    status: synced.status,
    username: synced.username ?? current.username,
    name: synced.name ?? current.name,
    avatarUrl: synced.avatarUrl ?? current.avatarUrl,
    lastSyncedAt: synced.lastSyncedAt,
    lastError: synced.lastError,
  };
}

function identityOf(account: InstagramAccount): string {
  return account.username ? `@${account.username}` : account.name || "Instagram account";
}

function errorMessage(error: Error): string {
  if (error instanceof ApiClientError && error.status === 403) return "You do not have permission for this action. Ask an organization owner or admin to update your access.";
  if (error instanceof ApiClientError && error.status === 409) return `${error.message} Resolve the active dependency or limit, then try again.`;
  return error.message;
}

function friendlyBatchCode(code: string): string {
  const labels: Record<string, string> = { ACCOUNT_NOT_AVAILABLE: "account unavailable", ACCESS_DENIED: "permission denied", ACCOUNT_NOT_READY: "account not ready", SYNC_FAILED: "sync failed", OPERATION_FAILED: "operation failed" };
  return labels[code] ?? "operation failed";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
