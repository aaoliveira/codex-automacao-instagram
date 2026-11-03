'use client';

import { ArrowRight, Building2, LoaderCircle, LockKeyhole, Mail, Workflow } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { apiRequest, ApiClientError } from '@/lib/api/client';
import type { AuthResult } from '@/lib/api/types';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === 'register';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(form.entries());
    if (!isRegister && !data.organizationId) delete data.organizationId;

    try {
      await apiRequest<AuthResult>(`/api/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      router.replace('/dashboard');
      router.refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ApiClientError
          ? requestError.message
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden overflow-hidden bg-[#171a35] px-12 py-10 text-white lg:flex lg:flex-col xl:px-16">
        <div className="absolute -right-40 top-28 size-[520px] rounded-full border border-white/[0.07]" />
        <div className="absolute -right-20 top-48 size-[360px] rounded-full border border-white/[0.08]" />
        <div className="absolute left-20 top-1/2 size-64 rounded-full bg-indigo-500/10 blur-[90px]" />
        <Link href="/login" className="relative z-10 flex w-fit items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/20">
            <Workflow className="size-5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Social Console</span>
        </Link>

        <div className="relative z-10 my-auto max-w-lg pb-10">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[10px] font-medium text-indigo-100">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Workspace access, made simple
          </span>
          <h1 className="text-[44px] font-semibold leading-[1.08] tracking-[-0.05em] xl:text-[52px]">
            Your team’s work, <span className="text-indigo-300">in one place.</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-slate-300">
            A secure workspace for your organization, team and shared operations.
          </p>
          <div className="mt-10 grid max-w-md grid-cols-2 gap-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <LockKeyhole className="size-4 text-indigo-300" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold">Private by design</p>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">Protected sign-in and server-managed sessions.</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-4">
              <Building2 className="size-4 text-indigo-300" aria-hidden="true" />
              <p className="mt-3 text-xs font-semibold">Built for teams</p>
              <p className="mt-1 text-[10px] leading-5 text-slate-400">Organization membership and role-based access.</p>
            </div>
          </div>
        </div>
        <p className="relative z-10 text-[10px] text-slate-500">© {new Date().getFullYear()} Social Console</p>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-[400px]">
          <Link href="/login" className="mb-10 inline-flex items-center gap-2.5 lg:hidden">
            <span className="flex size-9 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <Workflow className="size-[17px]" aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900">Social Console</span>
          </Link>
          <div className="mb-8">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-600">
              {isRegister ? 'Get started' : 'Welcome back'}
            </p>
            <h2 className="text-[30px] font-semibold tracking-[-0.04em] text-slate-950">
              {isRegister ? 'Create your workspace' : 'Sign in to your account'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              {isRegister
                ? 'Set up your organization and invite your team when they have an account.'
                : 'Enter your details to continue to your workspace.'}
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {isRegister && (
              <Field label="Organization name" name="organizationName" placeholder="Acme Studio" icon="workspace" required autoComplete="organization" />
            )}
            <Field label="Email address" name="email" placeholder="you@company.com" icon="email" type="email" required autoComplete="email" />
            <Field
              label="Password"
              name="password"
              placeholder={isRegister ? 'At least 12 characters' : 'Enter your password'}
              icon="password"
              type="password"
              required
              minLength={isRegister ? 12 : undefined}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />
            {!isRegister && (
              <details className="group rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-xs text-slate-500">
                <summary className="cursor-pointer list-none font-medium text-slate-600 marker:hidden">
                  Belong to more than one organization?
                </summary>
                <label className="mt-3 block text-[11px] font-medium text-slate-600" htmlFor="organizationId">
                  Organization ID
                </label>
                <input
                  id="organizationId"
                  name="organizationId"
                  placeholder="Optional organization UUID"
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs outline-none transition placeholder:text-slate-400 focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/10"
                />
              </details>
            )}

            {error && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-5 text-rose-700" role="alert">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={pending}
              className="group mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-md shadow-indigo-600/15 transition hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
              {pending ? 'Please wait' : isRegister ? 'Create workspace' : 'Sign in'}
              {!pending && <ArrowRight className="size-4 transition group-hover:translate-x-0.5" aria-hidden="true" />}
            </button>
          </form>

          <p className="mt-7 text-center text-xs text-slate-500">
            {isRegister ? 'Already have an account?' : 'New to Social Console?'}{' '}
            <Link
              href={isRegister ? '/login' : '/register'}
              className="font-semibold text-indigo-700 hover:text-indigo-900"
            >
              {isRegister ? 'Sign in' : 'Create an account'}
            </Link>
          </p>
          <p className="mt-9 text-center text-[10px] leading-5 text-slate-400">
            By continuing, you agree to your organization’s access and security policies.
          </p>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  name,
  placeholder,
  icon,
  type = 'text',
  required = false,
  minLength,
  autoComplete,
}: {
  label: string;
  name: string;
  placeholder: string;
  icon: 'workspace' | 'email' | 'password';
  type?: string;
  required?: boolean;
  minLength?: number;
  autoComplete?: string;
}) {
  const Icon = icon === 'workspace' ? Building2 : icon === 'email' ? Mail : LockKeyhole;
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          id={name}
          name={name}
          type={type}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-3.5 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10"
        />
      </div>
    </div>
  );
}
