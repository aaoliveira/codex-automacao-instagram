'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { GlobalApiFeedback } from '@/components/global-api-feedback';
import { ApiClientError } from '@/lib/api/client';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (failureCount, error) =>
              error instanceof ApiClientError && error.status >= 400
                ? false
                : failureCount < 1,
          },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <GlobalApiFeedback />
      {children}
    </QueryClientProvider>
  );
}
