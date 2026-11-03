'use client';

import {
  ArrowUpRight,
  Building2,
  Camera,
  CalendarClock,
  ChevronDown,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  Images,
  MessageSquareText,
  PenSquare,
  ShieldCheck,
  Users,
  Workflow,
  X,
} from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SessionProvider, useSession } from '@/components/session-context';
import { apiRequest } from '@/lib/api/client';
import type { CurrentUser } from '@/lib/api/types';
import { canManageTeam, roleLabel } from '@/lib/auth/permissions';

const navigation = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/instagram/accounts', label: 'Instagram accounts', icon: Camera },
  { href: '/media', label: 'Media library', icon: Images },
  { href: '/instagram/compose', label: 'Composer', icon: PenSquare },
  { href: '/instagram/publications', label: 'Publishing history', icon: Clock3 },
  { href: '/instagram/scheduler', label: 'Scheduler', icon: CalendarClock, ownerOnly: true },
  { href: '/instagram/events', label: 'Events inbox', icon: MessageSquareText },
  { href: '/automations', label: 'Automations', icon: Workflow },
  { href: '/team', label: 'Team', icon: Users, ownerOnly: true },
];

export function ProtectedAppShell({
  session,
  children,
}: {
  session: CurrentUser;
  children: React.ReactNode;
}) {
  return (
    <SessionProvider session={session}>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const role = session.membership.role;
  const organization = session.membership.organization;
  const initials = session.email.slice(0, 1).toUpperCase();

  async function signOut() {
    setSigningOut(true);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
      queryClient.clear();
      router.replace('/login');
      router.refresh();
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-900">
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-slate-200/80 bg-white transition-transform duration-200 lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-[76px] items-center justify-between border-b border-slate-100 px-6">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={() => setMobileOpen(false)}>
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-600/20">
              <Workflow className="size-[18px]" strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">Social Console</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-4 pt-6">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Workspace</p>
          <div className="mb-7 flex items-center gap-3 rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200/70">
              <Building2 className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold text-slate-800">{organization.name}</span>
              <span className="mt-0.5 block text-[11px] text-slate-500">{roleLabel(role)} workspace</span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          </div>

          <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Manage</p>
          <nav aria-label="Main navigation" className="space-y-1">
            {navigation
              .filter((item) => !item.ownerOnly || canManageTeam(role))
              .map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    href={item.href}
                    key={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition ${active ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                  >
                    <Icon className={`size-[17px] ${active ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'}`} aria-hidden="true" />
                    {item.label}
                    {active && <span className="ml-auto size-1.5 rounded-full bg-indigo-600" />}
                  </Link>
                );
              })}
          </nav>
        </div>

        <div className="mt-auto px-4 pb-4">
          <div className="rounded-2xl bg-slate-900 p-4 text-white">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-indigo-200">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              Secure workspace
            </div>
            <p className="mt-2 text-[12px] leading-5 text-slate-300">Your organization access is managed by your role.</p>
            <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-[10px] text-slate-400">
              <span>Access level</span>
              <span className="font-semibold text-white">{roleLabel(role)}</span>
            </div>
          </div>
          <p className="px-2 pt-4 text-[10px] text-slate-400">Social Console · Workspace tools</p>
        </div>
      </aside>

      <div className="min-h-screen lg:pl-[264px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="rounded-xl border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 lg:hidden"
            >
              <Menu className="size-4" />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Your workspace</p>
              <p className="max-w-[42vw] truncate text-sm font-semibold text-slate-800 sm:max-w-none">{organization.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <div className="hidden text-right sm:block">
              <p className="max-w-52 truncate text-[12px] font-semibold text-slate-800">{session.email}</p>
              <p className="mt-0.5 text-[10px] text-slate-500">{roleLabel(role)}</p>
            </div>
            <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-bold text-white ring-2 ring-white shadow-sm">
              {initials}
            </div>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
            >
              <LogOut className="size-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">{signingOut ? 'Signing out' : 'Sign out'}</span>
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-7 sm:px-7 sm:py-9 lg:px-10">{children}</main>
        <footer className="mx-auto flex max-w-[1440px] items-center justify-between px-4 pb-7 text-[11px] text-slate-400 sm:px-7 lg:px-10">
          <span>© {new Date().getFullYear()} Social Console</span>
          <a className="inline-flex items-center gap-1.5 transition hover:text-slate-600" href="mailto:support@example.com">
            Workspace support <ArrowUpRight className="size-3" aria-hidden="true" />
          </a>
        </footer>
      </div>
    </div>
  );
}
