'use client';

import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/components/session-context';
import { InlineError, LoadingState, NoWorkspaceAccess } from '@/components/ui/states';
import { backendRequest } from '@/lib/api/client';
import type { OrganizationMember } from '@/lib/api/types';
import { canManageTeam, roleLabel } from '@/lib/auth/permissions';

export default function TeamPage() {
  const session = useSession();
  const [search, setSearch] = useState('');
  const allowed = canManageTeam(session.membership.role);
  const membersQuery = useQuery({
    queryKey: ['organization-members', session.membership.organization.id],
    queryFn: () =>
      backendRequest<OrganizationMember[]>(
        `organizations/${session.membership.organization.id}/members`,
      ),
    enabled: allowed,
  });
  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (membersQuery.data ?? []).filter((member) => member.user.email.toLowerCase().includes(query));
  }, [membersQuery.data, search]);

  if (!allowed) return <NoWorkspaceAccess />;

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">Organization</p>
          <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[34px]">Team access</h1>
          <p className="mt-2 text-sm text-slate-500">People and roles in {session.membership.organization.name}.</p>
        </div>
        <div className="inline-flex h-9 items-center gap-2 self-start rounded-full border border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-600 sm:self-auto">
          <Users className="size-3.5 text-indigo-600" aria-hidden="true" />
          {membersQuery.data?.length ?? 0} members
        </div>
      </div>

      <div className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm shadow-slate-900/[0.02]">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:px-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Members</h2>
            <p className="mt-1 text-[11px] text-slate-500">Roles determine which workspace tools are available.</p>
          </div>
          <label className="relative block w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a team member"
              aria-label="Find a team member"
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:bg-white focus:ring-4 focus:ring-indigo-500/10"
            />
          </label>
        </div>

        {membersQuery.isLoading ? (
          <LoadingState label="Loading team members" />
        ) : membersQuery.isError ? (
          <div className="p-5 sm:p-6">
            <InlineError message={membersQuery.error.message} retry={() => void membersQuery.refetch()} />
          </div>
        ) : filteredMembers.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <Users className="size-5" aria-hidden="true" />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-800">No matching members</p>
            <p className="mt-1 text-xs text-slate-500">Try another email address.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="bg-slate-50/70 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <th className="px-6 py-3.5">Member</th>
                  <th className="px-6 py-3.5">Role</th>
                  <th className="px-6 py-3.5">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.map((member) => (
                  <tr key={member.user.id} className="transition hover:bg-slate-50/70">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
                          {member.user.email.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          <span className="block max-w-xs truncate text-xs font-semibold text-slate-800">{member.user.email}</span>
                          {member.user.id === session.id && <span className="mt-0.5 block text-[10px] text-slate-400">You</span>}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <RoleBadge role={member.role} />
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(member.createdAt))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t border-slate-100 px-6 py-3.5 text-[10px] text-slate-400">
          <span>Access is enforced by your organization role.</span>
          <span className="font-medium text-slate-500">{roleLabel(session.membership.role)}</span>
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: OrganizationMember['role'] }) {
  const className = {
    OWNER: 'bg-violet-50 text-violet-700 ring-violet-600/10',
    ADMIN: 'bg-indigo-50 text-indigo-700 ring-indigo-600/10',
    MEMBER: 'bg-slate-100 text-slate-600 ring-slate-500/10',
  }[role];

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset ${className}`}>
      {roleLabel(role)}
    </span>
  );
}
