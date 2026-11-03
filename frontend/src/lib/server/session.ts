import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { CurrentUser } from '@/lib/api/types';
import { backendUrl } from '@/lib/server/backend';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/server/session-cookies';

export async function requireSession(returnTo = '/dashboard'): Promise<CurrentUser> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;

  if (!accessToken) {
    if (refreshToken) redirect(`/api/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`);
    redirect('/login');
  }

  let response: Response;
  try {
    response = await fetch(backendUrl('auth/me'), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    throw new Error('The workspace service is unavailable. Try again in a moment.');
  }

  if (response.status === 401) {
    if (refreshToken) redirect(`/api/auth/refresh?returnTo=${encodeURIComponent(returnTo)}`);
    redirect('/login');
  }
  if (!response.ok) throw new Error('Could not load your workspace session.');

  return (await response.json()) as CurrentUser;
}
