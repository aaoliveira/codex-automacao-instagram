"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  Check,
  CircleAlert,
  Clock3,
  Link2,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session-context";
import { InlineError, LoadingState } from "@/components/ui/states";
import {
  completeInstagramOAuth,
  disconnectInstagramAccount,
  instagramAccountsQueryKey,
  listInstagramAccounts,
  startInstagramConnection,
  syncInstagramAccount,
} from "@/lib/api/instagram";
import type {
  InstagramAccount,
  InstagramAccountStatus,
  InstagramConnectStart,
} from "@/lib/api/types";
import { canManageTeam } from "@/lib/auth/permissions";

type Notice = { tone: "success" | "error"; message: string };

export default function InstagramAccountsClient({
  connectionResult,
}: {
  connectionResult?: "success" | "error";
}) {
  const session = useSession();
  const router = useRouter();
  const organizationId = session.membership.organization.id;
  const canManage = canManageTeam(session.membership.role);
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => instagramAccountsQueryKey(organizationId),
    [organizationId],
  );
  const [mockFlow, setMockFlow] = useState<InstagramConnectStart | null>(null);
  const [mockDialogOpen, setMockDialogOpen] = useState(false);
  const [mockCode, setMockCode] = useState("mock-local-creator");
  const [disconnectTarget, setDisconnectTarget] =
    useState<InstagramAccount | null>(null);
  const [notice, setNotice] = useState<Notice | null>(() =>
    connectionResult === "success"
      ? {
          tone: "success",
          message: "Instagram account connected successfully.",
        }
      : connectionResult === "error"
        ? {
            tone: "error",
            message: "Instagram connection was not completed. Try again.",
          }
        : null,
  );

  const accountsQuery = useQuery({
    queryKey,
    queryFn: () => listInstagramAccounts(organizationId),
  });

  const connectMutation = useMutation({
    mutationFn: () => startInstagramConnection(organizationId),
    onSuccess: (flow) => {
      queryClient.setQueryData<InstagramAccount[]>(queryKey, (accounts) => [
        flow.account,
        ...(accounts ?? []).filter((account) => account.id !== flow.account.id),
      ]);
      if (flow.mode === "MOCK") {
        setMockFlow(flow);
        setMockDialogOpen(true);
      } else {
        window.location.assign(flow.authorizationUrl);
      }
    },
  });

  const mockCallbackMutation = useMutation({
    mutationFn: ({ state, code }: { state: string; code: string }) =>
      completeInstagramOAuth(state, code),
    onSuccess: () => {
      setMockDialogOpen(false);
      setMockFlow(null);
      setNotice({
        tone: "success",
        message: "Instagram account connected successfully.",
      });
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const syncMutation = useMutation({
    mutationFn: (accountId: string) =>
      syncInstagramAccount(organizationId, accountId),
    onSuccess: (syncedAccount) => {
      queryClient.setQueryData<InstagramAccount[]>(queryKey, (accounts) =>
        (accounts ?? [syncedAccount]).map((account) =>
          account.id === syncedAccount.id
            ? {
                ...syncedAccount,
                username: syncedAccount.username ?? account.username,
                name: syncedAccount.name ?? account.name,
                avatarUrl: syncedAccount.avatarUrl ?? account.avatarUrl,
              }
            : account,
        ),
      );
      setNotice({
        tone: "success",
        message: "Instagram account synchronized.",
      });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: (accountId: string) =>
      disconnectInstagramAccount(organizationId, accountId),
    onSuccess: () => {
      setDisconnectTarget(null);
      setNotice({
        tone: "success",
        message: "Instagram account disconnected.",
      });
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  useEffect(() => {
    if (connectionResult)
      router.replace("/instagram/accounts", { scroll: false });
  }, [connectionResult, router]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const accounts = accountsQuery.data ?? [];

  return (
    <div className="space-y-7 sm:space-y-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            Channels
          </p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Instagram accounts
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
            Connect and manage the professional Instagram accounts for{" "}
            {session.membership.organization.name}.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              connectMutation.mutate();
            }}
            disabled={connectMutation.isPending}
            className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60 sm:self-auto"
          >
            {connectMutation.isPending ? (
              <LoaderCircle
                className="size-3.5 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Link2 className="size-3.5" aria-hidden="true" />
            )}
            Connect account
          </button>
        )}
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-6 py-7 text-white shadow-xl shadow-indigo-950/10 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute right-14 top-8 size-28 rounded-full bg-fuchsia-500/15 blur-3xl" />
        <div className="relative z-10 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Secure organization connections
            </div>
            <h2 className="max-w-lg text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[30px]">
              Your Instagram accounts, in one place.
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-slate-300">
              Review connection health, refresh account details, and manage
              access for this workspace.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 backdrop-blur-sm lg:min-w-[210px]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-fuchsia-500/15 text-fuchsia-200">
              <Camera className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">
                Workspace accounts
              </span>
              <span className="mt-1 block text-sm font-semibold text-white">
                {accountsQuery.isSuccess
                  ? accounts.filter(
                      (account) => account.status !== "DISCONNECTED",
                    ).length
                  : "—"}{" "}
                active accounts
              </span>
            </span>
          </div>
        </div>
      </section>

      {!canManage && (
        <div className="flex items-start gap-3 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm text-indigo-900">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-indigo-600"
            aria-hidden="true"
          />
          <p className="leading-5">
            You can view accounts in this workspace. An owner or admin can
            connect, synchronize, or disconnect them.
          </p>
        </div>
      )}

      {notice && (
        <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />
      )}

      {accountsQuery.isLoading ? (
        <LoadingState label="Loading Instagram accounts" />
      ) : accountsQuery.isError ? (
        <InlineError
          message={accountsQuery.error.message}
          retry={() => void accountsQuery.refetch()}
        />
      ) : accounts.length === 0 ? (
        <EmptyState
          canManage={canManage}
          onConnect={() => connectMutation.mutate()}
          loading={connectMutation.isPending}
        />
      ) : (
        <section aria-label="Instagram account list" className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Instagram accounts
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Only people in this organization can view these accounts.
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] font-semibold text-slate-600">
              <Camera className="size-3 text-fuchsia-600" aria-hidden="true" />
              {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
            </span>
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {accounts.map((account) => (
              <InstagramAccountCard
                key={account.id}
                account={account}
                canManage={canManage}
                syncing={
                  syncMutation.isPending &&
                  syncMutation.variables === account.id
                }
                onSync={() => syncMutation.mutate(account.id)}
                onDisconnect={() => setDisconnectTarget(account)}
                onContinueMock={() => {
                  if (mockFlow?.account.id === account.id)
                    setMockDialogOpen(true);
                }}
              />
            ))}
          </div>
        </section>
      )}

      {mockFlow && mockDialogOpen && (
        <MockConnectionDialog
          code={mockCode}
          setCode={setMockCode}
          pending={mockCallbackMutation.isPending}
          onClose={() => setMockDialogOpen(false)}
          onApprove={() => {
            if (mockCode.trim())
              mockCallbackMutation.mutate({
                state: mockFlow.state,
                code: mockCode.trim(),
              });
          }}
        />
      )}

      {disconnectTarget && (
        <DisconnectDialog
          account={disconnectTarget}
          pending={disconnectMutation.isPending}
          onCancel={() => setDisconnectTarget(null)}
          onConfirm={() => disconnectMutation.mutate(disconnectTarget.id)}
        />
      )}
    </div>
  );
}

function EmptyState({
  canManage,
  loading,
  onConnect,
}: {
  canManage: boolean;
  loading: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white px-6 py-14 text-center shadow-sm shadow-slate-900/[0.02] sm:py-16">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-fuchsia-50 text-fuchsia-600">
        <Camera className="size-6" aria-hidden="true" />
      </span>
      <h2 className="mt-5 text-base font-semibold tracking-tight text-slate-900">
        No Instagram accounts yet
      </h2>
      <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">
        Connect a professional Instagram account to see its profile and
        connection status here.
      </p>
      {canManage ? (
        <button
          type="button"
          onClick={onConnect}
          disabled={loading}
          className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Link2 className="size-3.5" />
          )}
          Connect your first account
        </button>
      ) : (
        <p className="mt-5 text-[11px] font-medium text-slate-500">
          Ask an organization owner or admin to connect an account.
        </p>
      )}
    </div>
  );
}

function InstagramAccountCard({
  account,
  canManage,
  syncing,
  onSync,
  onDisconnect,
  onContinueMock,
}: {
  account: InstagramAccount;
  canManage: boolean;
  syncing: boolean;
  onSync: () => void;
  onDisconnect: () => void;
  onContinueMock: () => void;
}) {
  const identity = account.username
    ? `@${account.username}`
    : "Instagram account";
  const statusClass = {
    CONNECTED: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    CONNECTING: "bg-amber-50 text-amber-700 ring-amber-600/10",
    DISCONNECTED: "bg-slate-100 text-slate-600 ring-slate-500/10",
    ERROR: "bg-rose-50 text-rose-700 ring-rose-600/10",
  }[account.status];
  const statusLabel = {
    CONNECTED: "Connected",
    CONNECTING: "Connecting",
    DISCONNECTED: "Disconnected",
    ERROR: "Connection error",
  }[account.status];

  return (
    <article className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.02] transition hover:border-slate-300 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3.5">
          {account.avatarUrl ? (
            <Image
              src={account.avatarUrl}
              alt={`${identity} profile`}
              width={52}
              height={52}
              unoptimized
              referrerPolicy="no-referrer"
              className="size-[52px] shrink-0 rounded-2xl border border-slate-200 object-cover"
            />
          ) : (
            <span className="flex size-[52px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-50 to-indigo-50 text-fuchsia-600 ring-1 ring-slate-200/70">
              <Camera className="size-5" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900">
                {account.name || identity}
              </h3>
              <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold tracking-wide text-slate-500">
                {account.provider}
              </span>
            </div>
            {account.username ? (
              <p className="mt-1 truncate text-xs text-slate-500">
                @{account.username}
              </p>
            ) : (
              <p className="mt-1 truncate text-xs text-slate-500">
                {account.externalAccountId ||
                  "Profile details will appear after sync"}
              </p>
            )}
          </div>
        </div>
        <StatusBadge
          status={account.status}
          label={statusLabel}
          className={statusClass}
        />
      </div>

      <div className="mt-5 rounded-2xl bg-slate-50/80 p-3.5">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            Last synced
          </p>
          <p className="mt-1 truncate text-xs font-semibold text-slate-700">
            {account.lastSyncedAt
              ? formatDate(account.lastSyncedAt)
              : "Not synced yet"}
          </p>
        </div>
      </div>

      {account.status === "ERROR" && account.lastError && (
        <div
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-100 bg-rose-50/70 px-3 py-2.5 text-[11px] leading-5 text-rose-800"
          role="alert"
        >
          <CircleAlert
            className="mt-0.5 size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span>{account.lastError}</span>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <Clock3 className="size-3" aria-hidden="true" />
          {account.connectedAt
            ? `Connected ${formatDate(account.connectedAt)}`
            : "Connection pending"}
        </p>
        {canManage && (
          <div className="flex items-center gap-2">
            {account.status === "CONNECTING" && account.provider === "MOCK" && (
              <button
                type="button"
                onClick={onContinueMock}
                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-semibold text-indigo-700 transition hover:bg-indigo-100 sm:flex-none"
              >
                <Camera className="size-3.5" aria-hidden="true" />
                Continue mock connection
              </button>
            )}
            {(account.status === "CONNECTED" || account.status === "ERROR") && (
              <button
                type="button"
                onClick={onSync}
                disabled={syncing}
                aria-label={`Sync account ${identity}`}
                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-700 transition hover:border-indigo-200 hover:bg-indigo-50/70 hover:text-indigo-700 disabled:cursor-wait disabled:opacity-50 sm:flex-none"
              >
                {syncing ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {syncing ? "Syncing" : "Sync"}
              </button>
            )}
            {account.status !== "DISCONNECTED" && (
              <button
                type="button"
                onClick={onDisconnect}
                aria-label={`Disconnect account ${identity}`}
                className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-3 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 sm:flex-none"
              >
                <Unplug className="size-3.5" aria-hidden="true" />
                Disconnect
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function StatusBadge({
  status,
  label,
  className,
}: {
  status: InstagramAccountStatus;
  label: string;
  className: string;
}) {
  const Icon =
    status === "CONNECTED"
      ? Check
      : status === "CONNECTING"
        ? LoaderCircle
        : status === "ERROR"
          ? AlertTriangle
          : Unplug;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-semibold ring-1 ring-inset ${className}`}
    >
      <Icon
        className={`size-3 ${status === "CONNECTING" ? "animate-spin" : ""}`}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function MockConnectionDialog({
  code,
  setCode,
  pending,
  onClose,
  onApprove,
}: {
  code: string;
  setCode: (value: string) => void;
  pending: boolean;
  onClose: () => void;
  onApprove: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mock-dialog-title"
        className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/20 sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-fuchsia-50 text-fuchsia-600">
              <Camera className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-indigo-600">
                MOCK provider
              </p>
              <h2
                id="mock-dialog-title"
                className="mt-1 text-base font-semibold tracking-tight text-slate-900"
              >
                Complete mock connection
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
          <p className="text-xs font-semibold text-indigo-900">
            Local development flow
          </p>
          <p className="mt-1.5 text-[11px] leading-5 text-indigo-800">
            No Instagram credentials are needed. Approve this simulated account
            to finish the OAuth callback.
          </p>
        </div>
        <label
          className="mt-5 block text-[11px] font-semibold text-slate-700"
          htmlFor="mock-authorization-code"
        >
          Mock authorization code
        </label>
        <input
          id="mock-authorization-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/10"
        />
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={pending || !code.trim()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-55"
          >
            {pending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            {pending ? "Connecting" : "Simulate approval"}
          </button>
        </div>
      </section>
    </div>
  );
}

function DisconnectDialog({
  account,
  pending,
  onCancel,
  onConfirm,
}: {
  account: InstagramAccount;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      role="presentation"
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="disconnect-title"
        className="w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-6 shadow-2xl shadow-slate-950/20 sm:p-7"
      >
        <span className="flex size-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <Unplug className="size-5" aria-hidden="true" />
        </span>
        <h2
          id="disconnect-title"
          className="mt-4 text-base font-semibold tracking-tight text-slate-900"
        >
          Disconnect Instagram account?
        </h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {account.username
            ? `@${account.username}`
            : account.name || "This account"}{" "}
          will be disconnected from this workspace. You can connect it again
          later.
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="h-10 rounded-xl border border-slate-200 px-4 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Keep account
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-55"
          >
            {pending ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Unplug className="size-3.5" />
            )}
            {pending ? "Disconnecting" : "Disconnect account"}
          </button>
        </div>
      </section>
    </div>
  );
}

function NoticeBanner({
  notice,
  onDismiss,
}: {
  notice: Notice;
  onDismiss: () => void;
}) {
  const isSuccess = notice.tone === "success";
  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border p-4 text-sm ${isSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}
      role={isSuccess ? "status" : "alert"}
    >
      {isSuccess ? (
        <Check className="mt-0.5 size-4 shrink-0" />
      ) : (
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
      )}
      <p className="flex-1 text-xs font-medium leading-5">{notice.message}</p>
      {isSuccess && (
        <ArrowUpRight
          className="mt-0.5 size-3.5 shrink-0 opacity-50"
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded-md p-0.5 opacity-60 transition hover:bg-black/5 hover:opacity-100"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}
