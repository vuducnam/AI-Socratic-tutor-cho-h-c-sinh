import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';
import * as adminActions from '@/app/(admin)/admin/(protected)/actions';

// Quy tắc cứng 11: container app (ADMIN_ENABLED=false) trả 404 cho /admin; Server Action quản trị không
// dựa vào proxy mà tự gọi assertAdminRuntime() → 404 khi không có runtime admin.

const original = process.env.ADMIN_ENABLED;
afterEach(() => {
  process.env.ADMIN_ENABLED = original;
});

const req = (path: string, cookies: Record<string, string> = {}) => {
  const r = new NextRequest(new URL(path, 'http://localhost:3000'));
  for (const [k, v] of Object.entries(cookies)) r.cookies.set(k, v);
  return r;
};

describe('proxy', () => {
  it.each(['/admin', '/admin/login', '/admin/students/x/progress', '/admin/api/login'])(
    'ADMIN_ENABLED=false → %s trả 404',
    async (path) => {
      process.env.ADMIN_ENABLED = 'false';
      expect(proxy(req(path)).status).toBe(404);
    },
  );

  it('ADMIN_ENABLED=true, chưa đăng nhập admin → chuyển tới /admin/login', () => {
    process.env.ADMIN_ENABLED = 'true';
    const res = proxy(req('/admin'));
    expect(res.headers.get('location')).toMatch(/\/admin\/login$/);
  });

  it.each(['/learn', '/parent', '/parent/sessions'])('%s cần phiên → chuyển tới /login', (path) => {
    expect(proxy(req(path)).headers.get('location')).toMatch(/\/login$/);
  });

  it('API dữ liệu không có phiên → 401', async () => {
    expect(proxy(req('/api/export')).status).toBe(401);
  });

  it.each(['/login', '/api/health', '/api/auth/student-login'])('%s mở không cần phiên', (path) => {
    expect(proxy(req(path)).headers.get('x-middleware-next')).toBe('1');
  });
});

describe('Server Action quản trị khi ADMIN_ENABLED=false', () => {
  const actions = Object.entries(adminActions).filter(([, v]) => typeof v === 'function') as [
    string,
    (form?: FormData) => Promise<unknown>,
  ][];

  it('có action để kiểm', () => {
    expect(actions.length).toBeGreaterThan(5);
  });

  it.each(actions.filter(([name]) => name !== 'adminLogoutAction'))('%s → 404', async (_name, action) => {
    process.env.ADMIN_ENABLED = 'false';
    const error = await action(new FormData()).then(
      () => null,
      (err: unknown) => err,
    );
    expect(String((error as { digest?: string } | null)?.digest ?? error)).toMatch(/404/);
  });
});
