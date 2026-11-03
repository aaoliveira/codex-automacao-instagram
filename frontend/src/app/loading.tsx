import { LoaderCircle } from 'lucide-react';

export default function Loading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7fb] text-sm text-slate-500">
      <span className="flex items-center gap-3">
        <LoaderCircle className="size-5 animate-spin text-indigo-600" aria-hidden="true" />
        Loading your workspace
      </span>
    </main>
  );
}
