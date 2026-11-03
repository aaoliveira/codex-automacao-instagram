import { ArrowLeft, SearchX } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7fb] px-5">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <SearchX className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.13em] text-indigo-600">404 · Page not found</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900">We can’t find that page.</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">The link may be outdated, or the page may have moved.</p>
        <Link href="/dashboard" className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white transition hover:bg-indigo-700">
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Back to workspace
        </Link>
      </div>
    </main>
  );
}
