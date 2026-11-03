import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import type { ApiErrorBody, AuthResult } from '@/lib/api/types';
import { backendUrl } from '@/lib/server/backend';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  type BackendTokenResponse,
} from '@/lib/server/session-cookies';

type AuthAction = 'login' | 'register';

export async function handleCredentialAuth(request: NextRequest, action: AuthAction) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Enter valid form details.' }, { status: 400 });
  }

  try {
    const upstream = await fetch(backendUrl(`auth/${action}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const payload = (await upstream.json().catch(() => null)) as
      | (BackendTokenResponse & AuthResult & ApiErrorBody)
      | null;

    if (!upstream.ok || !payload?.accessToken || !payload.refreshToken) {
      return noStoreJson(
        { message: getErrorMessage(payload, 'Authentication could not be completed.') },
        upstream.status || 502,
      );
    }

    const response = noStoreJson<AuthResult>(
      {
        user: payload.user,
        organizationId: payload.organizationId,
        role: payload.role,
      },
      upstream.status,
    );
    setTokenCookies(response, payload);
    return response;
  } catch {
    return noStoreJson({ message: 'The workspace service is unavailable. Try again in a moment.' }, 502);
  }
}

export async function handleRefresh(request: NextRequest, redirectAfter = false) {
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get('returnTo'));
  if (!refreshToken) {
    return redirectAfter
      ? redirectToLogin(request, returnTo)
      : noStoreJson({ message: 'Your session has expired. Sign in again.' }, 401);
  }

  try {
    const upstream = await fetch(backendUrl('auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    const tokens = (await upstream.json().catch(() => null)) as BackendTokenResponse | null;

    if (!upstream.ok || !tokens?.accessToken || !tokens.refreshToken) {
      return redirectAfter
        ? redirectToLogin(request, returnTo)
        : clearCookies(noStoreJson({ message: 'Your session has expired. Sign in again.' }, 401));
    }

    if (redirectAfter) {
      const response = NextResponse.redirect(new URL(returnTo, request.url));
      setTokenCookies(response, tokens);
      return response;
    }

    const response = noStoreJson({ success: true });
    setTokenCookies(response, tokens);
    return response;
  } catch {
    return noStoreJson({ message: 'The workspace service is unavailable. Try again in a moment.' }, 502);
  }
}

export async function handleLogout(request: NextRequest) {
  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      let response = accessToken
        ? await sendLogout(accessToken, refreshToken)
        : null;
      if (!response || response.status === 401) {
        const rotated = await rotateRefreshToken(refreshToken);
        if (rotated) {
          accessToken = rotated.accessToken;
          response = await sendLogout(accessToken, rotated.refreshToken);
        }
      }
    } catch {
      // The browser session is cleared even if the backend cannot be reached.
    }
  }

  return clearCookies(noStoreJson({ success: true }));
}

async function sendLogout(accessToken: string, refreshToken: string): Promise<Response> {
  return fetch(backendUrl('auth/logout'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
}

export async function proxyBackendRequest(request: NextRequest, rawSegments: string[]) {
  const segments = rawSegments.filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return noStoreJson({ message: 'Invalid API path.' }, 400);
  }

  const path = segments.map(encodeURIComponent).join('/');
  if (!path) return noStoreJson({ message: 'Invalid API path.' }, 400);

  const cookieStore = request.cookies;
  let accessToken = cookieStore.get(ACCESS_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_COOKIE)?.value;
  const method = request.method.toUpperCase();
  const incoming = new URL(request.url);
  const target = backendUrl(path) + incoming.search;
  let body = method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer();
  if (path === 'auth/logout') {
    const supplied = body?.byteLength ? JSON.parse(new TextDecoder().decode(body)) : {};
    body = new TextEncoder()
      .encode(JSON.stringify({ ...supplied, refreshToken }))
      .buffer;
  }

  let rotatedTokens: BackendTokenResponse | null = null;
  let upstream: Response;
  try {
    if (!accessToken && refreshToken && !path.startsWith('auth/')) {
      rotatedTokens = await rotateRefreshToken(refreshToken);
      accessToken = rotatedTokens?.accessToken;
    }

    upstream = await sendToBackend(target, method, body, accessToken);
    if (upstream.status === 401 && refreshToken && !path.startsWith('auth/')) {
      rotatedTokens = await rotateRefreshToken(refreshToken);
      if (rotatedTokens) {
        accessToken = rotatedTokens.accessToken;
        upstream = await sendToBackend(target, method, body, accessToken);
      }
    }
  } catch {
    return noStoreJson({ message: 'The workspace service is unavailable. Try again in a moment.' }, 502);
  }

  const payload = await upstream.json().catch(() => null);
  const response = upstream.status === 204
    ? new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
    : noStoreJson(payload, upstream.status);

  if (rotatedTokens) setTokenCookies(response, rotatedTokens);
  if (path === 'auth/logout' && upstream.ok) clearCookies(response);
  return response;
}

async function rotateRefreshToken(refreshToken: string): Promise<BackendTokenResponse | null> {
  try {
    const response = await fetch(backendUrl('auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    const payload = (await response.json().catch(() => null)) as BackendTokenResponse | null;
    if (!response.ok || !payload?.accessToken || !payload.refreshToken) return null;
    return payload;
  } catch {
    return null;
  }
}

async function sendToBackend(
  url: string,
  method: string,
  body: ArrayBuffer | undefined,
  accessToken: string | undefined,
): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' });
  if (body) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(url, { method, headers, body, cache: 'no-store', redirect: 'manual' });
}

function setTokenCookies(response: NextResponse, tokens: BackendTokenResponse): void {
  const secure = process.env.NODE_ENV === 'production';
  const common = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    ...common,
    maxAge: parseDurationSeconds(tokens.expiresIn) ?? 15 * 60,
  });
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...common,
    maxAge: 30 * 24 * 60 * 60,
  });
  response.headers.set('Cache-Control', 'no-store');
}

function clearCookies(response: NextResponse): NextResponse {
  const common = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
  response.cookies.set(ACCESS_COOKIE, '', { ...common, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { ...common, maxAge: 0 });
  return response;
}

function parseDurationSeconds(value: string | undefined): number | null {
  const match = value?.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const factor = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return amount * factor;
}

function getErrorMessage(body: ApiErrorBody | null, fallback: string): string {
  if (Array.isArray(body?.message)) return body.message.join(' ');
  return body?.message || fallback;
}

function noStoreJson<T>(body: T, status = 200): NextResponse<T> {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function safeReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/api/')) {
    return '/dashboard';
  }
  return value;
}

function redirectToLogin(request: NextRequest, returnTo: string): NextResponse {
  const destination = new URL('/login', request.url);
  destination.searchParams.set('returnTo', returnTo);
  destination.searchParams.set('reason', 'session_expired');
  return clearCookies(NextResponse.redirect(destination));
}
