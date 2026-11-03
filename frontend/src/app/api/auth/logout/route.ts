import { NextRequest } from 'next/server';
import { handleLogout } from '@/lib/server/auth-handlers';

export function POST(request: NextRequest) {
  return handleLogout(request);
}
