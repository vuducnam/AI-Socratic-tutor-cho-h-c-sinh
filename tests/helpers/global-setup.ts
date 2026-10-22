import { execSync } from 'node:child_process';
import { config } from 'dotenv';

// Áp migration lên cu_test trước khi chạy test (idempotent). Không có DB thì test DB sẽ báo lỗi rõ.
export default function setup() {
  config({ path: '.env.test', quiet: true });
  config({ quiet: true });
  const url = process.env.DATABASE_OWNER_URL ?? '';
  if (!/\/cu_test(\?|$)/.test(url)) {
    throw new Error('DATABASE_OWNER_URL phải trỏ tới cu_test khi chạy test (xem .env.test.example)');
  }
  execSync('pnpm prisma migrate deploy', { stdio: 'pipe', env: process.env });
}
