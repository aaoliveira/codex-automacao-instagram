import 'server-only';

export function backendUrl(path: string): string {
  const origin = process.env.BACKEND_API_URL;
  if (!origin) throw new Error('BACKEND_API_URL is not configured.');
  const base = `${origin.replace(/\/+$/, '')}/api/`;
  return new URL(path.replace(/^\/+/, ''), base).toString();
}
