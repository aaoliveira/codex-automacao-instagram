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
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
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

export function uploadRequest<T>(
  url: string,
  body: FormData,
  onProgress?: (percentage: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.withCredentials = true;
    request.setRequestHeader('Accept', 'application/json');
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => {
      const payload = parseResponse<T & ApiErrorBody>(request.responseText);
      if (request.status >= 200 && request.status < 300) {
        resolve(payload as T);
        return;
      }
      const error = new ApiClientError(getMessage(payload, 'The upload could not be completed.'), request.status);
      notifyGlobalError(error.message);
      reject(error);
    });
    request.addEventListener('error', () => {
      const error = new ApiClientError('The service could not be reached. Check that the backend is running.', 0);
      notifyGlobalError(error.message);
      reject(error);
    });
    request.addEventListener('abort', () => reject(new ApiClientError('The upload was canceled.', 0)));
    request.send(body);
  });
}

export function backendRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const normalized = path.replace(/^\/+/, '');
  return apiRequest<T>(`/api/backend/${normalized}`, init);
}

function parseResponse<T>(responseText: string): T | null {
  try {
    return JSON.parse(responseText) as T;
  } catch {
    return null;
  }
}

function notifyGlobalError(message: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:api-error', { detail: { message } }));
  }
}
