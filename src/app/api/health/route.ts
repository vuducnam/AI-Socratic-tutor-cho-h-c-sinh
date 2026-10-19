// Health check không trả dữ liệu (quy tắc cứng 11).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
