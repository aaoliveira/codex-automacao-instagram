import { NextRequest } from 'next/server';
import { handleRefresh } from '@/lib/server/auth-handlers';

export function GET(request: NextRequest) {
  return handleRefresh(request, true);
}

export function POST(request: NextRequest) {
  return handleRefresh(request);
}
