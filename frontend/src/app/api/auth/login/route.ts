import { NextRequest } from 'next/server';
import { handleCredentialAuth } from '@/lib/server/auth-handlers';

export function POST(request: NextRequest) {
  return handleCredentialAuth(request, 'login');
}
