import { AlertCircle, LoaderCircle, ShieldAlert } from 'lucide-react';

export function LoadingState({ label = 'Loading your workspace' }: { label?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-sm text-slate-500" role="status">
      <LoaderCircle className="size-6 animate-spin text-indigo-600" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function InlineError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">We couldn’t load this information.</p>
        <p className="mt-1 text-rose-700">{message}</p>
        {retry && (
          <button type="button" onClick={retry} className="mt-3 font-semibold underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function NoWorkspaceAccess() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center rounded-3xl border border-slate-200 bg-white px-8 py-12 text-center shadow-sm">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-slate-900">You don’t have access to this page</h1>
      <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
        Ask an organization owner or admin if you need access to team details.
      </p>
    </div>
  );
}
