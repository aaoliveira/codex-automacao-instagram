'use client';

import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { AlertCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export function GlobalApiFeedback() {
  const activeRequests = useIsFetching() + useIsMutating();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleError = (event: Event) => {
      const customEvent = event as CustomEvent<{ message?: string }>;
      setMessage(customEvent.detail?.message || 'Something went wrong. Please try again.');
    };
    window.addEventListener('app:api-error', handleError);
    return () => window.removeEventListener('app:api-error', handleError);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  return (
    <>
      {activeRequests > 0 && (
        <div className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden" aria-label="Loading">
          <div className="h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] rounded-full bg-indigo-600" />
        </div>
      )}
      {message && (
        <div
          className="fixed bottom-5 right-5 z-[100] flex max-w-sm items-start gap-3 rounded-2xl border border-rose-200 bg-white px-4 py-3.5 text-sm text-slate-700 shadow-xl shadow-slate-900/10"
          role="alert"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden="true" />
          <p className="flex-1 leading-5">{message}</p>
          <button
            type="button"
            onClick={() => setMessage(null)}
            aria-label="Dismiss notification"
            className="rounded-md p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
    </>
  );
}
