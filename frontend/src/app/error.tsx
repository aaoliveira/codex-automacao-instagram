'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7fb] px-5">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">This page hit a problem</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Your information is safe. Try loading the page again.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </button>
      </div>
    </main>
  );
}
