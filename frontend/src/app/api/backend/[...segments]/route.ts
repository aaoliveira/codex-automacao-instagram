import { NextRequest } from 'next/server';
import { proxyBackendRequest } from '@/lib/server/auth-handlers';

type RouteContext = { params: Promise<{ segments: string[] }> };

async function handle(request: NextRequest, context: RouteContext) {
  const { segments } = await context.params;
  return proxyBackendRequest(request, segments);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
