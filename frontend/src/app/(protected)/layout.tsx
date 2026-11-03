import { ProtectedAppShell } from '@/components/app-shell';
import { requireSession } from '@/lib/server/session';

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireSession('/dashboard');
  return <ProtectedAppShell session={session}>{children}</ProtectedAppShell>;
}
