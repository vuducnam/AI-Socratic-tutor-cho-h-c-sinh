import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  agentRules: false,
  // Không để Next đóng gói các gói native/server-only vào bundle client.
  serverExternalPackages: ['@prisma/client', '@prisma/adapter-pg', 'pg', 'bullmq', 'ioredis'],
  async headers() {
    // Site không được index (quy tắc cứng 11).
    return [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};

export default nextConfig;
