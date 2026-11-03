import type { ApiErrorBody } from '@/lib/api/types';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function getMessage(body: ApiErrorBody | null, fallback: string): string {
  if (Array.isArray(body?.message)) return body.message.join(' ');
  return body?.message || fallback;
}

export async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  headers.set('Accept', 'application/json');

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: 'no-store', credentials: 'same-origin' });
  } catch {
    const error = new ApiClientError('The service could not be reached. Check that the backend is running.', 0);
    notifyGlobalError(error.message);
    throw error;
  }

  const body = (await response.json().catch(() => null)) as (T & ApiErrorBody) | null;
  if (!response.ok) {
    const error = new ApiClientError(getMessage(body, 'The request could not be completed.'), response.status);
    notifyGlobalError(error.message);
    throw error;
  }

  return body as T;
}

export function backendRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const normalized = path.replace(/^\/+/, '');
  return apiRequest<T>(`/api/backend/${normalized}`, init);
}

function notifyGlobalError(message: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:api-error', { detail: { message } }));
  }
}
