'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarDays,
  Check,
  CircleUserRound,
  Clock3,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState } from '@/components/ui/states';
import { backendRequest } from '@/lib/api/client';
import type { CurrentUser, OrganizationMember } from '@/lib/api/types';
import { canManageTeam, roleLabel } from '@/lib/auth/permissions';

export default function DashboardPage() {
  const initialSession = useSession();
  const sessionQuery = useQuery({
    queryKey: ['session'],
    queryFn: () => backendRequest<CurrentUser>('auth/me'),
    initialData: initialSession,
  });
  const session = sessionQuery.data;
  const role = session.membership.role;
  const canManage = canManageTeam(role);
  const membersQuery = useQuery({
    queryKey: ['organization-members', session.membership.organization.id],
    queryFn: () =>
      backendRequest<OrganizationMember[]>(
        `organizations/${session.membership.organization.id}/members`,
      ),
    enabled: canManage,
  });

  if (sessionQuery.isLoading) return <LoadingState />;
  if (sessionQuery.isError) {
    return (
      <InlineError
        message={sessionQuery.error.message}
        retry={() => void sessionQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">
            <span className="size-1.5 rounded-full bg-indigo-600" />
            Workspace overview
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">
            Welcome back<span className="text-indigo-600">.</span>
          </h1>
          <p className="mt-2 text-sm text-slate-500">Here’s a clear view of your workspace and access.</p>
        </div>
        {canManage && (
          <Link
            href="/team"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            Manage team <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      <section className="relative overflow-hidden rounded-[24px] bg-[#171a35] px-6 py-7 text-white shadow-xl shadow-indigo-950/10 sm:px-8 sm:py-8">
        <div className="pointer-events-none absolute -right-12 -top-24 size-72 rounded-full border border-white/[0.07]" />
        <div className="pointer-events-none absolute -right-2 -top-14 size-52 rounded-full border border-white/[0.08]" />
        <div className="pointer-events-none absolute right-20 top-10 size-24 rounded-full bg-indigo-500/15 blur-2xl" />
        <div className="relative z-10 flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="max-w-xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-medium text-indigo-100">
              <Workflow className="size-3.5" aria-hidden="true" />
              Your workspace is ready
            </div>
            <h2 className="max-w-lg text-[24px] font-semibold leading-[1.2] tracking-[-0.035em] sm:text-[30px]">
              A secure home for your team’s work.
            </h2>
            <p className="mt-3 max-w-md text-[13px] leading-6 text-slate-300">
              Your organization, membership and access controls are set up. You can manage your team from one place.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3.5 backdrop-blur-sm lg:min-w-[220px]">
            <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-200">
              <ShieldCheck className="size-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.11em] text-slate-400">Access level</span>
              <span className="mt-1 block text-sm font-semibold text-white">{roleLabel(role)}</span>
            </span>
          </div>
        </div>
      </section>

      <section aria-label="Workspace details" className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          icon={<Building2 className="size-[17px]" aria-hidden="true" />}
          label="Organization"
          value={session.membership.organization.name}
          detail="Your current workspace"
          accent="indigo"
        />
        <SummaryCard
          icon={<CircleUserRound className="size-[17px]" aria-hidden="true" />}
          label="Your role"
          value={roleLabel(role)}
          detail={canManage ? 'Can manage team access' : 'Member access'}
          accent="violet"
        />
        <SummaryCard
          icon={<Users className="size-[17px]" aria-hidden="true" />}
          label="Team members"
          value={canManage ? membersQuery.data?.length?.toString() ?? '—' : 'Managed by admins'}
          detail={canManage ? 'People in this organization' : 'Ask an admin about your team'}
          accent="blue"
          loading={canManage && membersQuery.isLoading}
        />
      </section>

      {membersQuery.isError && canManage && (
        <InlineError
          message={membersQuery.error.message}
          retry={() => void membersQuery.refetch()}
        />
      )}

      <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
        <div className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.02] sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-slate-900">Workspace setup</p>
              <p className="mt-1 text-xs text-slate-500">Your foundation is in place.</p>
            </div>
            <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Check className="size-4" strokeWidth={2.5} aria-hidden="true" />
            </span>
          </div>
          <div className="mt-6 space-y-4">
            <SetupRow title="Organization created" detail={session.membership.organization.name} complete />
            <SetupRow title="Your account is active" detail={session.email} complete />
            <SetupRow
              title="Access permissions assigned"
              detail={`${roleLabel(role)} role`}
              complete
            />
          </div>
          {canManage && (
            <Link
              href="/team"
              className="mt-6 inline-flex items-center gap-2 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
            >
              Review team access <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>

        <div className="rounded-[22px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.02] sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[15px] font-semibold tracking-tight text-slate-900">Recent activity</p>
              <p className="mt-1 text-xs text-slate-500">Updates from your workspace</p>
            </div>
            <Clock3 className="size-[17px] text-slate-400" aria-hidden="true" />
          </div>
          <div className="mt-6 flex min-h-[178px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm ring-1 ring-slate-200/70">
              <CalendarDays className="size-[17px]" aria-hidden="true" />
            </span>
            <p className="mt-3 text-xs font-semibold text-slate-700">Nothing to show yet</p>
            <p className="mt-1 max-w-[230px] text-[11px] leading-5 text-slate-500">
              Workspace activity will appear here as your team gets started.
            </p>
          </div>
        </div>
      </section>
      <p className="text-center text-[10px] text-slate-400">Account and organization details are loaded from your workspace API.</p>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  accent,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  accent: 'indigo' | 'violet' | 'blue';
  loading?: boolean;
}) {
  const accentClass = {
    indigo: 'bg-indigo-50 text-indigo-600',
    violet: 'bg-violet-50 text-violet-600',
    blue: 'bg-sky-50 text-sky-600',
  }[accent];

  return (
    <div className="rounded-[20px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.02]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={`flex size-8 items-center justify-center rounded-lg ${accentClass}`}>{icon}</span>
      </div>
      <p className="mt-5 truncate text-[19px] font-semibold tracking-tight text-slate-900">
        {loading ? '…' : value}
      </p>
      <p className="mt-1.5 truncate text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

function SetupRow({ title, detail, complete }: { title: string; detail: string; complete: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
        <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-slate-800">{title}</span>
        <span className="mt-1 block truncate text-[11px] text-slate-500">{detail}</span>
      </span>
      <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-700">Ready</span>
    </div>
  );
}
