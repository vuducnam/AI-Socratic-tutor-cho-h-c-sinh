import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@/': r('./src/'),
      '@worker/': r('./worker/'),
      // `server-only` ném lỗi ngoài React Server; trong test, mọi file đều chạy phía server.
      'server-only': r('./tests/helpers/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'worker/**/*.test.ts', 'eval/**/*.test.ts'],
    setupFiles: ['tests/helpers/load-test-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Test DB dùng chung một database: chạy tuần tự để không giẫm dữ liệu của nhau.
    fileParallelism: false,
  },
});
