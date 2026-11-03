'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { CurrentUser } from '@/lib/api/types';

const SessionContext = createContext<CurrentUser | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: CurrentUser;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): CurrentUser {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside the protected app layout.');
  return session;
}
