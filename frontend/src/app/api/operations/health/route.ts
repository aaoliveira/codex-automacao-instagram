import { NextResponse } from 'next/server';

type DependencyState = 'ok' | 'unavailable';

interface BackendReadiness {
  status?: string;
  dependencies?: {
    postgres?: string;
    redis?: string;
  };
}

export async function GET() {
  const origin = process.env.BACKEND_API_URL;
  if (!origin) return jsonUnavailable();

  const [apiResult, readinessResult] = await Promise.all([
    fetchHealth(new URL('/health', origin)),
    fetchHealth(new URL('/ready', origin)),
  ]);
  const readiness = readinessResult.body;

  return NextResponse.json(
    {
      api: apiResult.ok ? 'ok' : 'unavailable',
      postgres: dependencyState(readiness?.dependencies?.postgres),
      redis: dependencyState(readiness?.dependencies?.redis),
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

async function fetchHealth(url: URL): Promise<{ ok: boolean; body: BackendReadiness | null }> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    const body = (await response.json().catch(() => null)) as BackendReadiness | null;
    return { ok: response.ok && body?.status === 'ok', body };
  } catch {
    return { ok: false, body: null };
  }
}

function dependencyState(value: string | undefined): DependencyState {
  return value === 'ok' ? 'ok' : 'unavailable';
}

function jsonUnavailable() {
  return NextResponse.json(
    {
      api: 'unavailable',
      postgres: 'unavailable',
      redis: 'unavailable',
      checkedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
