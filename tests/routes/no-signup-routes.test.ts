import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Quy tắc cứng 11: không có trang hay API đăng ký, kích hoạt, link mời. Tạo tài khoản chỉ ở /admin
// (container admin) và script CLI tạo admin đầu tiên.

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const appFiles = walk('src/app').map((f) => relative('src/app', f).split(sep).join('/'));
// Đường dẫn URL: bỏ route group "(x)".
const urlSegments = (file: string) => file.split('/').filter((s) => !/^\(.*\)$/.test(s));

const FORBIDDEN_SEGMENT = /^(register|signup|sign-up|activate|activation|invite|invitation|join|create-account|forgot-password)$/i;

describe('không có route đăng ký', () => {
  it('không có segment đăng ký/kích hoạt/mời trong src/app', () => {
    const offenders = appFiles.filter((f) => urlSegments(f).some((s) => FORBIDDEN_SEGMENT.test(s)));
    expect(offenders).toEqual([]);
  });

  it('hàm DAL tạo tài khoản chỉ được dùng trong /admin và scripts', () => {
    const creators = /\b(createParentAccount|createAdminAccount|createStudent)\b/;
    const allowed = (f: string) => f.startsWith('src/app/(admin)/admin/') || f.startsWith('src/server/dal/');
    const usages = walk('src')
      .map((f) => f.split(sep).join('/'))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.test.ts'))
      .filter((f) => creators.test(readFileSync(f, 'utf8')) && !allowed(f));
    expect(usages).toEqual([]);
  });

  it('route API công khai chỉ có đăng nhập/đăng xuất trong /api/auth', () => {
    const authRoutes = appFiles.filter((f) => f.startsWith('api/auth/') && f.endsWith('route.ts'));
    expect(authRoutes.sort()).toEqual(['api/auth/logout/route.ts', 'api/auth/parent-login/route.ts', 'api/auth/student-login/route.ts']);
  });
});
