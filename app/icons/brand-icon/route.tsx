import { createBrandIconResponse } from '@/src/features/branding/api/brand-icon';

export const runtime = 'edge';

export function GET(request: Request) {
  const url = new URL(request.url);
  const requestedSize = Number(url.searchParams.get('size') || 512);
  const size = [180, 192, 512].includes(requestedSize) ? requestedSize : 512;
  const maskable = url.searchParams.get('maskable') === 'true';
  return createBrandIconResponse(size, maskable);
}
